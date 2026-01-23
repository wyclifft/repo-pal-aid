import { useCallback, useRef, useEffect } from 'react';
import { API_CONFIG } from '@/config/api';

interface PhotoUploadTask {
  id: string;
  uploadrefno: string;
  photoBlob: Blob;
  retryCount: number;
  timestamp: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Hook for background photo uploads that don't block transactions.
 * Photos are queued and uploaded asynchronously after transactions complete.
 */
export const useBackgroundPhotoUpload = () => {
  const uploadQueueRef = useRef<PhotoUploadTask[]>([]);
  const isProcessingRef = useRef(false);
  const processingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Convert blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Upload a single photo to the backend
  const uploadPhoto = async (task: PhotoUploadTask): Promise<boolean> => {
    try {
      const photoBase64 = await blobToBase64(task.photoBlob);
      
      const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/photos/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadrefno: task.uploadrefno,
          photo: photoBase64,
        }),
      });

      if (!response.ok) {
        console.warn(`[PHOTO] Upload failed for ${task.uploadrefno}: ${response.status}`);
        return false;
      }

      const result = await response.json();
      if (result.success) {
        console.log(`[PHOTO] Successfully uploaded photo for ${task.uploadrefno}`);
        return true;
      }
      
      console.warn(`[PHOTO] Upload returned error for ${task.uploadrefno}:`, result.error);
      return false;
    } catch (error) {
      console.error(`[PHOTO] Upload error for ${task.uploadrefno}:`, error);
      return false;
    }
  };

  // Process the upload queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || uploadQueueRef.current.length === 0) {
      return;
    }

    // Only process when online
    if (!navigator.onLine) {
      console.log('[PHOTO] Offline, skipping queue processing');
      return;
    }

    isProcessingRef.current = true;

    const queue = [...uploadQueueRef.current];
    const completedIds: string[] = [];
    const failedTasks: PhotoUploadTask[] = [];

    for (const task of queue) {
      const success = await uploadPhoto(task);
      
      if (success) {
        completedIds.push(task.id);
        // Release the blob URL if it was created from object URL
        URL.revokeObjectURL(URL.createObjectURL(task.photoBlob));
      } else if (task.retryCount < MAX_RETRIES) {
        failedTasks.push({
          ...task,
          retryCount: task.retryCount + 1,
        });
      } else {
        console.error(`[PHOTO] Max retries exceeded for ${task.uploadrefno}, discarding`);
        completedIds.push(task.id);
      }
    }

    // Update queue: remove completed, keep/update failed
    uploadQueueRef.current = [
      ...uploadQueueRef.current.filter(t => !completedIds.includes(t.id) && !queue.find(q => q.id === t.id)),
      ...failedTasks,
    ];

    isProcessingRef.current = false;

    // If there are still items in queue, schedule retry
    if (uploadQueueRef.current.length > 0) {
      setTimeout(() => processQueue(), RETRY_DELAY_MS);
    }
  }, []);

  // Add photo to upload queue
  const queuePhotoUpload = useCallback((uploadrefno: string, photoBlob: Blob) => {
    const task: PhotoUploadTask = {
      id: `${uploadrefno}-${Date.now()}`,
      uploadrefno,
      photoBlob,
      retryCount: 0,
      timestamp: Date.now(),
    };

    uploadQueueRef.current.push(task);
    console.log(`[PHOTO] Queued photo for background upload: ${uploadrefno}`);

    // Start processing after a short delay to allow transaction to complete first
    setTimeout(() => processQueue(), 500);
  }, [processQueue]);

  // Process queue when coming back online
  useEffect(() => {
    const handleOnline = () => {
      console.log('[PHOTO] Back online, processing photo queue');
      processQueue();
    };

    window.addEventListener('online', handleOnline);
    
    // Also start periodic processing every 30 seconds
    processingIntervalRef.current = setInterval(() => {
      if (navigator.onLine && uploadQueueRef.current.length > 0) {
        processQueue();
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
      }
    };
  }, [processQueue]);

  // Get pending upload count
  const getPendingCount = useCallback(() => {
    return uploadQueueRef.current.length;
  }, []);

  return {
    queuePhotoUpload,
    processQueue,
    getPendingCount,
  };
};
