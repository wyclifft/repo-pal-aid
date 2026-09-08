/**
 * Z Report Period Selector Dialog
 *
 * v2.10.114: Options are now dynamically generated from the sessions table
 * (cached in IndexedDB). Each option = one session row, matched at filter
 * time by transactions.CAN → sessions.SCODE, and labeled using
 * sessions.descript. An "All Z" option is always appended.
 *
 * Previous hard-coded morning/afternoon/evening options have been removed.
 */

import { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Printer, Sun, Sunset, Moon, Calendar, Clock } from 'lucide-react';

// Period is now the session SCODE (matches transactions.CAN). 'all' is the
// reserved combined option that includes every session.
export type ZReportPeriod = string;

export interface SessionOptionInput {
  SCODE?: string;
  descript?: string;
  milk_session_id?: string;
}

interface BuiltOption {
  value: string;          // SCODE, milk_session_id, or 'all'
  label: string;          // e.g. "Morning Z" or "AM Session Z (AG05849201)"
  description: string;    // e.g. "Morning session collections only"
  icon: JSX.Element;
}

// Pick a cosmetic icon based on keywords in the descript. Purely visual —
// filtering does NOT depend on this.
const pickIcon = (descript: string): JSX.Element => {
  const d = (descript || '').toLowerCase();
  if (d.includes('morning') || d.includes('am')) return <Sun className="h-5 w-5 text-yellow-600" />;
  if (d.includes('afternoon') || d.includes('pm')) return <Sunset className="h-5 w-5 text-orange-600" />;
  if (d.includes('evening') || d.includes('night')) return <Moon className="h-5 w-5 text-blue-600" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
};

const buildOptions = (sessions: SessionOptionInput[]): BuiltOption[] => {
  const seen = new Set<string>();
  const list: BuiltOption[] = [];

  (sessions || []).forEach((s) => {
    const milkId = String(s?.milk_session_id || '').trim();
    const code = String(s?.SCODE || '').trim();
    const descript = String(s?.descript || '').trim();

    if (milkId && milkId !== '0' && milkId.length === 10) {
      if (seen.has(milkId)) return;
      seen.add(milkId);
      const sessionName = descript || code || 'Session';
      list.push({
        value: milkId,
        label: `${sessionName} Z (${milkId})`,
        description: `Milk Session ID: ${milkId}`,
        icon: pickIcon(sessionName),
      });
      return;
    }

    if (!code) return;
    const key = code.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    const label = descript ? `${descript} Z` : `${code} Z`;
    list.push({
      value: code,
      label,
      description: descript
        ? `${descript} session collections only`
        : `${code} session collections only`,
      icon: pickIcon(descript || code),
    });
  });

  // Always append the combined option
  list.push({
    value: 'all',
    label: 'All Z',
    description: 'All sessions combined (full day)',
    icon: <Calendar className="h-5 w-5" />,
  });

  return list;
};

interface ZReportPeriodSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (period: ZReportPeriod, periodLabel: string) => void;
  /** Sessions cached locally (from sessions table). */
  sessions?: SessionOptionInput[];
}

export const ZReportPeriodSelector = ({
  open,
  onClose,
  onSelect,
  sessions = [],
}: ZReportPeriodSelectorProps) => {
  const options = useMemo(() => buildOptions(sessions), [sessions]);
  const [selectedPeriod, setSelectedPeriod] = useState<ZReportPeriod>('all');

  // If the cached sessions list changes while the dialog is open, make sure
  // the selected value is still valid.
  useEffect(() => {
    if (!options.find(o => o.value === selectedPeriod)) {
      setSelectedPeriod('all');
    }
  }, [options, selectedPeriod]);

  const handleConfirm = () => {
    const selected = options.find(o => o.value === selectedPeriod) || options[options.length - 1];
    onSelect(selected.value, selected.label);
    onClose();
  };

  const handleSelectOption = (option: BuiltOption) => {
    setSelectedPeriod(option.value);
    onSelect(option.value, option.label);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Select Z Report Period
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup
            value={selectedPeriod}
            onValueChange={(value) => {
              setSelectedPeriod(value);
              const opt = options.find(o => o.value === value);
              if (opt) handleSelectOption(opt);
            }}
            className="space-y-3"
          >
            {options.map((option) => (
              <div
                key={option.value}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedPeriod === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => handleSelectOption(option)}
              >
                <RadioGroupItem value={option.value} id={`zperiod-${option.value}`} />
                <div className="flex-shrink-0">{option.icon}</div>
                <Label
                  htmlFor={`zperiod-${option.value}`}
                  className="flex-1 cursor-pointer"
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.description}
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <Printer className="h-4 w-4 mr-2" />
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Filter transactions by session SCODE (transactions.CAN).
 * - period === 'all' returns everything.
 * - Otherwise compares case/whitespace-insensitively against season_code
 *   (the saved CAN value). Falls back to session column for legacy rows
 *   that pre-date season_code.
 * - v2.12.37: For Dairy (orgtype D), filter strictly by session column.
 */
export const filterTransactionsByPeriod = <T extends { session?: string; season_code?: string; milk_session_id?: string }>(
  transactions: T[],
  period: ZReportPeriod,
  orgtype?: string
): T[] => {
  if (!period || period === 'all') return transactions;

  const target = String(period).trim().toUpperCase();
  if (!target) return transactions;

  // 10-digit milk_session_id filtering takes absolute priority
  if (target.length === 10) {
    return transactions.filter(tx => {
      const milkId = String(tx.milk_session_id || '').trim().toUpperCase();
      return milkId === target;
    });
  }

  return transactions.filter(tx => {
    const milkId = String(tx.milk_session_id || '').trim().toUpperCase();
    if (milkId && milkId === target) return true;

    if (orgtype === 'D') {
      let sessionTarget = target;
      if (['MO', 'MORNING', 'AM'].includes(target)) sessionTarget = 'AM';
      else if (['AF', 'AFTERNOON', 'PM', 'EV', 'EVE', 'EVENING'].includes(target)) sessionTarget = 'PM';

      const sess = String(tx.session || '').trim().toUpperCase();
      const can = String(tx.season_code || '').trim().toUpperCase();
      return sess === sessionTarget || can === sessionTarget;
    }

    const can = String(tx.season_code || '').trim().toUpperCase();
    const sess = String(tx.session || '').trim().toUpperCase();
    return can === target || sess === target;
  });
};

/**
 * Resolve a display label for the selected period using the cached
 * sessions list. Falls back to the SCODE itself, then to 'All Z'.
 */
export const getPeriodDisplayLabel = (
  period: ZReportPeriod,
  sessions: SessionOptionInput[] = [],
): string => {
  if (!period || period === 'all') return 'All Z';
  const target = String(period).trim().toUpperCase();
  const match = sessions.find(s => String(s?.SCODE || '').trim().toUpperCase() === target);
  if (match?.descript) return `${match.descript} Z`;
  return `${period} Z`;
};
