/**
 * Z Report Type Selector Dialog (v2.10.97)
 * Lets the user choose between:
 *   - Coffee / Milk Z Report (produce)  → uses existing produce-driven Z flow
 *   - Store Z Report (store)            → independent stock-transaction report
 *
 * Only shown when the device has BOTH produce (transtype=1) AND store/AI
 * (transtype=2 or 3) transactions. When only one transtype exists the parent
 * skips this dialog and auto-selects the matching type.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { FileText, Package, Coffee, Milk } from 'lucide-react';

export type ZReportType = 'produce' | 'store';

interface ZReportTypeSelectorProps {
  open: boolean;
  produceLabel: string; // "Coffee" or "Milk" derived from orgtype
  onClose: () => void;
  onSelect: (type: ZReportType) => void;
}

export const ZReportTypeSelector = ({
  open,
  produceLabel,
  onClose,
  onSelect,
}: ZReportTypeSelectorProps) => {
  const [selected, setSelected] = useState<ZReportType>('produce');

  const handleConfirm = () => {
    onSelect(selected);
    onClose();
  };

  const produceIcon =
    produceLabel.toLowerCase() === 'coffee' ? (
      <Coffee className="h-5 w-5 text-amber-700" />
    ) : (
      <Milk className="h-5 w-5 text-blue-600" />
    );

  const options: Array<{
    value: ZReportType;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      value: 'produce',
      label: `${produceLabel} Z Report`,
      description: 'Session, produce, season, farmer deliveries, weights & totals',
      icon: produceIcon,
    },
    {
      value: 'store',
      label: 'Store Z Report',
      description: 'Stock transactions only — excludes session, produce & farmer info',
      icon: <Package className="h-5 w-5 text-emerald-700" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Select Z Report Type
          </DialogTitle>
          <DialogDescription className="text-xs">
            Choose which Z report to generate for this device.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <RadioGroup
            value={selected}
            onValueChange={(v) => setSelected(v as ZReportType)}
            className="space-y-3"
          >
            {options.map((opt) => (
              <div
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  selected === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <RadioGroupItem value={opt.value} id={`zrt-${opt.value}`} />
                <div className="flex-shrink-0">{opt.icon}</div>
                <Label htmlFor={`zrt-${opt.value}`} className="flex-1 cursor-pointer">
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
