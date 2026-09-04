import { UserX, User, ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface InactiveMemberDialogProps {
  open: boolean;
  farmer?: { id: string; name: string } | null;
  onClose: () => void;
}

export const InactiveMemberDialog = ({
  open,
  farmer,
  onClose,
}: InactiveMemberDialogProps) => {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md border-2 border-red-500 bg-white shadow-2xl">
        <AlertDialogHeader>
          <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-2">
            <UserX className="w-10 h-10 text-red-600" />
          </div>
          <AlertDialogTitle className="text-center text-2xl font-extrabold text-red-700">
            Member Inactive
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-base font-semibold text-gray-800">
            Contact manager for activation.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {farmer && (farmer.id || farmer.name) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 my-2">
            <div className="flex items-center gap-3">
              <User className="w-6 h-6 text-red-700 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-red-700 font-bold uppercase tracking-wider">
                  SELECTED MEMBER
                </div>
                <div className="font-bold text-lg text-gray-900 truncate">
                  {farmer.id}
                </div>
                {farmer.name && (
                  <div className="text-sm font-medium text-gray-700 truncate">
                    {farmer.name}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
          <ShieldAlert className="w-4 h-4 text-red-500 inline-block mr-1 -mt-0.5" />
          This member account is currently deactivated. No sales or produce collections are permitted.
        </div>

        <AlertDialogFooter className="mt-2">
          <AlertDialogAction
            onClick={onClose}
            className="w-full bg-red-600 hover:bg-red-700 text-white min-h-[48px] text-base font-bold shadow-md"
          >
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
