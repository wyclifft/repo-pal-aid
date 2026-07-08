/**
 * BoostOutstandingChip — Farmer Boost Phase 3 (v2.11.1)
 *
 * Read-only pill showing a farmer's outstanding boost balance during a
 * milk/coffee sell flow. Silently hides when:
 *   - Boost is not enabled for this coop
 *   - The farmer is not enrolled
 *   - Outstanding == 0
 *   - The account/network lookup fails (never surface errors on the Sell path)
 *
 * Zero business-logic impact on the sell transaction — we never block
 * capture, never mutate weight, and never take part in submission.
 * Auto-recovery from payouts is Phase 4 material.
 */

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { getBoostAccount, isBoostEnabled } from '@/services/creditEngine';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';

interface Props {
  farmerId: string | null | undefined;
}

export function BoostOutstandingChip({ farmerId }: Props) {
  const [outstanding, setOutstanding] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOutstanding(null);
    if (!farmerId) return;
    (async () => {
      try {
        const fp = await generateDeviceFingerprint();
        if (!(await isBoostEnabled(fp))) return;
        const acct = await getBoostAccount(farmerId, fp);
        if (cancelled || !acct) return;
        if (acct.status === 'INACTIVE') return;
        if (!(acct.outstanding > 0)) return;
        setOutstanding(acct.outstanding);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [farmerId]);

  if (outstanding == null) return null;

  return (
    <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2 py-0.5 text-xs font-medium">
      <Wallet className="h-3 w-3" />
      Boost owing KSh {outstanding.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </div>
  );
}

export default BoostOutstandingChip;
