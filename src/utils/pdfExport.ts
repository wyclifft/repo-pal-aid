import type { ZReportData } from '@/services/mysqlApi';

// Helper to get produce label from localStorage settings (for non-React contexts)
const getProduceLabelFromCache = (): string => {
  try {
    const cached = localStorage.getItem('app_settings');
    if (cached) {
      const settings = JSON.parse(cached);
      return settings.orgtype === 'C' ? 'COFFEE' : 'MILK';
    }
  } catch (e) {
    console.warn('Failed to read produce label from cache:', e);
  }
  return 'MILK'; // Default to dairy
};

export const printThermalZReport = (reportData: ZReportData, produceLabel?: string) => {
  const printWindow = window.open('', '', 'width=300,height=600');
  if (!printWindow) return;

  // Use provided label or get from cache
  const label = produceLabel?.toUpperCase() || getProduceLabelFromCache();

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
        <div>Total Litres: ${reportData.totals.liters.toFixed(2)}</div>
      </div>
      <div class="line"></div>
      <div class="section">
        <div class="bold">BY SESSION:</div>
        <div>Morning: ${reportData.bySession.AM.entries} (${reportData.bySession.AM.liters.toFixed(2)}L)</div>
        <div>Evening: ${reportData.bySession.PM.entries} (${reportData.bySession.PM.liters.toFixed(2)}L)</div>
      </div>
      <div class="line"></div>
      <div class="section">
        <div class="bold">BY ROUTE:</div>
        ${Object.entries(reportData.byRoute).map(([route, data]) => 
          `<div>${route}: ${data.total.toFixed(2)}L</div>`
        ).join('')}
      </div>
      <div class="line"></div>
      <div class="section">
        <div class="bold">BY COLLECTOR:</div>
        ${Object.entries(reportData.byCollector).map(([collector, data]) => 
          `<div>${collector}: ${data.liters.toFixed(2)}L</div>`
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

export const generateZReportPDF = (reportData: ZReportData, produceLabel?: string) => {
  // Use provided label or get from cache
  const label = produceLabel?.toUpperCase() || getProduceLabelFromCache();
  
  // Create a formatted text version of the report
  let content = `${label} COLLECTION Z REPORT\n`;
  content += `Date: ${new Date(reportData.date).toLocaleDateString()}\n`;
  content += `Generated: ${new Date().toLocaleString()}\n`;
  content += `\n${'='.repeat(60)}\n\n`;

  // Summary Totals
  content += `SUMMARY\n`;
  content += `${'='.repeat(60)}\n`;
  content += `Total Liters: ${reportData.totals.liters.toFixed(2)} L\n`;
  content += `Total Farmers: ${reportData.totals.farmers}\n`;
  content += `Total Entries: ${reportData.totals.entries}\n`;
  content += `\n`;

  // By Session
  content += `BY SESSION\n`;
  content += `${'='.repeat(60)}\n`;
  content += `Morning (AM): ${reportData.bySession.AM.entries} entries, ${reportData.bySession.AM.liters.toFixed(2)} L\n`;
  content += `Evening (PM): ${reportData.bySession.PM.entries} entries, ${reportData.bySession.PM.liters.toFixed(2)} L\n`;
  content += `\n`;

  // By Route
  content += `BY ROUTE\n`;
  content += `${'='.repeat(60)}\n`;
  Object.entries(reportData.byRoute).forEach(([route, data]) => {
    content += `${route}: AM=${data.AM.length}, PM=${data.PM.length}, Total=${data.total.toFixed(2)} L\n`;
  });
  content += `\n`;

  // By Collector
  content += `BY COLLECTOR\n`;
  content += `${'='.repeat(60)}\n`;
  Object.entries(reportData.byCollector).forEach(([collector, data]) => {
    content += `${collector}: ${data.farmers} farmers, ${data.entries} entries, ${data.liters.toFixed(2)} L\n`;
  });

  // Create blob and download
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `z-report-${reportData.date}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};