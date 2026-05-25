/**
 * Bluetooth Connection Manager (v2.10.85)
 *
 * Single source of truth for SCALE and PRINTER connection lifecycle.
 *
 * Wraps existing low-level drivers in `services/bluetooth.ts` and
 * `services/bluetoothClassic.ts` — does NOT replace them. Adds:
 *   - Per-role state machine: idle → connecting → connected
 *                                          ↘ failed → reconnecting → connected
 *     connected → disconnected (auto) → reconnecting → connected | failed
 *   - Per-role mutex (no duplicate / parallel connect attempts)
 *   - Exponential backoff retry (2s, 4s, 8s, 15s, 30s, then steady 30s)
 *   - Health monitor every 15s while connected (paused while document hidden)
 *   - Auto-reconnect on app resume / online / adapter on
 *   - Persistent last-paired memory (localStorage) — survives logout / reload
 *   - All transitions emit `btStatusChange` and forward to console.log("[BT] …")
 *     so the persistent debug console at /debug captures every event.
 *
 * Public API:
 *   bt.ensureConnected(role)
 *   bt.getStatus(role) / bt.getDeviceName(role)
 *   bt.subscribe(cb) / unsubscribe
 *   bt.forget(role)
 *   bt.installAutoReconnect()  ← called once from main.tsx
 */

import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import {
  isScaleConnected,
  isPrinterConnected,
  verifyScaleConnection,
  verifyPrinterConnection,
  quickReconnect as quickReconnectBleScale,
  quickReconnectPrinter as quickReconnectBlePrinter,
  getStoredDeviceInfo,
  getStoredPrinterInfo,
  isBleHalfOfDualModeScale,
  clearStoredDevice,
  clearStoredPrinter,
  disconnectBluetoothScale,
  disconnectBluetoothPrinter,
  isClassicScaleConnected,
  quickReconnectClassicScale,
  isClassicPrinterConnected,
  quickReconnectClassicPrinter,
  getStoredClassicDevice,
  getStoredClassicPrinter,
  clearStoredClassicDevice,
} from "./bluetooth";

export type BtRole = "scale" | "printer";
export type BtStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

