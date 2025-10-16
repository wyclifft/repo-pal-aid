import type { MilkCollection } from '@/lib/supabase';

export const generateTextReport = (receipts: MilkCollection[]) => {
  const text = receipts
    .map(
      (r) =>
        `Farmer: ${r.farmer_id}\nRoute: ${r.route}\nSession: ${r.session}\nWeight: ${r.weight} Kg\nDate: ${new Date(r.collection_date).toLocaleString()}\n---`
    )
    .join('\n\n');

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `milk-collection-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

export const generateCSVReport = (receipts: MilkCollection[]) => {
  const headers = ['Farmer ID', 'Route', 'Session', 'Weight (Kg)', 'Collector', 'Date'];
  const rows = receipts.map((r) => [
    r.farmer_id,
    r.route,
    r.session,
    r.weight,
    r.collected_by || '',
    new Date(r.collection_date).toLocaleString(),
  ]);

  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `milk-collection-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
