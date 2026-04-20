import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, X, RotateCcw, Check, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
// Lazy-load @capacitor/camera to avoid eager Proxy resolution on Android startup
// (which caused "Camera.then() is not implemented on android" unhandled rejections).
// v2.10.48: Removed static enum imports (CameraResultType/Source/Direction) — they
// triggered the same Proxy `then` trap. Use string literals instead.
import type { Camera as CapacitorCameraType } from '@capacitor/camera';
import { compressImage } from '@/utils/imageCompression';

const loadCapacitorCamera = async (): Promise<typeof CapacitorCameraType | null> => {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import('@capacitor/camera');
    return mod.Camera;
  } catch (e) {
    console.warn('📷 Failed to lazy-load @capacitor/camera:', e);
    return null;
  }
};

interface PhotoCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (imageBlob: Blob, previewUrl: string) => void;
  title?: string;
  /** Target compressed size in KB (default: 100) */
  targetSizeKB?: number;
}

// Module-level flag to survive Android activity recreation (React re-mounts)
// Prevents the native camera from triggering twice when the WebView is destroyed/recreated
let nativeCaptureInProgress = false;

const PhotoCapture = ({ open, onClose, onCapture, title = 'Capture Buyer Photo', targetSizeKB = 100 }: PhotoCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [useNativeCamera, setUseNativeCamera] = useState(false);

  // Check if we should use native camera on mount
  useEffect(() => {
    setUseNativeCamera(Capacitor.isNativePlatform());
  }, []);

  // Start camera when dialog opens (web only)
  useEffect(() => {
    if (open && !useNativeCamera) {
      startWebCamera();
    } else if (open && useNativeCamera) {
      // Use module-level flag to prevent double trigger on Android activity recreation
      if (!nativeCaptureInProgress) {
        nativeCaptureInProgress = true;
        captureWithNativeCamera();
      }
    } else {
      // Dialog closed - reset state
      nativeCaptureInProgress = false;
      stopCamera();
      setCapturedImage(null);
      setCapturedBlob(null);
      setCameraError(null);
    }
    
    return () => {
      stopCamera();
    };
  }, [open, useNativeCamera]); // Remove facingMode from dependencies for native camera

  // Request camera permission and capture using Capacitor Camera plugin
  const captureWithNativeCamera = async () => {
    setIsLoading(true);
    setCameraError(null);
    
    try {
      // Lazy-load native camera plugin (returns null on web / when unavailable)
      const CapacitorCamera = await loadCapacitorCamera();
      if (!CapacitorCamera) {
        console.warn('📷 Native camera plugin unavailable, falling back to web camera');
        toast.info('Using in-app camera');
        nativeCaptureInProgress = false;
        setUseNativeCamera(false);
        setIsLoading(false);
        return;
      }

      // First, request camera permissions explicitly
      const permStatus = await CapacitorCamera.requestPermissions({ permissions: ['camera'] });
      console.log('Camera permission status:', permStatus);
      
      if (permStatus.camera === 'denied') {
        // Native permission denied — fall back to web camera instead of blocking
        console.warn('📷 Native camera permission denied, falling back to web camera');
        toast.info('Using in-app camera');
        nativeCaptureInProgress = false;
        setUseNativeCamera(false);
        setIsLoading(false);
        return;
      }
      
      // Take photo using native camera
      const photo = await CapacitorCamera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: 'dataUrl' as any,
        source: 'CAMERA' as any,
        direction: (facingMode === 'user' ? 'FRONT' : 'REAR') as any,
        correctOrientation: true,
        saveToGallery: false,
      });
      
      if (photo.dataUrl) {
        // Process the photo — separate try/catch so camera errors vs processing errors are distinct
        try {
          // Memory-efficient: use fetch() to convert dataUrl to blob (single native allocation)
          const fetchResponse = await fetch(photo.dataUrl);
          const originalBlob = await fetchResponse.blob();
          
          if (originalBlob.size === 0) {
            console.error('Empty photo captured');
            setCameraError('Empty photo captured. Please try again.');
            return;
          }
          
          // Compress the image to target size with memory-safe fallback
          setIsCompressing(true);
          try {
            const compressedBlob = await compressImage(originalBlob, targetSizeKB);
            const previewUrl = URL.createObjectURL(compressedBlob);
            setCapturedBlob(compressedBlob);
            setCapturedImage(previewUrl);
            console.log(`📷 Photo compressed: ${(originalBlob.size / 1024).toFixed(1)}KB → ${(compressedBlob.size / 1024).toFixed(1)}KB`);
          } catch (compressError) {
            console.warn('📷 Compression failed, trying smaller canvas:', compressError);
            try {
              const smallBlob = await compressImage(originalBlob, targetSizeKB * 1.5);
              const previewUrl = URL.createObjectURL(smallBlob);
              setCapturedBlob(smallBlob);
              setCapturedImage(previewUrl);
            } catch (fallbackError) {
              console.warn('📷 All compression failed, using original:', fallbackError);
              const previewUrl = URL.createObjectURL(originalBlob);
              setCapturedBlob(originalBlob);
              setCapturedImage(previewUrl);
            }
          } finally {
            setIsCompressing(false);
          }
        } catch (processError) {
          console.error('📷 Photo processing error:', processError);
          setCameraError('Failed to process photo. Please retake.');
          return;
        }
      }
    } catch (error: any) {
      console.error('Native camera error:', error);
      if (error.message?.includes('cancelled') || error.message?.includes('canceled')) {
        nativeCaptureInProgress = false;
        onClose();
        return;
      }
      // No system camera app or intent failure — fall back to web camera
      console.warn('📷 Native camera unavailable, falling back to web camera:', error.message);
      toast.info('Using in-app camera');
      nativeCaptureInProgress = false;
      setUseNativeCamera(false);
    } finally {
      setIsLoading(false);
      nativeCaptureInProgress = false;
    }
  };

  const startWebCamera = async () => {
    setIsLoading(true);
    setCameraError(null);
    
    try {
      // Stop any existing stream first
      stopCamera();
      
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr: any) {
        // Retry with minimal constraints as fallback
        console.warn('📷 getUserMedia failed with full constraints, retrying minimal:', firstErr.message);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permission in your device settings.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError('Failed to access camera. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const switchCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to blob first at high quality
    canvas.toBlob(async (originalBlob) => {
      if (originalBlob) {
        stopCamera();
        
        // Compress the image
        setIsCompressing(true);
        try {
          const compressedBlob = await compressImage(originalBlob, targetSizeKB);
          const previewUrl = URL.createObjectURL(compressedBlob);
          setCapturedBlob(compressedBlob);
          setCapturedImage(previewUrl);
          console.log(`📷 Photo compressed: ${(originalBlob.size / 1024).toFixed(1)}KB → ${(compressedBlob.size / 1024).toFixed(1)}KB`);
        } catch (compressError) {
          console.warn('Compression failed, using original:', compressError);
          const previewUrl = URL.createObjectURL(originalBlob);
          setCapturedBlob(originalBlob);
          setCapturedImage(previewUrl);
        } finally {
          setIsCompressing(false);
        }
      }
    }, 'image/jpeg', 0.92);
  }, [targetSizeKB]);

  const retakePhoto = () => {
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
    }
    setCapturedImage(null);
    setCapturedBlob(null);
    if (useNativeCamera) {
      captureWithNativeCamera();
    } else {
      startWebCamera();
    }
  };

  const confirmPhoto = () => {
    if (capturedBlob && capturedImage) {
      onCapture(capturedBlob, capturedImage);
      onClose();
    } else {
      toast.error('No photo captured');
    }
  };

  const handleClose = () => {
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
    }
    stopCamera();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 bg-[#5E35B1] text-white">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <button onClick={handleClose} className="p-1 hover:bg-white/20 rounded">
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="relative bg-black aspect-[4/3] min-h-[300px]">
          {/* Camera preview or captured image */}
          {capturedImage ? (
            <img 
              src={capturedImage} 
              alt="Captured" 
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted
                className="w-full h-full object-cover"
                style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
              />
              
              {/* Loading/compressing overlay */}
              {(isLoading || isCompressing) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-white text-center">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto mb-2" />
                    <p>{isCompressing ? 'Optimizing photo...' : 'Starting camera...'}</p>
                  </div>
                </div>
              )}
              
              {/* Error overlay */}
              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
                  <div className="text-white text-center">
                    <Camera className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{cameraError}</p>
                    <Button 
                      onClick={useNativeCamera ? captureWithNativeCamera : startWebCamera} 
                      variant="outline" 
                      className="mt-4 text-black"
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Canvas for capturing (hidden) */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controls */}
        <div className="p-4 bg-gray-100">
          {capturedImage ? (
            <div className="flex gap-3 justify-center">
              <Button 
                onClick={retakePhoto}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Retake
              </Button>
              <Button 
                onClick={confirmPhoto}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
              >
                <Check className="h-4 w-4" />
                Use Photo
              </Button>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <Button 
                onClick={switchCamera}
                variant="outline"
                disabled={isLoading || !!cameraError}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Switch
              </Button>
              <Button 
                onClick={capturePhoto}
                disabled={isLoading || !!cameraError}
                className="flex items-center gap-2 bg-[#E53935] hover:bg-[#D32F2F] px-8"
              >
                <Camera className="h-5 w-5" />
                Capture
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhotoCapture;
