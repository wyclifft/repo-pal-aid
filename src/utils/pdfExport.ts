import type { ZReportData, DeviceZReportData } from '@/services/mysqlApi';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

// Helper to get org settings from localStorage (for non-React contexts)
const getOrgSettingsFromCache = (): { label: string; isCoffee: boolean; weightUnit: string; weightLabel: string } => {
  try {
    const cached = localStorage.getItem('app_settings');
    if (cached) {
      const settings = JSON.parse(cached);
      const isCoffee = settings.orgtype === 'C';
      return {
        label: isCoffee ? 'COFFEE' : 'MILK',
        isCoffee,
        weightUnit: isCoffee ? 'kg' : 'L',
        weightLabel: isCoffee ? 'Kilograms' : 'Liters'
      };
    }
  } catch (e) {
    console.warn('Failed to read org settings from cache:', e);
  }
  return { label: 'MILK', isCoffee: false, weightUnit: 'L', weightLabel: 'Liters' }; // Default to dairy
};

export const printThermalZReport = (reportData: ZReportData, produceLabel?: string) => {
  const printWindow = window.open('', '', 'width=300,height=600');
  if (!printWindow) return;

  // Get org settings from cache
  const orgSettings = getOrgSettingsFromCache();
  const label = produceLabel?.toUpperCase() || orgSettings.label;
  const { isCoffee, weightUnit } = orgSettings;

  // Build session section only for dairy
  const sessionSection = isCoffee ? '' : `
      <div class="section">
        <div class="bold">BY SESSION:</div>
        <div>Morning: ${reportData.bySession.AM.entries} (${reportData.bySession.AM.liters.toFixed(2)}${weightUnit})</div>
        <div>Evening: ${reportData.bySession.PM.entries} (${reportData.bySession.PM.liters.toFixed(2)}${weightUnit})</div>
      </div>
      <div class="line"></div>`;

  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Z Report - Thermal Print</title>
      <style>
        @media print {
          @page {
            size: 58mm auto;
            margin: 0;
          }
        }
        body {
          width: 58mm;
          margin: 0;
          padding: 4mm;
          font-family: 'Courier New', monospace;
          font-size: 10pt;
          line-height: 1.3;
        }
        .center { text-align: center; }
        .line { border-top: 1px dashed #000; margin: 2mm 0; }
        .bold { font-weight: bold; }
        .title { font-size: 11pt; font-weight: bold; }
        .section { margin: 2mm 0; }
      </style>
    </head>
    <body>
      <div class="center title">${label} COLLECTION Z REPORT</div>
      <div class="line"></div>
      <div class="section">
        <div>DATE: ${new Date(reportData.date).toLocaleDateString('en-CA')}</div>
        <div>TIME: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
      </div>
      <div class="line"></div>
      <div class="section center bold">
        <div>Total Entries: ${reportData.totals.entries}</div>
        <div>Total Farmers: ${reportData.totals.farmers}</div>
        <div>Total Kgs: ${reportData.totals.liters.toFixed(2)}</div>
      </div>
      <div class="line"></div>
      ${sessionSection}
      <div class="section">
        <div class="bold">BY ${isCoffee ? 'CENTER' : 'ROUTE'}:</div>
        ${Object.entries(reportData.byRoute).map(([route, data]) => 
          `<div>${route}: ${data.total.toFixed(2)}${weightUnit}</div>`
        ).join('')}
      </div>
      <div class="line"></div>
      <div class="section">
        <div class="bold">BY COLLECTOR:</div>
        ${Object.entries(reportData.byCollector).map(([collector, data]) => 
          `<div>${collector}: ${data.liters.toFixed(2)}${weightUnit}</div>`
        ).join('')}
      </div>
      <div class="line"></div>
      <div class="center">Generated: ${new Date().toLocaleString()}</div>
    </body>
    </html>
  `;

  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
};

export const generateZReportPDF = (reportData: ZReportData, produceLabel?: string): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Get org settings from cache
      const orgSettings = getOrgSettingsFromCache();
      const label = produceLabel?.toUpperCase() || orgSettings.label;
      const { isCoffee, weightUnit, weightLabel } = orgSettings;
      
      // Build monospaced lines (also used for PDF content)
      const lines: string[] = [];
      lines.push(`${label} COLLECTION Z REPORT`);
      lines.push(`Date: ${new Date(reportData.date).toLocaleDateString()}`);
      lines.push(`Generated: ${new Date().toLocaleString()}`);
      lines.push('');
      lines.push('='.repeat(48));
      lines.push('SUMMARY');
      lines.push('='.repeat(48));
      lines.push(`Total ${weightLabel}: ${reportData.totals.liters.toFixed(2)} ${weightUnit}`);
      lines.push(`Total Farmers: ${reportData.totals.farmers}`);
      lines.push(`Total Entries: ${reportData.totals.entries}`);
      lines.push('');

      if (!isCoffee) {
        lines.push('BY SESSION');
        lines.push('='.repeat(48));
        lines.push(`Morning (AM): ${reportData.bySession.AM.entries} (${reportData.bySession.AM.liters.toFixed(2)} ${weightUnit})`);
        lines.push(`Evening (PM): ${reportData.bySession.PM.entries} (${reportData.bySession.PM.liters.toFixed(2)} ${weightUnit})`);
        lines.push('');
      }

      lines.push(`BY ${isCoffee ? 'CENTER' : 'ROUTE'}`);
      lines.push('='.repeat(48));
      Object.entries(reportData.byRoute).forEach(([route, data]) => {
        if (isCoffee) {
          lines.push(`${route}: ${data.AM.length + data.PM.length} entries, Total=${data.total.toFixed(2)} ${weightUnit}`);
        } else {
          lines.push(`${route}: AM=${data.AM.length}, PM=${data.PM.length}, Total=${data.total.toFixed(2)} ${weightUnit}`);
        }
      });
      lines.push('');

      lines.push('BY COLLECTOR');
      lines.push('='.repeat(48));
      Object.entries(reportData.byCollector).forEach(([collector, data]) => {
        lines.push(`${collector}: ${data.farmers} farmers, ${data.entries} entries, ${data.liters.toFixed(2)} ${weightUnit}`);
      });

      const fileName = `z-report-${reportData.date}.pdf`;

      // Create a real PDF (monospaced) without opening a preview window
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFont('courier', 'normal');
      doc.setFontSize(11);
      const marginX = 12;
      const marginY = 14;
      const lineHeight = 5;
      const pageHeight = doc.internal.pageSize.getHeight();

      let y = marginY;
      for (const line of lines) {
        if (y > pageHeight - marginY) {
          doc.addPage();
          y = marginY;
        }
        doc.text(line, marginX, y);
        y += lineHeight;
      }

      const pdfBlob = doc.output('blob');
      
      // Try using the File System Access API (modern browsers)
      if ('showSaveFilePicker' in window) {
        (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'PDF file',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        }).then((handle: any) => {
          return handle.createWritable();
        }).then((writable: any) => {
          return writable.write(pdfBlob).then(() => writable.close());
        }).then(() => {
          console.log('✅ File saved via File System Access API');
          resolve(true);
        }).catch((err: any) => {
          // User cancelled or API not supported - try fallback
          console.log('File System Access failed, trying fallback:', err.message);
          downloadWithFallback(pdfBlob, fileName, resolve);
        });
      } else {
        // Fallback for older browsers and mobile
        downloadWithFallback(pdfBlob, fileName, resolve);
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      resolve(false);
    }
  });
};

// Helper to convert blob to base64 safely (handles large files)
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Extract base64 part from data URL
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Fallback download method with verification - uses Web Share API on mobile
const downloadWithFallback = async (blob: Blob, fileName: string, resolve: (success: boolean) => void) => {
  try {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // On native (Capacitor) mobile, avoid window.open(blobUrl) (can black-screen/crash).
    // Save to device Downloads folder + open share sheet for direct saving.
    if (Capacitor.isNativePlatform()) {
      try {
        // Use FileReader for safer base64 encoding (handles large files better)
        const base64 = await blobToBase64(blob);
        
        // Try to save to Downloads first for direct access, fallback to Documents
        let writeRes;
        try {
          writeRes = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Documents,
            recursive: true,
          });
        } catch (dirErr) {
          console.log('Documents directory failed, trying cache:', dirErr);
          writeRes = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache,
            recursive: true,
          });
        }

        // Open native share sheet for user to save/share
        await Share.share({
          title: fileName,
          text: 'Z Report PDF',
          url: writeRes.uri,
          dialogTitle: 'Save Z Report',
        });

        console.log('✅ File saved/shared via native share:', writeRes.uri);
        resolve(true);
        return;
      } catch (nativeErr) {
        console.warn('Native save/share failed, falling back to web download:', nativeErr);
      }
    }
    
    // On mobile, use Web Share API if available - this is the most reliable way
    if (isMobile && 'share' in navigator && 'canShare' in navigator) {
      try {
        const file = new File([blob], fileName, { type: blob.type });
        const shareData = { files: [file], title: fileName };
        
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          console.log('✅ File shared/saved via Web Share API');
          resolve(true);
          return;
        }
      } catch (shareErr: any) {
        // User cancelled share or not supported - fall through to other methods
        if (shareErr.name === 'AbortError') {
          console.log('User cancelled share dialog');
          resolve(false);
          return;
        }
        console.log('Web Share API failed, trying other methods:', shareErr.message);
      }
    }
    
    // Web fallback: always use anchor-click (avoid window.open on mobile).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);

    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      console.log(`✅ File download triggered via click (${isMobile ? 'mobile' : 'desktop'})`);
      resolve(true);
    }, 700);
  } catch (err) {
    console.error('Fallback download failed:', err);
    resolve(false);
  }
};

/**
 * Generate Device-specific Z Report PDF (matches handwritten layout)
 * Header: Company, Summary Type, Season, Date, Factory, Produce
 * Body: Transaction list (MNO, REFNO, QTY, TIME)
 * Footer: Totals, Clerk, Print Time, Device Code
 */
export const generateDeviceZReportPDF = (reportData: DeviceZReportData, routeName?: string): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      const weightUnit = 'KGS';
      const formattedDate = new Date(reportData.date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const formattedTime = new Date().toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
      });
      
      // Use routeName if provided, otherwise fall back to routeLabel
      const factoryName = routeName || reportData.routeLabel || 'FACTORY';
      
      // Column helpers — header AND every data row use these widths so the
      // labels sit directly above their numbers (v2.10.74 alignment fix).
      const padL = (s: string, w: number) => (s ?? '').padEnd(w).substring(0, w);
      const padR = (s: string, w: number) => (s ?? '').padStart(w).substring(0, w);

      const lines: string[] = [];

      // Header
      lines.push(reportData.companyName.toUpperCase());
      lines.push('');
      lines.push(`* ${reportData.produceLabel.toUpperCase()} SUMMARY`);
      lines.push(`* ${reportData.periodLabel.toUpperCase()}: ${reportData.seasonName}`);
      lines.push(`* DATE: ${formattedDate}`);
      lines.push('');
      lines.push(`* ${factoryName.toUpperCase().replace(' FACTORY', '')} FACTORY`);
      lines.push('');
      lines.push(`* PRODUCE: ${reportData.produceName || reportData.produceLabel.toUpperCase()}`);
      lines.push('');

      // Group transactions by transtype (1=BUY, 2=SELL, 3=AI).
      const typeGroups = new Map<number, { label: string; rows: typeof reportData.transactions; weight: number; amount: number }>();
      for (const tx of reportData.transactions) {
        const tt = (tx as any).transtype || 1;
        const lbl = (tx as any).transTypeLabel || (tt === 2 ? 'SELL' : tt === 3 ? 'AI' : 'BUY');
        if (!typeGroups.has(tt)) typeGroups.set(tt, { label: lbl, rows: [], weight: 0, amount: 0 });
        const g = typeGroups.get(tt)!;
        g.rows.push(tx);
        g.weight += tx.weight;
        g.amount += Number((tx as any).amount || 0);
      }

      let buyWeight = 0;
      let sellAiItems = 0;
      let sellAiAmount = 0;

      // Render each section with aligned columns.
      let sectionIdx = 0;
      for (const [tt, g] of typeGroups) {
        if (sectionIdx > 0) lines.push('');
        const showMoney = tt !== 1;
        lines.push(`== ${g.label} ==`);

        if (showMoney) {
          // SELL/AI: MNO(10) REF(8) QTY(6 R) KSh(10 R) TIME(8 R) — total 46
          lines.push(`${padL('MNO',10)} ${padL('REF',8)} ${padR('QTY',6)} ${padR('KSh',10)} ${padR('TIME',8)}`);
          lines.push('-'.repeat(46));
          let groupItems = 0;
          for (const tx of g.rows) {
            const qtyInt = Math.max(0, Math.round(tx.weight || 0));
            groupItems += qtyInt;
            lines.push(
              `${padL((tx.farmer_id || '').substring(0, 10), 10)} ` +
              `${padL((tx.refno || '').slice(-8), 8)} ` +
              `${padR(String(qtyInt), 6)} ` +
              `${padR(Number((tx as any).amount || 0).toFixed(0), 10)} ` +
              `${padR((tx.time || '').substring(0, 8), 8)}`
            );
          }
          const itemsLabel = groupItems === 1 ? 'item' : 'items';
          lines.push(`${g.label} TOTAL    ${groupItems} ${itemsLabel}    KSh ${g.amount.toFixed(0)}`);
          sellAiItems += groupItems;
          sellAiAmount += g.amount;
        } else {
          // BUY: MNO(10) REF(8) AMOUNT(10 R) TIME(8 R) — total 40
          lines.push(`${padL('MNO',10)} ${padL('REF',8)} ${padR('AMOUNT',10)} ${padR('TIME',8)}`);
          lines.push('-'.repeat(40));
          for (const tx of g.rows) {
            lines.push(
              `${padL((tx.farmer_id || '').substring(0, 10), 10)} ` +
              `${padL((tx.refno || '').slice(-8), 8)} ` +
              `${padR(tx.weight.toFixed(1), 10)} ` +
              `${padR((tx.time || '').substring(0, 8), 8)}`
            );
          }
          lines.push(`${g.label} TOTAL    ${g.weight.toFixed(1)} ${weightUnit}`);
          buyWeight += g.weight;
        }
        sectionIdx++;
      }

      if (reportData.transactions.length === 0) {
        lines.push('         No transactions');
      }

      // Grand totals — split per transtype semantics
      lines.push('');
      lines.push('='.repeat(48));
      if (buyWeight > 0) {
        lines.push(`TOTAL                    ${buyWeight.toFixed(1)} ${weightUnit}`);
      }
      if (sellAiItems > 0) {
        const itemsLabel = sellAiItems === 1 ? 'item' : 'items';
        lines.push(`TOTAL ITEMS              ${sellAiItems} ${itemsLabel}`);
      }
      if (sellAiAmount > 0) {
        lines.push(`TOTAL VALUE              KSh ${sellAiAmount.toFixed(0)}`);
      }
      lines.push('');

      // Footer
      lines.push(`CLERK:      ${reportData.clerkName}`);
      lines.push(`PRINTED ON: ${formattedDate} - ${formattedTime}`);
      lines.push('');
      lines.push(`DEVICE CODE: ${reportData.deviceCode}`);

      const fileName = `z-report-${reportData.deviceCode}-${reportData.date}.pdf`;

      // Create PDF
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFont('courier', 'normal');
      doc.setFontSize(10);
      const marginX = 12;
      const marginY = 14;
      const lineHeight = 4.5;
      const pageHeight = doc.internal.pageSize.getHeight();

      let y = marginY;
      for (const line of lines) {
        if (y > pageHeight - marginY) {
          doc.addPage();
          y = marginY;
        }
        doc.text(line, marginX, y);
        y += lineHeight;
      }

      const pdfBlob = doc.output('blob');
      
      // Use existing download logic
      if ('showSaveFilePicker' in window) {
        (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'PDF file',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        }).then((handle: any) => {
          return handle.createWritable();
        }).then((writable: any) => {
          return writable.write(pdfBlob).then(() => writable.close());
        }).then(() => {
          console.log('✅ Device Z Report saved via File System Access API');
          resolve(true);
        }).catch((err: any) => {
          console.log('File System Access failed, trying fallback:', err.message);
          downloadWithFallback(pdfBlob, fileName, resolve);
        });
      } else {
        downloadWithFallback(pdfBlob, fileName, resolve);
      }
    } catch (err) {
      console.error('Device Z Report PDF generation error:', err);
      resolve(false);
    }
  });
};

// Helper to pad columns for fixed-width layout
const padColumns = (values: string[], widths: number[]): string => {
  return values.map((val, i) => val.padEnd(widths[i] || 10)).join('');
};