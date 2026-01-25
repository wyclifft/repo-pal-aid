import type { ZReportData } from '@/services/mysqlApi';
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
        <div>DATE: ${new Date(reportData.date).toLocaleDateString()}</div>
        <div>TIME: ${new Date().toLocaleTimeString()}</div>
      </div>
      <div class="line"></div>
      <div class="section center bold">
        <div>Total Entries: ${reportData.totals.entries}</div>
        <div>Total Farmers: ${reportData.totals.farmers}</div>
        <div>Total ${isCoffee ? 'Kgs' : 'Litres'}: ${reportData.totals.liters.toFixed(2)}</div>
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

// Fallback download method with verification - uses Web Share API on mobile
const downloadWithFallback = async (blob: Blob, fileName: string, resolve: (success: boolean) => void) => {
  try {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // On native (Capacitor) mobile, avoid window.open(blobUrl) (can black-screen/crash).
    // Save to device documents + open share sheet.
    if (Capacitor.isNativePlatform()) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const writeRes = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Documents,
        });

        await Share.share({
          title: fileName,
          text: 'Z Report',
          url: writeRes.uri,
          dialogTitle: 'Save / Share Z Report',
        });

        console.log('✅ File saved/shared via native share');
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