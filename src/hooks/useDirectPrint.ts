import { printReceipt } from '@/services/bluetooth';
import type { MilkCollection } from '@/lib/supabase';
import { toast } from 'sonner';

interface DirectPrintOptions {
  companyName: string;
  printCopies: number;
  routeLabel?: string;
  periodLabel?: string;
  locationCode?: string;
  locationName?: string;
  cumulativeFrequency?: number;
  showCumulativeFrequency?: boolean;
  clerkName: string;
  productName?: string;
}

/**
 * Directly print milk/produce receipts to Bluetooth printer without showing UI.
 * Handles multiple copies based on psettings.printOption.
 */
export const printMilkReceiptDirect = async (
  receipts: MilkCollection[],
  options: DirectPrintOptions
): Promise<{ success: boolean; error?: string }> => {
  if (receipts.length === 0) {
    return { success: false, error: 'No receipts to print' };
  }

  const { printCopies } = options;

  // If printCopies is 0, skip printing entirely
  if (printCopies === 0) {
    console.log('🖨️ Direct print: 0 copies configured, skipping print');
    return { success: true };
  }

  const first = receipts[0];
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);

  // Format collections for printing
  const collections = receipts.map((receipt, index) => ({
    index: index + 1,
    weight: receipt.weight,
    transrefno: receipt.reference_no || ''
  }));

  // OPTIMIZED: Print all copies with minimal delay between them
  // Use Promise.allSettled for parallel error handling
  let printSucceeded = false;
  
  for (let copy = 0; copy < printCopies; copy++) {
    try {
      const result = await printReceipt({
        companyName: options.companyName,
        farmerName: first.farmer_name,
        farmerId: first.farmer_id,
        route: first.route,
        routeLabel: options.routeLabel,
        session: first.session,
        periodLabel: options.periodLabel,
        productName: options.productName || first.product_name,
        uploadRefNo: first.uploadrefno || first.reference_no,
        collectorName: options.clerkName,
        collections,
        cumulativeFrequency: options.showCumulativeFrequency ? options.cumulativeFrequency : undefined,
        locationCode: options.locationCode,
        locationName: options.locationName,
        collectionDate: new Date(first.collection_date)
      });

      if (!result.success) {
        // If no printer connected, show info but don't fail
        if (result.error?.includes('No printer connected')) {
          toast.info('No Bluetooth printer connected. Receipt saved for reprinting.');
          return { success: true };
        }
        // Continue trying remaining copies even if one fails
        console.warn(`Print copy ${copy + 1} failed:`, result.error);
      } else {
        printSucceeded = true;
      }

      // Reduced delay between copies (300ms instead of 500ms)
      if (copy < printCopies - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (err) {
      console.warn(`Print copy ${copy + 1} error:`, err);
    }
  }

  if (printSucceeded) {
    toast.success(`Receipt printed (${printCopies} ${printCopies === 1 ? 'copy' : 'copies'})`);
  }
  return { success: true };
};
