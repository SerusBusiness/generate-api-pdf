/**
 * generator.mjs — Generate PDF from HTML using Puppeteer, then add Bookmarks via pdf-lib
 *
 * Two-pass approach:
 *   1. Puppeteer page.pdf() → raw PDF (text-selectable, internal links)
 *   2. pdf-lib → add PDF Outlines (Bookmarks) for sidebar navigation
 */

import puppeteer from 'puppeteer';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

/**
 * Collect outline data: map anchor IDs to page numbers
 * Uses Puppeteer to evaluate element positions and compute page numbers
 */
async function collectOutlineData(page, specs) {
  // Build outline structure from parsed data
  const outlineItems = [];

  for (const spec of specs) {
    for (const tag of spec.tags) {
      const tagItem = {
        title: tag.name,
        anchorId: tag.anchorId,
        children: [],
      };

      for (const ep of tag.endpoints) {
        tagItem.children.push({
          title: `${ep.method} ${ep.path}${ep.summary ? ' — ' + ep.summary : ''}`,
          anchorId: ep.anchorId,
        });
      }

      outlineItems.push(tagItem);
    }

    // Add schemas section if present
    if (spec.schemas && spec.schemas.length > 0) {
      outlineItems.push({
        title: 'Component Schemas',
        anchorId: 'schemas-section',
        children: spec.schemas.map((s) => ({
          title: s.name,
          anchorId: `schema-${s.name.replace(/[^a-zA-Z0-9-]/g, '-')}`,
        })),
      });
    }
  }

  // Collect all anchor IDs
  const allAnchorIds = outlineItems.flatMap((item) => [
    item.anchorId,
    ...item.children.map((c) => c.anchorId),
  ]);

  // Find each outline anchor's matching TOC link. Chromium already resolves
  // those internal links to the correct PDF destinations, including page
  // breaks, margins, headers/footers, and optional cover/TOC pages.
  const tocLinkIndexes = await page.evaluate(() => {
    const result = {};
    const links = Array.from(document.querySelectorAll('.toc-page a[href^="#"]'));

    links.forEach((link, index) => {
      const href = link.getAttribute('href') || '';
      const anchorId = decodeURIComponent(href.slice(1));
      if (anchorId && result[anchorId] === undefined) {
        result[anchorId] = index;
      }
    });

    return result;
  });

  // Fallback only: used when an outline entry has no matching TOC link.
  // The bookmark paths that do have TOC links are resolved from the PDF
  // annotations in addBookmarks(), not from this approximate screen layout.
  const anchorPositions = await page.evaluate((ids) => {
    const result = {};
    const viewportHeight = window.innerHeight || 1;

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        result[id] = rect.top + window.scrollY;
      }
    }

    return { positions: result, viewportHeight };
  }, allAnchorIds);

  for (const item of outlineItems) {
    item.tocLinkIndex = tocLinkIndexes[item.anchorId];

    const yPos = anchorPositions.positions[item.anchorId];
    if (yPos !== undefined) {
      item.pageIndex = Math.floor(yPos / anchorPositions.viewportHeight);
    }

    for (const child of item.children) {
      child.tocLinkIndex = tocLinkIndexes[child.anchorId];

      const childY = anchorPositions.positions[child.anchorId];
      if (childY !== undefined) {
        child.pageIndex = Math.floor(childY / anchorPositions.viewportHeight);
      }
    }
  }

  return outlineItems;
}

function pdfNameEquals(value, name) {
  return value instanceof PDFName && value.toString() === `/${name}`;
}

function lookupPdfDict(context, value) {
  if (value instanceof PDFDict) return value;
  return context.lookupMaybe(value, PDFDict);
}

function lookupPdfNumber(context, value) {
  if (value instanceof PDFNumber) return value.asNumber();
  return context.lookupMaybe(value, PDFNumber)?.asNumber();
}

function getAnnotationRect(context, annotation) {
  const rect = annotation.lookupMaybe(PDFName.of('Rect'), PDFArray);
  if (!rect || rect.size() < 4) return { left: 0, top: 0 };

  const left = lookupPdfNumber(context, rect.get(0)) ?? 0;
  const top = lookupPdfNumber(context, rect.get(3)) ?? 0;

  return { left, top };
}

function getInternalLinkDestination(annotation) {
  const directDest = annotation.lookup(PDFName.of('Dest'));
  if (directDest) return directDest;

  const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
  if (!action) return undefined;

  const actionType = action.lookupMaybe(PDFName.of('S'), PDFName);
  if (!pdfNameEquals(actionType, 'GoTo')) return undefined;

  return action.lookup(PDFName.of('D'));
}

