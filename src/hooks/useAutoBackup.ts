import { useState, useEffect, useCallback } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';

interface BackupSettings {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly';
  format: 'txt' | 'csv' | 'both';
  lastBackup: string | null;
}

const DEFAULT_SETTINGS: BackupSettings = {
  enabled: false,
  frequency: 'daily',
  format: 'both',
  lastBackup: null,
};

const STORAGE_KEY = 'autoBackupSettings';

export const useAutoBackup = () => {
  const [settings, setSettings] = useState<BackupSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const { getUnsyncedReceipts, getUnsyncedSales, isReady } = useIndexedDB();

  // Save settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save backup settings:', err);
    }
  }, [settings]);

  // Calculate next backup time based on frequency
  const getNextBackupTime = useCallback((lastBackup: string | null, frequency: string): number => {
    if (!lastBackup) return Date.now();
    
    const lastBackupTime = new Date(lastBackup).getTime();
    const now = Date.now();
    
    const intervals = {
      hourly: 60 * 60 * 1000,        // 1 hour
      daily: 24 * 60 * 60 * 1000,    // 24 hours
      weekly: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    
    const interval = intervals[frequency as keyof typeof intervals] || intervals.daily;
    const nextBackup = lastBackupTime + interval;
    
    return Math.max(nextBackup, now);
  }, []);

  // Perform backup
  const performBackup = useCallback(async (silent = false) => {
    if (!isReady) {
      console.warn('IndexedDB not ready for backup');
      return false;
    }

    try {
      const [receipts, sales] = await Promise.all([
        getUnsyncedReceipts(),
        getUnsyncedSales()
      ]);

      const totalPending = receipts.length + sales.length;

      if (totalPending === 0) {
        if (!silent) {
          toast.info('No pending data to backup');
        }
        console.log('📦 Auto-backup: No pending data');
        return true;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];

      // Export based on format settings
      if (settings.format === 'txt' || settings.format === 'both') {
        if (receipts.length > 0) {
          generateTextReport(receipts, `backup-receipts-${timestamp}.txt`);
        }
      }

      if (settings.format === 'csv' || settings.format === 'both') {
        if (receipts.length > 0) {
          generateCSVReport(receipts, `backup-receipts-${timestamp}.csv`);
        }
      }

      // Update last backup time
      const newSettings = {
        ...settings,
        lastBackup: new Date().toISOString()
      };
      setSettings(newSettings);

      if (!silent) {
        toast.success(`Backup completed: ${totalPending} pending items`);
      }

      console.log(`📦 Auto-backup completed: ${receipts.length} receipts, ${sales.length} sales`);
      return true;
    } catch (err) {
      console.error('Backup failed:', err);
      if (!silent) {
        toast.error('Backup failed');
      }
      return false;
    }
  }, [isReady, settings, getUnsyncedReceipts, getUnsyncedSales]);

  // Auto-backup interval
  useEffect(() => {
    if (!settings.enabled || !isReady) return;

    const checkAndBackup = async () => {
      const nextBackupTime = getNextBackupTime(settings.lastBackup, settings.frequency);
      const now = Date.now();

      if (now >= nextBackupTime) {
        console.log('📦 Auto-backup triggered');
        await performBackup(true); // Silent backup
      }
    };

    // Check immediately on mount
    checkAndBackup();

    // Check every hour if backup is needed
    const interval = setInterval(checkAndBackup, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [settings.enabled, settings.lastBackup, settings.frequency, isReady, getNextBackupTime, performBackup]);

  const updateSettings = useCallback((updates: Partial<BackupSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const getTimeUntilNextBackup = useCallback((): string => {
    if (!settings.enabled || !settings.lastBackup) return 'Not scheduled';

    const nextBackupTime = getNextBackupTime(settings.lastBackup, settings.frequency);
    const now = Date.now();
    const diff = nextBackupTime - now;

    if (diff <= 0) return 'Due now';

    const hours = Math.floor(diff / (60 * 60 * 1000));
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return 'Less than 1 hour';
  }, [settings, getNextBackupTime]);

  return {
    settings,
    updateSettings,
    performBackup,
    getTimeUntilNextBackup,
  };
};
