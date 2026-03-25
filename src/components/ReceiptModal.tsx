// Re-export unified TransactionReceipt for backward compatibility
// This file now wraps the unified component for milk collection receipts

import type { MilkCollection } from '@/lib/supabase';
import { TransactionReceipt, createMilkReceiptData } from './TransactionReceipt';

interface ReceiptModalProps {
  receipts: MilkCollection[];
  companyName: string;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
  cumulativeFrequency?: number;
  showCumulativeFrequency?: boolean;
  printCopies?: number;
  routeLabel?: string;
  periodLabel?: string;
  locationCode?: string;
  locationName?: string;
}

export const ReceiptModal = ({ 
  receipts, 
  companyName, 
  open, 
  onClose, 
  onPrint,
  cumulativeFrequency,
  showCumulativeFrequency = false,
  printCopies = 1,
  routeLabel = 'Route',
  periodLabel = 'Session',
  locationCode,
  locationName
}: ReceiptModalProps) => {
  // Convert MilkCollection[] to unified ReceiptData format
  const receiptData = createMilkReceiptData(receipts, companyName, {
    cumulativeFrequency,
    showCumulativeFrequency,
    printCopies,
    routeLabel,
    periodLabel,
    locationCode,
    locationName
  });

  return (
    <TransactionReceipt
      data={receiptData}
      open={open}
      onClose={onClose}
      onPrint={onPrint}
    />
  );
};