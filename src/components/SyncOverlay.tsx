import { Loader2, Database, Users, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface SyncOverlayProps {
  isVisible: boolean;
  status: string;
  progress: number; // 0-100
  subCount?: number;
  subLabel?: string;
}

export const SyncOverlay = ({
  isVisible,
  status,
  progress,
  subCount,
  subLabel = 'Items'
}: SyncOverlayProps) => {
  if (!isVisible) return null;

  // Icon selector based on status keywords
  const getIcon = () => {
    const s = status.toLowerCase();
    if (s.includes('farmer')) return <Users className="h-6 w-6 text-white/70" />;
    if (s.includes('total') || s.includes('cumulative')) return <TrendingUp className="h-6 w-6 text-white/70" />;
    if (s.includes('complete')) return <CheckCircle2 className="h-6 w-6 text-primary-foreground" />;
    return <Database className="h-6 w-6 text-white/70" />;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-[#1A1F2C] border border-white/10 rounded-2xl p-8 shadow-2xl w-full max-w-[320px] text-center space-y-6">
        {/* Animated Icon & Title */}
        <div className="space-y-4">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
            <div className="relative bg-white/10 p-4 rounded-full">
              {progress < 100 ? (
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-green-500 animate-bounce" />
              )}
            </div>
          </div>
          <h2 className="text-white text-xl font-bold tracking-tight">
            {progress < 100 ? 'Synchronizing Data' : 'Sync Complete'}
          </h2>
        </div>

        {/* Progress Bar & Status */}
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-white/50 px-1 font-medium uppercase tracking-wider">
            <span>{status}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-white/10" indicatorClassName="bg-white" />
        </div>

        {/* Sub-counts (e.g. Farmers: 1,250) */}
        {subCount !== undefined && subCount > 0 && (
          <div className="bg-white/5 rounded-xl py-4 px-2 flex items-center justify-center gap-3 border border-white/5">
            {getIcon()}
            <div className="text-left">
              <p className="text-2xl font-bold text-white leading-none">{subCount.toLocaleString()}</p>
              <p className="text-[10px] font-medium text-white/40 uppercase mt-1 tracking-widest">{subLabel}</p>
            </div>
          </div>
        )}

        {/* Footer Note */}
        <p className="text-[10px] text-white/30 italic">
          {progress < 100
            ? "Please don't close the app while syncing..."
            : "Starting your session..."}
        </p>
      </div>
    </div>
  );
};
