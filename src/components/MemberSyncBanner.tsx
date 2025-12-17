import { Loader2 } from 'lucide-react';

interface MemberSyncBannerProps {
  isVisible: boolean;
  syncedCount: number;
  message?: string;
}

export const MemberSyncBanner = ({ isVisible, syncedCount, message = 'Syncing Members ...' }: MemberSyncBannerProps) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-[#2D3559] rounded-xl px-8 py-6 shadow-2xl min-w-[200px] text-center">
        <p className="text-white text-lg font-medium mb-4">{message}</p>
        <div className="flex justify-center mb-4">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
        <p className="text-white text-3xl font-bold">{syncedCount}</p>
      </div>
    </div>
  );
};
