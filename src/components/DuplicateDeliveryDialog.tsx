import { AlertTriangle, User, Clock, Calendar, WifiOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';

export type DuplicateDeliveryReason = 'blacklist' | 'queue' | 'session-submitted';

interface DuplicateDeliveryDialogProps {
  open: boolean;
  farmer: { id: string; name: string } | null;
  sessionLabel: string;
  reason: DuplicateDeliveryReason;
  onClose: () => void;
}

const reasonSubtext = (reason: DuplicateDeliveryReason): string => {
  switch (reason) {
    case 'queue':
      return 'Already in this session\'s capture queue (not yet submitted).';
    case 'session-submitted':
      return 'Already submitted in this session.';
    case 'blacklist':
    default:
      return 'Already submitted (synced or pending sync).';
  }
};

export const DuplicateDeliveryDialog = ({
  open,
  farmer,
  sessionLabel,
  reason,
  onClose,
}: DuplicateDeliveryDialogProps) => {
  const { isOnline } = useOfflineStatus();

  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md border-2 border-amber-400">
        <AlertDialogHeader>
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <AlertDialogTitle className="text-center text-xl">
            Already Delivered This Session
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            This farmer cannot deliver again in the same session.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          {/* Farmer card */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex items-start gap-3">
              <User className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-amber-700 font-medium">FARMER</div>
                <div className="font-bold text-base text-gray-900 truncate">
                  {farmer?.id ?? '—'}
                </div>
                <div className="text-sm text-gray-700 truncate">
                  {farmer?.name ?? ''}
                </div>
              </div>
            </div>
          </div>

          {/* Session + Date */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mb-1">
                <Clock className="w-3.5 h-3.5" />
                SESSION
              </div>
              <div className="font-semibold text-sm text-gray-900 truncate">
                {sessionLabel || '—'}
              </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mb-1">
                <Calendar className="w-3.5 h-3.5" />
                DATE
              </div>
              <div className="font-semibold text-sm text-gray-900">{today}</div>
            </div>
          </div>

          {/* Reason / policy */}
          <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            <p className="font-medium text-gray-700 mb-0.5">{reasonSubtext(reason)}</p>
            <p>
              This farmer is set to one delivery per session (multOpt=0). Capture
              is blocked until the next session.
            </p>
          </div>

          {/* Offline footnote */}
          {!isOnline && (
            <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
              <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                You're offline. The earlier delivery is saved locally and will
                sync when you reconnect.
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction
            onClick={onClose}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white min-h-[48px] text-base font-semibold"
          >
            OK, Got It
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
