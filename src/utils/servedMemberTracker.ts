/**
 * Utility to track members served on the same device on a given date.
 * Used primarily by the Store Portal to show a confirmation prompt
 * for repeat servings.
 */

const GET_TODAY_KEY = () => {
  const today = new Date().toISOString().split('T')[0];
  return `store_served_members_${today}`;
};

/**
 * Mark a member as served today on this device.
 */
export const markMemberAsServed = (memberId: string): void => {
  if (!memberId) return;

  const key = GET_TODAY_KEY();
  const cleanId = memberId.trim().toUpperCase();

  try {
    const served = getServedMembers();
    if (!served.includes(cleanId)) {
      served.push(cleanId);
      localStorage.setItem(key, JSON.stringify(served));

      // Cleanup old keys (optional but good practice)
      cleanupOldServedKeys();
    }
  } catch (e) {
    console.error('[ServedMemberTracker] Failed to mark served:', e);
  }
};

/**
 * Check if a member has already been served today on this device.
 */
export const isMemberServedToday = (memberId: string): boolean => {
  if (!memberId) return false;
  const cleanId = memberId.trim().toUpperCase();
  return getServedMembers().includes(cleanId);
};

/**
 * Internal: Get the list of served member IDs for today.
 */
const getServedMembers = (): string[] => {
  const key = GET_TODAY_KEY();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
  } catch (e) {
    // Ignore errors in cleanup
  }
};
