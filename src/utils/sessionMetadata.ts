/**
 * Shared client-side session metadata resolver.
 *
 * Resolves the three values we need for any transaction payload:
 *   - season         (SCODE)            → DB: CAN
 *   - display_label  (descript)         → human-readable label for receipts/UI
 *   - backend_session (org-type aware)  → DB: session
 *       • coffee (orgtype === 'C') → SCODE  (NEVER descript, NEVER AM/PM)
 *       • dairy  (orgtype !== 'C') → descript (caller may further normalize to AM/PM)
 *
 * The resolver works fully offline by falling back to persisted sources:
 *   1. Provided in-memory activeSession (preferred)
 *   2. Dashboard persisted session: localStorage.active_session_data.session
 *   3. Fallback persisted session:   localStorage.delicoop_session_data.session
 *
 * v2.10.51: introduced `backend_session` so coffee always uploads SCODE in the
 *           transactions.session column, including offline replay paths.
 * v2.10.38: introduced to fix offline Store/AI sync leaving session/CAN empty.
 */

export interface SessionMetadata {
  season: string;          // SCODE  → DB: CAN
  session_label: string;   // descript → display label
  backend_session: string; // value to send in DB session column (orgtype-aware)
}

const EMPTY: SessionMetadata = { season: '', session_label: '', backend_session: '' };

const readPersistedRoute = (key: string): any | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.route || null;
  } catch {
    return null;
  }
};

const readPersistedSession = (key: string): any | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Dashboard saves { route, session, product, active }
    return parsed?.session || parsed || null;
  } catch {
    return null;
  }
};

const isCoffeeOrg = (): boolean => {
  try {
    const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
    return settings?.orgtype === 'C';
  } catch {
    return false;
  }
};

/**
 * v2.10.56: Resolve the active session selected on the Dashboard.
 * Returns the raw session object (with SCODE, descript, time_from, time_to, etc.)
 * or null if nothing is persisted.
 *
 * Used by Store and AI to align their season source with Buy (which already
 * reads the Dashboard selection). Eliminates the bug where Store/AI fetched a
 * different SCODE from the time-based /api/sessions/active endpoint after the
 * server clock rolled into the next session window.
 */
export const resolveDashboardActiveSession = (): any | null => {
  return (
    readPersistedSession('active_session_data') ||
    readPersistedSession('delicoop_session_data') ||
    null
  );
};

/**
 * v2.12.20: Resolve the active route (store/center) selected on the Dashboard.
 * Returns the raw route object (tcode, descript, etc.) or null if not persisted.
 */
export const resolveDashboardActiveRoute = (): any | null => {
  return (
    readPersistedRoute('active_session_data') ||
    null
  );
};

const pick = (s: any | null | undefined): { season: string; session_label: string } | null => {
  if (!s) return null;
  const season = String(s.SCODE || '').trim();
  const session_label = String(s.descript || '').trim();
  if (!season && !session_label) return null;
  return { season, session_label };
};

/**
 * Resolve session metadata synchronously from in-memory or persisted sources.
 * Safe to call from any code path. Always returns a SessionMetadata object
 * (empty strings if nothing is available).
 *
 * @param activeSession optional in-memory active session (preferred when present)
 * @param orgtypeOverride optional explicit orgtype (else read from localStorage)
 */
export const resolveSessionMetadata = (
  activeSession?: any | null,
  orgtypeOverride?: string,
): SessionMetadata => {
  const base =
    pick(activeSession) ||
    pick(readPersistedSession('active_session_data')) ||
    pick(readPersistedSession('delicoop_session_data'));

  if (!base) return EMPTY;

  const isCoffee =
    orgtypeOverride !== undefined ? orgtypeOverride === 'C' : isCoffeeOrg();

  // Coffee: backend session column must carry SCODE (fall back to descript only
  // if SCODE is genuinely missing — backend has its own rescue lookup).
  // Dairy: backend session column carries the descript (caller may then collapse
  // to AM/PM for the milk-collection endpoint).
  const backend_session = isCoffee
    ? base.season || base.session_label
    : base.session_label || base.season;

  return {
    season: base.season,
    session_label: base.session_label,
    backend_session,
  };
};

/**
 * Generate a unique 10-character milk_session_id.
 * Begins with devcode (e.g. AG05, BA02, 01) if available, followed by numeric digits
 * derived from timestamp & random sequence to guarantee 10-character uniqueness.
 */
export const generateMilkSessionId = (devcode?: string): string => {
  const dc = (devcode || (typeof localStorage !== 'undefined' ? localStorage.getItem('devcode') : '') || '00')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const prefix = dc.slice(0, 4) || '00'; // Up to 4 chars
  const remainingLength = 10 - prefix.length;
  const timeStr = Date.now().toString(); // e.g. "1712345678901"
  const randStr = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const digits = (timeStr + randStr).slice(-remainingLength);
  return `${prefix}${digits}`;
};

/**
 * Resolve the active milk_session_id from localStorage.active_session_data.
 */
export const resolveDashboardMilkSessionId = (): string | null => {
  try {
    if (isCoffeeOrg()) return null;
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('active_session_data') : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.active) return null;

    // Auto-heal: if session is active but milk_session_id is missing or invalid ('0' or not 10 chars), generate & persist one
    const currentId = String(parsed.milk_session_id || '').trim();
    if (!currentId || currentId === '0' || currentId.length !== 10) {
      const devcode = localStorage.getItem('devcode') || '';
      const newMilkId = generateMilkSessionId(devcode);
      parsed.milk_session_id = newMilkId;
      localStorage.setItem('active_session_data', JSON.stringify(parsed));
      console.log('🥛 [SESSION] Auto-healed missing/invalid milk_session_id:', newMilkId);
      return newMilkId;
    }

    return currentId;
  } catch {
    return null;
  }
};

