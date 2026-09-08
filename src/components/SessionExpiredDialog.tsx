import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SessionExpiredDialogProps {
  open: boolean;
  sessionName?: string;
  periodLabel?: string;
  pendingCount?: number;
  onSelectSession: () => void;
}

/**
 * Ultra-short, concise dialog shown when the selected session/season has expired.
 * Prompts the user to select an active session immediately.
 */
export const SessionExpiredDialog = ({
  open,
  sessionName,
  periodLabel = 'Session',
  onSelectSession,
}: SessionExpiredDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-sm mx-auto p-5 rounded-xl"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <DialogTitle className="text-lg font-bold text-gray-900">
            {periodLabel} Expired
          </DialogTitle>
        </DialogHeader>

        <div className="py-2 text-center text-sm text-gray-700 bg-amber-50/80 border border-amber-200 rounded-lg p-3">
          <p className="font-semibold text-gray-800">
            {sessionName ? `${sessionName} ${periodLabel.toLowerCase()} has ended.` : `Your ${periodLabel.toLowerCase()} has ended.`} Please select an active {periodLabel.toLowerCase()} to continue.
          </p>
        </div>

        <Button
          onClick={onSelectSession}
          className="w-full mt-2 py-3 text-base font-semibold bg-[#26A69A] hover:bg-[#1E8E82] text-white rounded-lg shadow-sm"
        >
          Select Active {periodLabel}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
