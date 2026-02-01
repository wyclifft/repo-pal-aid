/**
 * Z Report Period Selector Dialog
 * Allows user to select which period's Z report to print:
 * - Morning Z
 * - Afternoon Z
 * - Evening Z
 * - All Z (combined)
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Printer, Sun, Sunset, Moon, Calendar } from 'lucide-react';

export type ZReportPeriod = 'morning' | 'afternoon' | 'evening' | 'all';

export interface ZReportPeriodOption {
  value: ZReportPeriod;
  label: string;
  description: string;
  icon: React.ReactNode;
  // Session codes to filter by (null = all)
  sessionCodes: string[] | null;
}

export const Z_REPORT_PERIODS: ZReportPeriodOption[] = [
  {
    value: 'morning',
    label: 'Morning Z',
    description: 'Morning session collections only',
    icon: <Sun className="h-5 w-5 text-yellow-600" />,
    sessionCodes: ['MO', 'AM', 'MORNING'],
  },
  {
    value: 'afternoon',
    label: 'Afternoon Z',
    description: 'Afternoon session collections only',
    icon: <Sunset className="h-5 w-5 text-orange-600" />,
    sessionCodes: ['AF', 'PM', 'AFTERNOON', 'EVE'],
  },
  {
    value: 'evening',
    label: 'Evening Z',
    description: 'Evening session collections only',
    icon: <Moon className="h-5 w-5 text-blue-600" />,
    sessionCodes: ['EV', 'EVENING', 'NIGHT'],
  },
  {
    value: 'all',
    label: 'All Z',
    description: 'All sessions combined (full day)',
    icon: <Calendar className="h-5 w-5" />,
    sessionCodes: null, // null means include all
  },
];

interface ZReportPeriodSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (period: ZReportPeriod, periodLabel: string) => void;
}

export const ZReportPeriodSelector = ({
  open,
  onClose,
  onSelect,
}: ZReportPeriodSelectorProps) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ZReportPeriod>('all');

  const handleConfirm = () => {
    const selected = Z_REPORT_PERIODS.find(p => p.value === selectedPeriod);
    onSelect(selectedPeriod, selected?.label || 'All Z');
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
            onValueChange={(value) => setSelectedPeriod(value as ZReportPeriod)}
            className="space-y-3"
          >
            {Z_REPORT_PERIODS.map((period) => (
              <div
                key={period.value}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedPeriod === period.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => setSelectedPeriod(period.value)}
              >
                <RadioGroupItem value={period.value} id={period.value} />
                <div className="flex-shrink-0">{period.icon}</div>
                <Label
                  htmlFor={period.value}
                  className="flex-1 cursor-pointer"
                >
                  <div className="font-medium">{period.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {period.description}
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

// Helper function to filter transactions by period
export const filterTransactionsByPeriod = <T extends { session?: string }>(
  transactions: T[],
  period: ZReportPeriod
): T[] => {
  if (period === 'all') {
    return transactions;
  }

  const periodOption = Z_REPORT_PERIODS.find(p => p.value === period);
  if (!periodOption || !periodOption.sessionCodes) {
    return transactions;
  }

  const sessionCodes = periodOption.sessionCodes.map(s => s.toUpperCase());
  
  return transactions.filter(tx => {
    if (!tx.session) return false;
    const txSession = tx.session.toUpperCase().trim();
    return sessionCodes.some(code => txSession.includes(code) || code.includes(txSession));
  });
};

// Helper to get period label for display
export const getPeriodDisplayLabel = (period: ZReportPeriod): string => {
  const option = Z_REPORT_PERIODS.find(p => p.value === period);
  return option?.label || 'All Z';
};
