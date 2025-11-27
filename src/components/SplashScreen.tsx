import { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Show splash for 2 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      // Wait for fade out animation before calling onComplete
      setTimeout(onComplete, 300);
    }, 2000);

    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!isVisible) {
    return null;
  }

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-purple-600 via-blue-600 to-purple-700 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Animated background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_50%)]" />
      </div>

      {/* Main content */}
      <div className="relative z-10 text-center px-6 animate-fade-in">
        {/* Company Logo/Icon */}
        <div className="mb-8 animate-scale-in">
          <div className="w-24 h-24 mx-auto bg-white rounded-3xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform">
            <div className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-blue-600 bg-clip-text text-transparent">
              M
            </div>
          </div>
        </div>

        {/* Company Name */}
        <div className="mb-4 animate-slide-up">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 tracking-tight">
            MADDA SYSTEMS
          </h1>
          <div className="text-xl md:text-2xl text-white/90 font-light tracking-wide">
            LTD
          </div>
        </div>

        {/* Tagline */}
        <p className="text-white/80 text-sm md:text-base font-light mb-8 animate-fade-in-delay">
          Milk Collection Management System
        </p>

        {/* Loading indicator */}
        <div className="flex items-center justify-center gap-2 animate-fade-in-delay-2">
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>

      {/* Bottom text */}
      <div className="absolute bottom-8 text-center animate-fade-in-delay-3">
        <p className="text-white/60 text-xs">
          Powered by innovation
        </p>
      </div>
    </div>
  );
};
