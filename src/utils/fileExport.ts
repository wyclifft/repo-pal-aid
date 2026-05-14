import type { MilkCollection } from '@/lib/supabase';
import { saveExportedFile } from './nativeFileExport';

// Helper to get produce label from localStorage settings (for non-React contexts)
const getProduceLabelFromCache = (): string => {
  try {
    const cached = localStorage.getItem('app_settings');
    if (cached) {
      const settings = JSON.parse(cached);
      return settings.orgtype === 'C' ? 'coffee' : 'milk';
    }
  } catch (e) {
    console.warn('Failed to read produce label from cache:', e);
  }
  return 'milk'; // Default to dairy
};

export const generateTextReport = async (receipts: MilkCollection[], filename?: string) => {
  const produceLabel = getProduceLabelFromCache();
  const text = receipts
    .map(
      (r) =>
        `Farmer: ${r.farmer_name} (${r.farmer_id})\nSession: ${r.session}\nWeight: ${r.weight} Kg\nDate: ${new Date(r.collection_date).toLocaleString()}\n---`
    )
    .join('\n\n');

  await saveExportedFile(
    filename || `${produceLabel}-collection-${Date.now()}.txt`,
    text,
    'text/plain'
  );
};

export const generateCSVReport = async (receipts: MilkCollection[], filename?: string) => {
  const produceLabel = getProduceLabelFromCache();
  const headers = ['Farmer ID', 'Farmer Name', 'Session', 'Weight (Kg)', 'Collector', 'Date'];
  const rows = receipts.map((r) => [
    r.farmer_id,
    r.farmer_name,
    r.session,
    r.weight,
    r.clerk_name || '',
    new Date(r.collection_date).toLocaleString(),
  ]);

  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

  await saveExportedFile(
    filename || `${produceLabel}-collection-${Date.now()}.csv`,
    csv,
    'text/csv'
  );
};