interface RoleState {
  status: BtStatus;
  deviceName: string | null;
  lastError: string | null;
  retryAt: number | null; // ms timestamp
  attempt: number;
  forgotten: boolean;
  pausedForGesture: boolean; // v2.10.87: Web BT requires user gesture
  inFlight: Promise<void> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const initialState = (): RoleState => ({
  status: "idle",
  deviceName: null,
  lastError: null,
  retryAt: null,
  attempt: 0,
  forgotten: false,
  pausedForGesture: false,
  inFlight: null,
  retryTimer: null,
});

const state: Record<BtRole, RoleState> = {
  scale: initialState(),
  printer: initialState(),
};

type Listener = (role: BtRole, snap: BtSnapshot) => void;
const listeners = new Set<Listener>();

export interface BtSnapshot {
  status: BtStatus;
  deviceName: string | null;
  lastError: string | null;
  retryInMs: number | null;
}

const BACKOFF_MS = [2000, 4000, 8000, 15000, 30000];
const HEALTH_INTERVAL_MS = 15000;

function btlog(level: "info" | "warn" | "error", role: BtRole, msg: string, data?: unknown) {
  // Tagged with [BT] so persistentLogger picks it up automatically.
  const line = `[BT][${role}] ${msg}`;
  if (level === "error") console.error(line, data ?? "");
  else if (level === "warn") console.warn(line, data ?? "");
  else console.log(line, data !== undefined ? data : "");
}

function snapshot(role: BtRole): BtSnapshot {
  const s = state[role];
  return {
    status: s.status,
    deviceName: s.deviceName,
    lastError: s.lastError,
    retryInMs: s.retryAt ? Math.max(0, s.retryAt - Date.now()) : null,
  };
}

function emit(role: BtRole) {
  const snap = snapshot(role);
  for (const l of listeners) {
    try {
      l(role, snap);
    } catch (e) {
      btlog("warn", role, "listener threw", e);
    }
  }
  try {
    window.dispatchEvent(
      new CustomEvent("btStatusChange", { detail: { role, ...snap } })
    );
  } catch {
    /* noop */
  }
}

function setStatus(role: BtRole, status: BtStatus, patch: Partial<RoleState> = {}) {
  const s = state[role];
  const prev = s.status;
  Object.assign(s, patch, { status });
  if (prev !== status) {
    btlog("info", role, `status: ${prev} → ${status}${s.deviceName ? ` (${s.deviceName})` : ""}${s.lastError ? ` err=${s.lastError}` : ""}`);
  }
  emit(role);
}

// ─── persistent memory ─────────────────────────────────────────────────────────

interface SavedDevice {
  deviceId: string;
  deviceName: string;
  type: "ble" | "classic";
}

function getSavedDevice(role: BtRole): SavedDevice | null {
  if (role === "scale") {
    // v2.10.100: Classic SPP is the weight-bearing transport on dual-mode
    // modules (HC-04 etc.). Always prefer the Classic record over BLE — the
    // BLE half (e.g. HC-04BLE) never streams weight.
    const cls = getStoredClassicDevice();
    if (cls) {
      // If a stale BLE entry still lingers alongside a Classic record, drop
      // it once so we never schedule BLE retries against the wrong half.
      const staleBle = getStoredDeviceInfo();
      if (staleBle) {
        btlog("info", "scale", `migration: cleared stale BLE record (${staleBle.deviceName}) in favour of Classic SPP (${cls.name})`);
        try { clearStoredDevice(); } catch {}
      }
      return { deviceId: cls.address, deviceName: cls.name, type: "classic" };
    }
    const ble = getStoredDeviceInfo();
    if (ble) {
      // v2.10.99: Drop the BLE half of dual-mode scales (e.g. HC-04BLE) — it
      // never streams weight. Clear once so we stop scheduling retries every
      // few seconds and flooding the persistent log.
      if (isBleHalfOfDualModeScale(ble.deviceName)) {
        btlog("warn", "scale", `saved device "${ble.deviceName}" is BLE half of dual-mode scale — clearing; pair the SPP port (e.g. HC-04) with PIN 1234`);
        try { clearStoredDevice(); } catch {}
        return null;
      }
      return { deviceId: ble.deviceId, deviceName: ble.deviceName, type: ble.connectionType === "classic-spp" ? "classic" : "ble" };
    }
    return null;
  }
  // printer
  const ble = getStoredPrinterInfo();
  if (ble) return { deviceId: ble.deviceId, deviceName: ble.deviceName, type: "ble" };
  const cls = getStoredClassicPrinter();
  if (cls) return { deviceId: cls.address, deviceName: cls.name, type: "classic" };
  return null;
}

function isLowLevelConnected(role: BtRole): boolean {
  if (role === "scale") return isScaleConnected() || isClassicScaleConnected();
  return isPrinterConnected() || isClassicPrinterConnected();
}

// ─── connect attempts ──────────────────────────────────────────────────────────

async function tryConnectOnce(role: BtRole, saved: SavedDevice): Promise<{ ok: boolean; requiresGesture?: boolean }> {
  try {
    if (role === "scale") {
      if (saved.type === "classic") {
        const r = await quickReconnectClassicScale(() => {});
        if (!r.success) throw new Error(r.error || "classic scale reconnect failed");
      } else {
        const r = await quickReconnectBleScale(saved.deviceId, () => {}, 1);
        if (!r.success) throw new Error(r.error || "BLE scale reconnect failed");
      }
    } else {
      if (saved.type === "classic") {
        const r = await quickReconnectClassicPrinter();
        if (!r.success) throw new Error(r.error || "classic printer reconnect failed");
      } else {
        const r = await quickReconnectBlePrinter(saved.deviceId, 1);
        if (!r.success) throw new Error(r.error || "BLE printer reconnect failed");
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : "";
    // Web Bluetooth requires a user gesture for requestDevice — looping
    // is pointless and floods the log. Pause until next gesture instead.
    const requiresGesture =
      name === "NotAllowedError" ||
      /user gesture|requestDevice/i.test(msg);
    btlog("warn", role, `connect attempt failed: ${msg}`);
    return { ok: false, requiresGesture };
  }
}

function scheduleRetry(role: BtRole) {
  const s = state[role];
  if (s.forgotten) return;
  const delay = BACKOFF_MS[Math.min(s.attempt, BACKOFF_MS.length - 1)];
  s.retryAt = Date.now() + delay;
  setStatus(role, "reconnecting", {});
  btlog("info", role, `retry in ${delay}ms (attempt ${s.attempt + 1})`);
  if (s.retryTimer) clearTimeout(s.retryTimer);
  s.retryTimer = setTimeout(() => {
    s.retryTimer = null;
    void ensureConnected(role);
  }, delay);
}

async function ensureConnected(role: BtRole): Promise<void> {
  const s = state[role];
  if (s.inFlight) return s.inFlight;
  if (s.forgotten) return;
  if (s.pausedForGesture) return; // wait for next user gesture / manual pair

  const saved = getSavedDevice(role);
  if (!saved) {
    setStatus(role, "idle", { deviceName: null, lastError: null, retryAt: null, attempt: 0 });
    return;
  }

  // Already healthy? Sync state and exit.
  if (isLowLevelConnected(role)) {
    setStatus(role, "connected", { deviceName: saved.deviceName, lastError: null, retryAt: null, attempt: 0 });
    return;
  }

  setStatus(role, s.attempt > 0 ? "reconnecting" : "connecting", {
    deviceName: saved.deviceName,
    retryAt: null,
  });

  const op = (async () => {
    const result = await tryConnectOnce(role, saved);
    if (result.ok) {
      setStatus(role, "connected", { lastError: null, retryAt: null, attempt: 0 });
    } else if (result.requiresGesture) {
      // Cancel any pending retry — looping cannot succeed without a gesture.
      if (s.retryTimer) { clearTimeout(s.retryTimer); s.retryTimer = null; }
      s.pausedForGesture = true;
      s.attempt = 0;
      s.lastError = "needs manual reconnect";
      setStatus(role, "failed", { retryAt: null });
      btlog("warn", role, "paused — needs user gesture to reconnect");
    } else {
      s.attempt += 1;
      s.lastError = "connect failed";
      // After many attempts, surface 'failed' but keep retrying in background
      if (s.attempt >= BACKOFF_MS.length) {
        setStatus(role, "failed", {});
      }
      scheduleRetry(role);
    }
  })().finally(() => {
    s.inFlight = null;
  });

  s.inFlight = op;
  return op;
}

// v2.10.87: clear gesture-pause flags when a real user input arrives.
function resumeFromGesture() {
  let resumed = false;
  for (const role of ["scale", "printer"] as const) {
    if (state[role].pausedForGesture) {
      state[role].pausedForGesture = false;
      state[role].attempt = 0;
      resumed = true;
      btlog("info", role, "user gesture detected → resuming auto-reconnect");
      void ensureConnected(role);
    }
  }
  return resumed;
}

// ─── health monitor ────────────────────────────────────────────────────────────

let healthTimer: ReturnType<typeof setInterval> | null = null;

function startHealthMonitor() {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return; // pause when backgrounded
    void runHealthCheck();
  }, HEALTH_INTERVAL_MS);
}

async function runHealthCheck() {
  for (const role of ["scale", "printer"] as const) {
    const s = state[role];
    if (s.status !== "connected") continue;
    try {
      const verifier = role === "scale" ? verifyScaleConnection : verifyPrinterConnection;
      const ok = await verifier();
      if (!ok && !isLowLevelConnected(role)) {
        btlog("warn", role, "health check failed → triggering reconnect");
        s.attempt = 0;
        s.lastError = "health check failed";
        setStatus(role, "disconnected", {});
        scheduleRetry(role);
      }
    } catch (e) {
      btlog("warn", role, "health check threw", e);
    }
  }
}

// ─── lifecycle integration ─────────────────────────────────────────────────────

let installed = false;

export function installAutoReconnect() {
  if (installed) return;
  installed = true;
  btlog("info", "scale", "BT manager installed");

  // Listen for low-level disconnect broadcasts and trigger reconnect.
  const handle = (role: BtRole) => (e: Event) => {
    const detail = (e as CustomEvent<{ connected: boolean }>).detail;
    if (!detail) return;
    if (detail.connected) {
      const saved = getSavedDevice(role);
      state[role].pausedForGesture = false; // manual pair clears the pause
      setStatus(role, "connected", {
        deviceName: saved?.deviceName ?? state[role].deviceName,
        lastError: null,
        retryAt: null,
        attempt: 0,
      });
    } else {
      if (state[role].forgotten) {
        setStatus(role, "idle", { deviceName: null });
        return;
      }
      btlog("warn", role, "low-level disconnect event → reconnecting");
      state[role].attempt = 0;
      setStatus(role, "disconnected", {});
      scheduleRetry(role);
    }
  };

  window.addEventListener("scaleConnectionChange", handle("scale"));
  window.addEventListener("printerConnectionChange", handle("printer"));

  // Resume from background: try to (re)connect both roles immediately.
  const onResume = () => {
    btlog("info", "scale", "app resumed → ensureConnected both roles");
    state.scale.attempt = 0;
    state.printer.attempt = 0;
    void ensureConnected("scale");
    void ensureConnected("printer");
  };

  if (Capacitor.isNativePlatform()) {
    try {
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) onResume();
      });
    } catch (e) {
      btlog("warn", "scale", "App.addListener failed", e);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onResume();
  });

  window.addEventListener("online", () => {
    btlog("info", "scale", "network online → ensureConnected both roles");
    state.scale.attempt = 0;
    state.printer.attempt = 0;
    void ensureConnected("scale");
    void ensureConnected("printer");
  });

  // v2.10.87: Web Bluetooth requires a user gesture for requestDevice. If
  // a previous attempt was paused with `pausedForGesture`, the next real
  // pointer/key/touch event triggers a fresh attempt inside the gesture window.
  const onUserGesture = () => { resumeFromGesture(); };
  window.addEventListener("pointerdown", onUserGesture, { passive: true });
  window.addEventListener("keydown", onUserGesture, { passive: true });
  window.addEventListener("touchstart", onUserGesture, { passive: true });

  startHealthMonitor();

  // Initial sweep — auto-reconnect anything we already know about.
  // Defer slightly so the rest of the app finishes booting first.
  setTimeout(() => {
    void ensureConnected("scale");
    void ensureConnected("printer");
  }, 1500);
}

// ─── public api ────────────────────────────────────────────────────────────────

export const bt = {
  ensureConnected,
  getStatus(role: BtRole): BtStatus {
    return state[role].status;
  },
  getSnapshot(role: BtRole): BtSnapshot {
    return snapshot(role);
  },
  getDeviceName(role: BtRole): string | null {
    return state[role].deviceName ?? getSavedDevice(role)?.deviceName ?? null;
  },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async forget(role: BtRole): Promise<void> {
    state[role].forgotten = true;
    state[role].pausedForGesture = false;
    if (state[role].retryTimer) {
      clearTimeout(state[role].retryTimer);
      state[role].retryTimer = null;
    }
    try {
      if (role === "scale") {
        clearStoredDevice();
        clearStoredClassicDevice();
        await disconnectBluetoothScale(true).catch(() => {});
      } else {
        clearStoredPrinter();
        await disconnectBluetoothPrinter(true).catch(() => {});
      }
    } finally {
      setStatus(role, "idle", { deviceName: null, lastError: null, retryAt: null, attempt: 0 });
      // Allow re-pairing later
      setTimeout(() => {
        state[role].forgotten = false;
      }, 1000);
    }
  },
  installAutoReconnect,
};

export default bt;
