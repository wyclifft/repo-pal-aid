import { AlertTriangle, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
 * Dialog shown when the user's selected session/season has expired.
 * Forces user to select an active session before continuing data entry.
 * Note: This does NOT block data syncing - only data ENTRY.
 */
export const SessionExpiredDialog = ({
  open,
  sessionName,
  periodLabel = 'Session',
  pendingCount = 0,
  onSelectSession,
}: SessionExpiredDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={() => {/* Prevent closing by clicking outside */}}>
      <DialogContent 
        className="max-w-md mx-auto" 
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <DialogTitle className="text-xl font-bold text-gray-900">
            {periodLabel} Expired
          </DialogTitle>
          <DialogDescription className="text-gray-600 mt-2">
            {sessionName ? (
              <>
                The <strong>{sessionName}</strong> {periodLabel.toLowerCase()} has ended.
              </>
            ) : (
              <>
                Your selected {periodLabel.toLowerCase()} has ended.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Info about what this means */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-800 mb-1">
                  Data entry is paused
                </p>
                <p>
                  You must select an active {periodLabel.toLowerCase()} to continue 
                  capturing new collections.
                </p>
              </div>
            </div>
          </div>

          {/* Pending sync note */}
          {pendingCount > 0 && (
            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
              <p className="font-medium mb-1">
                ✓ Pending data is safe
              </p>
              <p className="text-blue-600">
                Your {pendingCount} pending record{pendingCount !== 1 ? 's' : ''} will 
                continue syncing in the background. No data will be lost.
              </p>
            </div>
          )}

          {/* Action button */}
          <Button
            onClick={onSelectSession}
            className="w-full py-6 text-lg font-semibold bg-[#26A69A] hover:bg-[#1E8E82]"
          >
            Select Active {periodLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
