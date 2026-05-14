/**
 * useBtStatus (v2.10.85)
 *
 * Real-time Bluetooth connection status for a given role (scale | printer).
 * Backed by btConnectionManager — updates instantly on every state change.
 */

import { useEffect, useState } from "react";
import { bt, type BtRole, type BtSnapshot } from "@/services/btConnectionManager";

export interface UseBtStatusResult extends BtSnapshot {
  /** Trigger a manual (re)connect attempt. Idempotent. */
  reconnect: () => void;
  /** Forget the saved device for this role. */
  forget: () => Promise<void>;
}

export function useBtStatus(role: BtRole): UseBtStatusResult {
  const [snap, setSnap] = useState<BtSnapshot>(() => bt.getSnapshot(role));

  useEffect(() => {
    setSnap(bt.getSnapshot(role));
    const unsub = bt.subscribe((r, s) => {
      if (r === role) setSnap(s);
    });

    // Tick once a second so retryInMs stays fresh in the UI.
    const tick = setInterval(() => {
      setSnap(bt.getSnapshot(role));
    }, 1000);

    return () => {
      unsub();
      clearInterval(tick);
    };
  }, [role]);

  return {
    ...snap,
    reconnect: () => {
      void bt.ensureConnected(role);
    },
    forget: () => bt.forget(role),
  };
}
