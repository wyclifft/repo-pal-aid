/**
 * Shared client-side session metadata resolver.
 *
 * Resolves `season` (SCODE) and `session_label` (descript) for Store/AI
 * transactions even when the device is offline and the in-memory
 * `activeSession` (loaded from API) is null.
 *
 * Resolution order:
 *   1. Provided in-memory activeSession (preferred)
 *   2. Dashboard persisted session: localStorage.active_session_data.session
 *   3. Fallback persisted session:   localStorage.delicoop_session_data.session
 *   4. Best-effort: pick any cached session (sync, not async — kept simple here)
 *
 * v2.10.38: introduced to fix offline Store/AI sync leaving session/CAN empty.
 */

export interface SessionMetadata {
  season: string;        // SCODE → DB: CAN column
  session_label: string; // descript → DB: session column
}

const EMPTY: SessionMetadata = { season: '', session_label: '' };

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

const pick = (s: any | null | undefined): SessionMetadata | null => {
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
 */
export const resolveSessionMetadata = (activeSession?: any | null): SessionMetadata => {
  return (
    pick(activeSession) ||
    pick(readPersistedSession('active_session_data')) ||
    pick(readPersistedSession('delicoop_session_data')) ||
    EMPTY
  );
};