function extractInternalLinkDestinations(pdfDoc) {
  const context = pdfDoc.context;
  const destinations = [];

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;

    const pageLinks = [];
    for (let i = 0; i < annots.size(); i++) {
      const annotation = lookupPdfDict(context, annots.get(i));
      if (!annotation) continue;

      const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (!pdfNameEquals(subtype, 'Link')) continue;

      const dest = getInternalLinkDestination(annotation);
      if (!dest) continue;

      pageLinks.push({ dest, ...getAnnotationRect(context, annotation) });
    }

    pageLinks
      .sort((a, b) => (b.top - a.top) || (a.left - b.left))
      .forEach(({ dest }) => destinations.push(dest));
  }

  return destinations;
}

/**
 * Add PDF Outlines (Bookmarks) to an existing PDF using pdf-lib
 */
async function addBookmarks(pdfBytes, outlineItems) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const context = pdfDoc.context;
  const tocDestinations = extractInternalLinkDestinations(pdfDoc);

  const createDestination = (outlineItem) => {
    const tocDestination = tocDestinations[outlineItem.tocLinkIndex];
    if (tocDestination) return tocDestination;

    const pageIndex = Math.min(outlineItem.pageIndex || 0, pages.length - 1);
    return context.obj([pages[pageIndex].ref, PDFName.of('XYZ'), null, null, null]);
  };

  // Create the root Outlines dict
  const outlinesRef = context.nextRef();
  const outlinesDict = context.obj({});
  context.assign(outlinesRef, outlinesDict);

  // Link catalog → Outlines
  pdfDoc.catalog.dict.set(PDFName.of('Outlines'), outlinesRef);

  // Build top-level outline items and their children
  const rootItemRefs = [];

  for (const item of outlineItems) {
    const dest = createDestination(item);

    // Create item dict
    const itemRef = context.nextRef();
    const itemDict = context.obj({});
    context.assign(itemRef, itemDict);

    itemDict.set(PDFName.of('Title'), PDFString.of(item.title));
    itemDict.set(PDFName.of('Parent'), outlinesRef);
    itemDict.set(PDFName.of('Dest'), dest);

    // Build children
    if (item.children && item.children.length > 0) {
      const childRefs = [];

      for (const child of item.children) {
        const childDest = createDestination(child);

        const childRef = context.nextRef();
        const childDict = context.obj({});
        context.assign(childRef, childDict);

        childDict.set(PDFName.of('Title'), PDFString.of(child.title));
        childDict.set(PDFName.of('Parent'), itemRef);
        childDict.set(PDFName.of('Dest'), childDest);

        childRefs.push({ ref: childRef, dict: childDict });
      }

      // Link siblings (Prev/Next)
      for (let i = 0; i < childRefs.length; i++) {
        if (i > 0) {
          childRefs[i].dict.set(PDFName.of('Prev'), childRefs[i - 1].ref);
        }
        if (i < childRefs.length - 1) {
          childRefs[i].dict.set(PDFName.of('Next'), childRefs[i + 1].ref);
        }
      }

      // Set First/Last/Count on parent
      itemDict.set(PDFName.of('First'), childRefs[0].ref);
      itemDict.set(PDFName.of('Last'), childRefs[childRefs.length - 1].ref);
      itemDict.set(PDFName.of('Count'), context.obj(childRefs.length));
    }

    rootItemRefs.push({ ref: itemRef, dict: itemDict });
  }

  // Link root-level siblings (Prev/Next)
  for (let i = 0; i < rootItemRefs.length; i++) {
    if (i > 0) {
      rootItemRefs[i].dict.set(PDFName.of('Prev'), rootItemRefs[i - 1].ref);
    }
    if (i < rootItemRefs.length - 1) {
      rootItemRefs[i].dict.set(PDFName.of('Next'), rootItemRefs[i + 1].ref);
    }
  }

  // Set First/Last/Count on Outlines root
  outlinesDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlinesDict.set(PDFName.of('First'), rootItemRefs[0].ref);
  outlinesDict.set(PDFName.of('Last'), rootItemRefs[rootItemRefs.length - 1].ref);
  outlinesDict.set(PDFName.of('Count'), context.obj(rootItemRefs.length));

  return pdfDoc.save();
}

/**
 * Generate PDF from HTML string
 */
export async function generatePdf(html, outputPath, options = {}) {
  const { specs = [] } = options;
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
    await page.emulateMediaType('print');

    // Load HTML content
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    });
    await page.evaluateHandle('document.fonts.ready');

    // Pass 1: Generate raw PDF
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

    // Pass 2: Add Bookmarks if we have spec data
    if (specs.length > 0) {
      console.log('   Collecting outline data for bookmarks...');
      const outlineItems = await collectOutlineData(page, specs);

      if (outlineItems.length > 0) {
        console.log(`   Adding ${outlineItems.length} bookmark groups to PDF...`);
        const pdfWithBookmarks = await addBookmarks(pdfBuffer, outlineItems);
        writeFileSync(outputPath, pdfWithBookmarks);
        console.log('   ✓ Bookmarks added successfully');
      } else {
        writeFileSync(outputPath, pdfBuffer);
      }
    } else {
      writeFileSync(outputPath, pdfBuffer);
    }
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
