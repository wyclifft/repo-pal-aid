import { AlertTriangle, CheckCircle, WifiOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';

export type DuplicateDeliveryReason = 'blacklist' | 'queue' | 'session-submitted';

interface DuplicateDeliveryDialogProps {
  open: boolean;
  farmer: { id: string; name: string } | null;
  sessionLabel?: string;
  reason?: DuplicateDeliveryReason;
  route?: string;
  device?: string;
  date?: string;
  onConfirmSync?: () => void;
  onClose: () => void;
}

export const DuplicateDeliveryDialog = ({
  open,
  farmer,
  sessionLabel,
  reason,
  route,
  device,
  date,
  onConfirmSync,
  onClose,
}: DuplicateDeliveryDialogProps) => {
  const { isOnline } = useOfflineStatus();

  const farmerName = farmer?.name ? `${farmer.name} (${farmer.id})` : `Member ${farmer?.id ?? ''}`;
  const displayRoute = route || 'N/A';
  const displayDevice = device || 'N/A';

  const handleConfirm = () => {
    if (onConfirmSync) {
      onConfirmSync();
    }
    onClose();
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md border-2 border-amber-400 p-5 rounded-xl">
        <AlertDialogHeader className="text-center sm:text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
          </div>
          <AlertDialogTitle className="text-lg font-bold text-gray-900">
            Member Has Delivered This Session
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="py-2">
          <div className="bg-amber-50/90 border border-amber-200 rounded-lg p-3 text-center">
            <p className="text-sm font-semibold text-gray-800 leading-relaxed">
              {farmerName} has already delivered this session on Route: <span className="text-amber-800 font-bold">{displayRoute}</span>, Device: <span className="text-amber-800 font-bold">{displayDevice}</span>.
            </p>
          </div>
        </div>

        {!isOnline && (
          <div className="flex items-center justify-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2 text-center">
            <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
            <span>You're offline. Earlier delivery is saved locally.</span>
          </div>
        )}

        <AlertDialogFooter className="mt-2">
          <AlertDialogAction
            onClick={handleConfirm}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white min-h-[44px] font-semibold text-sm flex items-center justify-center gap-1.5 rounded-lg shadow-sm"
          >
            <CheckCircle className="w-4 h-4" />
            Confirm & Resolve Sync
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

