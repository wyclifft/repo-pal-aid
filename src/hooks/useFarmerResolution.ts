import { useCallback } from 'react';
import { type Farmer } from '@/lib/supabase';
import { toast } from 'sonner';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface UseFarmerResolutionProps {
  farmers: Farmer[];
  isMemberMode?: boolean; // true = Members (M prefix), false = Debtors (D prefix)
  blacklistedFarmerIds?: Set<string>;
  /**
   * v2.10.52: when true, exact/padded/numeric matches MUST share the active
   * mode's prefix. If a typed full ID belongs to the opposite mode, the
   * resolver returns null and toasts a "Switch to …" hint. Default false to
   * preserve existing Sell/Buy behavior.
   */
  enforcePrefix?: boolean;
}

interface UseFarmerResolutionReturn {
  resolveFarmerId: (input: string) => Farmer | null;
  resolveAndSelect: (
    input: string,
    onSelect: (farmer: Farmer) => void,
    onNotFound?: () => void
  ) => boolean;
}

/**
 * Shared hook for resolving farmer IDs across all modules
 * Handles exact match, numeric padding (M00001), and prefix filtering
 */
export const useFarmerResolution = ({
  farmers,
  isMemberMode = true,
  blacklistedFarmerIds,
  enforcePrefix = false,
}: UseFarmerResolutionProps): UseFarmerResolutionReturn => {
  // Filter farmers based on prefix and blacklist
  const availableFarmers = blacklistedFarmerIds && blacklistedFarmerIds.size > 0
    ? farmers.filter(f => !blacklistedFarmerIds.has(f.farmer_id.replace(/^#/, '').trim()))
    : farmers;

  const resolveFarmerId = useCallback((input: string): Farmer | null => {
    if (!input.trim()) return null;

    const numericInput = input.replace(/\D/g, '');
    const prefix = isMemberMode ? 'M' : 'D';
    const oppositePrefix = isMemberMode ? 'D' : 'M';
    const oppositeLabel = isMemberMode ? 'Debtors' : 'Members';

    const matchesActivePrefix = (f: Farmer) =>
      f.farmer_id.toUpperCase().startsWith(prefix);

    // Prefix-enforced mode: warn if the typed ID belongs to the opposite mode.
    if (enforcePrefix) {
      const trimmedUpper = input.trim().toUpperCase();
      if (trimmedUpper.startsWith(oppositePrefix)) {
        const oppositeMatch = availableFarmers.find(
          f => f.farmer_id.toUpperCase() === trimmedUpper
        );
        if (oppositeMatch) {
          toast.error(`Switch to ${oppositeLabel} to use ID ${oppositeMatch.farmer_id}`);
          return null;
        }
      }
    }

    // 1. Exact match by farmer_id
    const exactMatch = availableFarmers.find(
      f => f.farmer_id.toLowerCase() === input.toLowerCase() &&
           (!enforcePrefix || matchesActivePrefix(f))
    );
    if (exactMatch) return exactMatch;

    // 2. If pure numeric, resolve to padded format (e.g., 1 -> M00001)
    if (numericInput && numericInput === input.trim()) {
      const paddedId = `${prefix}${numericInput.padStart(5, '0')}`;
      const paddedMatch = availableFarmers.find(
        f => f.farmer_id.toUpperCase() === paddedId.toUpperCase() &&
             (!enforcePrefix || matchesActivePrefix(f))
      );
      if (paddedMatch) return paddedMatch;

      // 3. Try matching by numeric portion only
      const numericMatch = availableFarmers.find(f => {
        if (enforcePrefix && !matchesActivePrefix(f)) return false;
        const farmerNumeric = f.farmer_id.replace(/\D/g, '');
        return parseInt(farmerNumeric, 10) === parseInt(numericInput, 10);
      });
      if (numericMatch) return numericMatch;
    }

    // 4. Check if farmer is in the blacklist
    if (blacklistedFarmerIds) {
      const blacklisted = farmers.find(
        f => f.farmer_id.toLowerCase() === input.toLowerCase() ||
             f.farmer_id.replace(/\D/g, '') === numericInput
      );
      if (blacklisted && blacklistedFarmerIds.has(blacklisted.farmer_id.replace(/^#/, '').trim())) {
        toast.error(`${blacklisted.name} has already delivered this session`);
        return null;
      }
    }

    return null;
  }, [availableFarmers, farmers, isMemberMode, blacklistedFarmerIds, enforcePrefix]);

  const resolveAndSelect = useCallback((
    input: string,
    onSelect: (farmer: Farmer) => void,
    onNotFound?: () => void
  ): boolean => {
    const farmer = resolveFarmerId(input);
    if (farmer) {
      onSelect(farmer);
      try { Haptics.impact({ style: ImpactStyle.Light }); } catch {}
      return true;
    } else if (input.trim()) {
      toast.error('Member not found');
      onNotFound?.();
      return false;
    }
    return false;
  }, [resolveFarmerId]);

  return {
    resolveFarmerId,
    resolveAndSelect,
  };
};
