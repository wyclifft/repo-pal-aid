import { type Farmer } from '@/lib/supabase';

/**
 * Resolves a member ID to a formatted string "ID - Name".
 * If the input doesn't look like an ID or no member is found, returns the original input.
 */
export const resolveMemberName = (input: string | undefined, farmers: Farmer[]): string => {
  if (!input || input === 'owner' || input.includes(' - ')) return input || 'owner';

  const member = farmers.find(f => f.farmer_id.replace(/^#/, '').trim() === input.replace(/^#/, '').trim());
  if (member) {
    return `${member.farmer_id} - ${member.name}`;
  }
  return input;
};
