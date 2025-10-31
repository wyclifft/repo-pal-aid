import type { ZReportData } from '@/services/mysqlApi';

export const generateZReportPDF = (reportData: ZReportData) => {
  // Create a formatted text version of the report
  let content = `MILK COLLECTION Z REPORT\n`;
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
