/**
 * Image compression utility
 * Compresses images to a target size (~100KB) for faster uploads
 */

const TARGET_SIZE_KB = 100;
const MAX_DIMENSION = 800; // Max width/height in pixels
const MIN_QUALITY = 0.3;
const MAX_QUALITY = 0.85;

/**
 * Compress an image blob to approximately the target size
 * Uses iterative quality reduction to achieve target
 */
export const compressImage = async (
  blob: Blob,
  targetSizeKB: number = TARGET_SIZE_KB
): Promise<Blob> => {
  // If already small enough, return as-is
  if (blob.size <= targetSizeKB * 1024) {
    console.log(`📷 Image already small enough: ${(blob.size / 1024).toFixed(1)}KB`);
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = async () => {
      URL.revokeObjectURL(url);

      try {
        // Calculate new dimensions while maintaining aspect ratio
        let { width, height } = img;
        
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas for resizing
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);

        // Binary search for optimal quality to hit target size
        let minQuality = MIN_QUALITY;
        let maxQuality = MAX_QUALITY;
        let bestBlob: Blob | null = null;
        let iterations = 0;
        const maxIterations = 6;

        while (iterations < maxIterations) {
          const quality = (minQuality + maxQuality) / 2;
          
          const compressedBlob = await new Promise<Blob>((res, rej) => {
            canvas.toBlob(
              (b) => b ? res(b) : rej(new Error('Compression failed')),
              'image/jpeg',
              quality
            );
          });

          const sizeKB = compressedBlob.size / 1024;
          
          if (sizeKB <= targetSizeKB) {
            bestBlob = compressedBlob;
            minQuality = quality; // Try higher quality
          } else {
            maxQuality = quality; // Try lower quality
          }

          iterations++;

          // Close enough - stop early
          if (Math.abs(sizeKB - targetSizeKB) < 10) {
            bestBlob = compressedBlob;
            break;
          }
        }

        // If still too big after iterations, use minimum quality
        if (!bestBlob || bestBlob.size > targetSizeKB * 1024 * 1.5) {
          bestBlob = await new Promise<Blob>((res, rej) => {
            canvas.toBlob(
              (b) => b ? res(b) : rej(new Error('Final compression failed')),
              'image/jpeg',
              MIN_QUALITY
            );
          });
        }

        const finalSizeKB = (bestBlob.size / 1024).toFixed(1);
        const originalSizeKB = (blob.size / 1024).toFixed(1);
        console.log(`📷 Compressed: ${originalSizeKB}KB → ${finalSizeKB}KB (${width}x${height})`);
        
        resolve(bestBlob);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
};

/**
 * Compress a base64 image string
 */
export const compressBase64Image = async (
  base64: string,
  targetSizeKB: number = TARGET_SIZE_KB
): Promise<string> => {
  // Convert base64 to blob
  const response = await fetch(base64);
  const blob = await response.blob();
  
  // Compress
  const compressedBlob = await compressImage(blob, targetSizeKB);
  
  // Convert back to base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(compressedBlob);
  });
};
