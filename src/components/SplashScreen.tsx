import { useEffect, useState, memo, useRef, useCallback } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

interface DiagnosticInfo {
  webViewVersion: string;
  capacitorStatus: string;
  pluginStatus: string;
  userAgent: string;
  platform: string;
}

const getDiagnostics = async (): Promise<DiagnosticInfo> => {
  const ua = navigator.userAgent;
  
  // Extract Chrome/WebView version
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const webViewVersion = chromeMatch ? `Chrome ${chromeMatch[1]}` : 'Unknown';

  let capacitorStatus = 'Not loaded';
  let pluginStatus = 'Not checked';
  let platform = 'web';

  try {
    const cap = (window as any).Capacitor;
    if (cap) {
      capacitorStatus = typeof cap.isNativePlatform === 'function'
        ? (cap.isNativePlatform() ? 'Native ✓' : 'Web mode')
        : 'Bridge partial';
      platform = cap.getPlatform?.() || cap.platform || 'unknown';
    } else {
      capacitorStatus = 'No bridge';
    }
  } catch {
    capacitorStatus = 'Error';
  }

  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    pluginStatus = registerPlugin ? 'Core OK ✓' : 'Core missing';
  } catch (e: any) {
    pluginStatus = `Core fail: ${e?.message?.substring(0, 60) || 'unknown'}`;
  }

  return { webViewVersion, capacitorStatus, pluginStatus, userAgent: ua.substring(0, 120), platform };
};

export const SplashScreen = memo(({ onComplete }: SplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const mountedRef = useRef(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const completeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasCompletedRef = useRef(false);
  const [showDiag, setShowDiag] = useState(false);
  const [diagInfo, setDiagInfo] = useState<DiagnosticInfo | null>(null);
  const longPressRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current || hasCompletedRef.current) return;
      setIsVisible(false);
      completeTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || hasCompletedRef.current) return;
        hasCompletedRef.current = true;
        onComplete();
      }, 200);
    }, 1000);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    };
  }, [onComplete]);

  useEffect(() => {
    return () => {
      if (!hasCompletedRef.current) {
        hasCompletedRef.current = true;
        setTimeout(() => onComplete(), 0);
      }
    };
  }, [onComplete]);

  const handleLogoTouchStart = useCallback(() => {
    longPressRef.current = setTimeout(async () => {
      // Stop splash from completing while viewing diagnostics
      if (timerRef.current) clearTimeout(timerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      
      const info = await getDiagnostics();
      if (mountedRef.current) {
        setDiagInfo(info);
        setShowDiag(true);
      }
    }, 1500);
  }, []);

  const handleLogoTouchEnd = useCallback(() => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }, []);

  const closeDiagAndContinue = useCallback(() => {
    setShowDiag(false);
    if (!hasCompletedRef.current) {
      hasCompletedRef.current = true;
      setIsVisible(false);
      setTimeout(() => onComplete(), 200);
    }
  }, [onComplete]);

  if (!isVisible && !showDiag) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-purple-600 via-blue-600 to-purple-700 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_50%)]" />
      </div>

      <div className="relative z-10 text-center px-6 animate-fade-in">
        {/* Logo - long press for diagnostics */}
        <div
          className="mb-8 animate-scale-in"
          onTouchStart={handleLogoTouchStart}
          onTouchEnd={handleLogoTouchEnd}
          onMouseDown={handleLogoTouchStart}
          onMouseUp={handleLogoTouchEnd}
          onMouseLeave={handleLogoTouchEnd}
        >
          <div className="w-24 h-24 mx-auto bg-white rounded-3xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform select-none">
            <div className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-blue-600 bg-clip-text text-transparent">
              M
            </div>
          </div>
        </div>

        <div className="mb-4 animate-slide-up">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 tracking-tight">
            MADDA SYSTEMS
          </h1>
          <div className="text-xl md:text-2xl text-white/90 font-light tracking-wide">
            LTD
          </div>
        </div>

        <p className="text-white/80 text-sm md:text-base font-light mb-8 animate-fade-in-delay">
          Milk Collection Management System
        </p>

        {!showDiag && (
          <div className="flex items-center justify-center gap-2 animate-fade-in-delay-2">
            <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      {/* Diagnostic overlay */}
      {showDiag && diagInfo && (
        <div className="absolute inset-x-4 bottom-16 z-20 bg-black/90 rounded-xl p-4 text-left text-xs text-white font-mono max-h-[60vh] overflow-y-auto">
          <h3 className="text-sm font-bold mb-3 text-yellow-400">🔧 POS Diagnostics</h3>
          <div className="space-y-1.5">
            <p><span className="text-gray-400">WebView:</span> {diagInfo.webViewVersion}</p>
            <p><span className="text-gray-400">Platform:</span> {diagInfo.platform}</p>
            <p><span className="text-gray-400">Capacitor:</span> {diagInfo.capacitorStatus}</p>
            <p><span className="text-gray-400">Core Plugin:</span> {diagInfo.pluginStatus}</p>
            <p className="break-all"><span className="text-gray-400">UA:</span> {diagInfo.userAgent}</p>
          </div>
          <button
            onClick={closeDiagAndContinue}
            className="mt-4 w-full py-2 bg-white/20 rounded-lg text-white text-sm font-semibold"
          >
            Continue to App →
          </button>
        </div>
      )}

      <div className="absolute bottom-8 text-center animate-fade-in-delay-3">
        <p className="text-white/60 text-xs">
          Powered by innovation
        </p>
      </div>
    </div>
  );
});
