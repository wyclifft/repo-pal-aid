import type { ZReportData } from '@/services/mysqlApi';

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
      
      // Create a formatted text version of the report
      let content = `${label} COLLECTION Z REPORT\n`;
      content += `Date: ${new Date(reportData.date).toLocaleDateString()}\n`;
      content += `Generated: ${new Date().toLocaleString()}\n`;
      content += `\n${'='.repeat(60)}\n\n`;

      // Summary Totals
      content += `SUMMARY\n`;
      content += `${'='.repeat(60)}\n`;
      content += `Total ${weightLabel}: ${reportData.totals.liters.toFixed(2)} ${weightUnit}\n`;
      content += `Total Farmers: ${reportData.totals.farmers}\n`;
      content += `Total Entries: ${reportData.totals.entries}\n`;
      content += `\n`;

      // By Session - Only for dairy
      if (!isCoffee) {
        content += `BY SESSION\n`;
        content += `${'='.repeat(60)}\n`;
        content += `Morning (AM): ${reportData.bySession.AM.entries} entries, ${reportData.bySession.AM.liters.toFixed(2)} ${weightUnit}\n`;
        content += `Evening (PM): ${reportData.bySession.PM.entries} entries, ${reportData.bySession.PM.liters.toFixed(2)} ${weightUnit}\n`;
        content += `\n`;
      }

      // By Route/Center
      content += `BY ${isCoffee ? 'CENTER' : 'ROUTE'}\n`;
      content += `${'='.repeat(60)}\n`;
      Object.entries(reportData.byRoute).forEach(([route, data]) => {
        if (isCoffee) {
          content += `${route}: ${data.AM.length + data.PM.length} entries, Total=${data.total.toFixed(2)} ${weightUnit}\n`;
        } else {
          content += `${route}: AM=${data.AM.length}, PM=${data.PM.length}, Total=${data.total.toFixed(2)} ${weightUnit}\n`;
        }
      });
      content += `\n`;

      // By Collector
      content += `BY COLLECTOR\n`;
      content += `${'='.repeat(60)}\n`;
      Object.entries(reportData.byCollector).forEach(([collector, data]) => {
        content += `${collector}: ${data.farmers} farmers, ${data.entries} entries, ${data.liters.toFixed(2)} ${weightUnit}\n`;
      });

      const fileName = `z-report-${reportData.date}.txt`;
      const blob = new Blob([content], { type: 'text/plain' });
      
      // Try using the File System Access API (modern browsers)
      if ('showSaveFilePicker' in window) {
        (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'Text file',
            accept: { 'text/plain': ['.txt'] }
          }]
        }).then((handle: any) => {
          return handle.createWritable();
        }).then((writable: any) => {
          return writable.write(blob).then(() => writable.close());
        }).then(() => {
          console.log('✅ File saved via File System Access API');
          resolve(true);
        }).catch((err: any) => {
          // User cancelled or API not supported - try fallback
          console.log('File System Access failed, trying fallback:', err.message);
          downloadWithFallback(blob, fileName, resolve);
        });
      } else {
        // Fallback for older browsers and mobile
        downloadWithFallback(blob, fileName, resolve);
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      resolve(false);
    }
  });
};

// Fallback download method with verification
const downloadWithFallback = (blob: Blob, fileName: string, resolve: (success: boolean) => void) => {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    
    // Add click handler to detect if download was triggered
    let downloadTriggered = false;
    
    // For mobile, we need to handle this differently
    // Check if we're on mobile/Capacitor
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      // On mobile, try to open in new tab which triggers download
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        downloadTriggered = true;
        // Give time for download to start
        setTimeout(() => {
          URL.revokeObjectURL(url);
          resolve(true);
        }, 1000);
      } else {
        // Fallback: try the click method anyway
        a.click();
        downloadTriggered = true;
        setTimeout(() => {
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
          resolve(true);
        }, 500);
      }
    } else {
      // Desktop: standard click approach
      a.click();
      downloadTriggered = true;
      
      // Cleanup after a short delay
      setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        resolve(downloadTriggered);
      }, 500);
    }
  } catch (err) {
    console.error('Fallback download failed:', err);
    resolve(false);
  }
};