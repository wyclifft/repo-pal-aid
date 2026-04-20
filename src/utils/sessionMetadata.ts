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
