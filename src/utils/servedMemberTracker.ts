/**
 * Utility to track members served across devices in the same ccode on a given date.
 * Used primarily by the Store Portal to show a confirmation prompt
 * for repeat servings tagging the location and device they have been served at.
 */

export interface ServedMemberDetails {
  memberId: string;
  location?: string;
  device?: string;
  transdate?: string;
}

const GET_TODAY_KEY = () => {
  const today = new Date().toISOString().split('T')[0];
  return `store_served_members_${today}`;
};

/**
 * Mark a member as served today on this device with location & device info.
 */
export const markMemberAsServed = (
  memberId: string,
  location?: string,
  device?: string
): void => {
  if (!memberId) return;

  const key = GET_TODAY_KEY();
  const cleanId = memberId.trim().toUpperCase();

  const defaultLoc = location || (typeof localStorage !== 'undefined' ? localStorage.getItem('device_company_name') : null) || 'Store';
  const defaultDev = device || (typeof localStorage !== 'undefined' ? localStorage.getItem('devcode') : null) || 'POS Device';

  try {
    const servedMap = getServedMembersMap();
    servedMap[cleanId] = {
      memberId: cleanId,
      location: defaultLoc,
      device: defaultDev,
      transdate: new Date().toISOString().split('T')[0]
    };
    localStorage.setItem(key, JSON.stringify(servedMap));

    // Cleanup old keys
    cleanupOldServedKeys();
  } catch (e) {
    console.error('[ServedMemberTracker] Failed to mark served:', e);
  }
};

/**
 * Get local served details for a member if served today on this device.
 */
export const getServedMemberLocalDetails = (
  memberId: string
): { served: boolean; location?: string; device?: string } | null => {
  if (!memberId) return null;
  const cleanId = memberId.trim().toUpperCase();
  const servedMap = getServedMembersMap();
  const entry = servedMap[cleanId];
  if (entry) {
    return {
      served: true,
      location: entry.location,
      device: entry.device
    };
  }
  return null;
};

/**
 * Check if a member has already been served today (synchronous check on local device).
 */
export const isMemberServedToday = (memberId: string): boolean => {
  if (!memberId) return false;
  const cleanId = memberId.trim().toUpperCase();
  return cleanId in getServedMembersMap();
};

/**
 * Check if a member has been served today across ANY device in this ccode (online API + local cache).
 */
export const checkMemberServedToday = async (
  memberId: string,
  ccode?: string,
  deviceFingerprint?: string
): Promise<{ served: boolean; location?: string; device?: string }> => {
  if (!memberId) return { served: false };

  // 1. Check local device storage first
  const localDetails = getServedMemberLocalDetails(memberId);
  if (localDetails?.served) {
    return localDetails;
  }

  // 2. Query backend API to check all devices in this ccode
  try {
    const { mysqlApi } = await import('@/services/mysqlApi');
    const result = await mysqlApi.sales.checkServedToday(memberId, ccode, deviceFingerprint);
    if (result.served) {
      // Cache locally so subsequent checks on this device are instant
      markMemberAsServed(memberId, result.location, result.device);
      return {
        served: true,
        location: result.location,
        device: result.device
      };
    }
  } catch (e) {
    console.warn('[ServedMemberTracker] Backend check failed, falling back to local result:', e);
  }

  return { served: false };
};

/**
 * Internal: Get the map of served members for today.
 * Handles backward compatibility with old array structure `["M00001"]`.
 */
const getServedMembersMap = (): Record<string, ServedMemberDetails> => {
  const key = GET_TODAY_KEY();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    // Handle legacy array format ["M00001", "M00002"]
    if (Array.isArray(parsed)) {
      const map: Record<string, ServedMemberDetails> = {};
      const defaultLoc = (typeof localStorage !== 'undefined' ? localStorage.getItem('device_company_name') : null) || 'Store';
      const defaultDev = (typeof localStorage !== 'undefined' ? localStorage.getItem('devcode') : null) || 'POS Device';
      parsed.forEach((id: string) => {
        if (typeof id === 'string') {
          const clean = id.trim().toUpperCase();
          map[clean] = {
            memberId: clean,
            location: defaultLoc,
            device: defaultDev
          };
        }
      });
      return map;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, ServedMemberDetails>;
    }

    return {};
  } catch {
    return {};
  }
};

/**
 * Internal: Remove stored keys from previous dates to save space.
 */
const cleanupOldServedKeys = (): void => {
  try {
    const todayKey = GET_TODAY_KEY();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('store_served_members_') && key !== todayKey) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore errors in cleanup
  }
};
