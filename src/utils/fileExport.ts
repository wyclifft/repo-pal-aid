import type { MilkCollection } from '@/lib/supabase';

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

export const generateTextReport = (receipts: MilkCollection[], filename?: string) => {
  const produceLabel = getProduceLabelFromCache();
  const text = receipts
    .map(
      (r) =>
        `Farmer: ${r.farmer_name} (${r.farmer_id})\nSession: ${r.session}\nWeight: ${r.weight} Kg\nDate: ${new Date(r.collection_date).toLocaleString()}\n---`
    )
    .join('\n\n');

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${produceLabel}-collection-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

export const generateCSVReport = (receipts: MilkCollection[], filename?: string) => {
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

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${produceLabel}-collection-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
