import React from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CloseSessionConfirmDialogProps {
  open: boolean;
  currentMilkSessionId: string | null;
  nextMilkSessionId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  orgtype?: string;
}

export const CloseSessionConfirmDialog: React.FC<CloseSessionConfirmDialogProps> = ({
  open,
  currentMilkSessionId,
  nextMilkSessionId,
  onConfirm,
  onCancel,
  orgtype,
}) => {
  const isCoffee = orgtype === 'C';

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <AlertDialogContent className="max-w-md border-2 border-purple-300 bg-white shadow-2xl rounded-xl">
        <AlertDialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-2">
            <ShieldAlert className="w-6 h-6 text-[#7E57C2]" />
          </div>
          <AlertDialogTitle className="text-center text-xl font-bold text-gray-900">
            Confirm Close Session
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-sm text-gray-600">
            Are you sure you want to close this session?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!isCoffee && (
          <div className="space-y-3 py-2">
            {Boolean(currentMilkSessionId || nextMilkSessionId) && (
              <>
                {/* Current Milk Session ID Card */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-purple-700 uppercase tracking-wider mb-1">
                    Current Milk Session ID
                  </div>
                  <div className="font-mono font-bold text-lg text-purple-950 tracking-wider">
                    {currentMilkSessionId || 'N/A'}
                  </div>
                </div>

                {/* Transition indicator */}
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-gray-500 py-1">
                  <span>Closing Current</span>
                  <ArrowRight className="w-4 h-4 text-[#7E57C2]" />
                  <span>Next Session</span>
                </div>

                {/* Next Milk Session ID Card */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-1">
                    Next Milk Session ID
                  </div>
                  <div className="font-mono font-bold text-lg text-emerald-950 tracking-wider">
                    {nextMilkSessionId || 'N/A'}
                  </div>
                </div>
              </>
            )}

            <p className="text-xs text-gray-500 text-center italic mt-2">
              Closing this session will finalize current collections and prepare the system for the next session window.
            </p>
          </div>
        )}

        <AlertDialogFooter className="flex gap-2 sm:gap-2">
          <AlertDialogCancel
            onClick={onCancel}
            className="flex-1 border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold py-2.5"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="flex-1 bg-[#7E57C2] hover:bg-[#6D47B1] text-white font-bold py-2.5 shadow-md"
          >
            Yes, Close Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
