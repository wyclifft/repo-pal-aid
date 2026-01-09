import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, X, RotateCcw, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface PhotoCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (imageBlob: Blob, previewUrl: string) => void;
  title?: string;
}

const PhotoCapture = ({ open, onClose, onCapture, title = 'Capture Buyer Photo' }: PhotoCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  // Start camera when dialog opens
  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
      setCapturedImage(null);
      setCapturedBlob(null);
      setCameraError(null);
    }
    
    return () => {
      stopCamera();
    };
  }, [open, facingMode]);

  const startCamera = async () => {
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

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permission.');
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

  const capturePhoto = useCallback(() => {
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

    // Convert to blob
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        const previewUrl = URL.createObjectURL(blob);
        setCapturedImage(previewUrl);
        stopCamera();
      }
    }, 'image/jpeg', 0.85);
  }, []);

  const retakePhoto = () => {
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
    }
    setCapturedImage(null);
    setCapturedBlob(null);
    startCamera();
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
              
              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-white text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-white border-t-transparent mx-auto mb-2"></div>
                    <p>Starting camera...</p>
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
                      onClick={startCamera} 
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
