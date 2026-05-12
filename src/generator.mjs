/**
 * generator.mjs — Generate PDF from HTML using Puppeteer
 *
 * Uses page.pdf() which produces real text-selectable PDF with
 * internal links working. Much better than screenshot approach.
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

/**
 * Generate PDF from HTML string
 */
export async function generatePdf(html, outputPath, options = {}) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Load HTML content
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size:8px; color:#94a3b8; width:100%; text-align:center; padding:0 15mm;">
          <span class="pageNumber"></span>
        </div>
      `,
      footerTemplate: `
        <div style="font-size:8px; color:#94a3b8; width:100%; text-align:center; padding:0 15mm;">
          Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>
      `,
    });

    writeFileSync(outputPath, pdfBuffer);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
