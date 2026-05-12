#!/usr/bin/env node

/**
 * generate-api-pdf — CLI tool to generate professional API documentation PDFs
 *
 * Usage:
 *   generate-api-pdf -i openapi.json -c "Company Name" -p "Project Name"
 *   generate-api-pdf -i spec1.json -i spec2.json -c "Acme Corp" -p "API Platform" -o output.pdf
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOpenApiSpec } from '../src/parser.mjs';
import { renderHtml } from '../src/renderer.mjs';
import { generatePdf } from '../src/generator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('generate-api-pdf')
  .description('Generate professional API documentation PDF from OpenAPI JSON spec')
  .version('1.0.0')
  .requiredOption('-i, --input <paths...>', 'OpenAPI JSON file path(s)')
  .requiredOption('-c, --company <name>', 'Company name for cover page')
  .requiredOption('-p, --project <name>', 'Project name for cover page')
  .option('-o, --output <path>', 'Output PDF path (default: ./<project>-api-docs.pdf)')
  .option('--base-url <url>', 'Override base URL in documentation')
  .option('--auth-type <type>', 'Authentication type label (e.g., "JWT Bearer", "API Key")')
  .option('--theme <preset>', 'Color theme: navy (default), dark, blue', 'navy')
  .option('--dev', 'Development mode: save intermediate HTML file')
  .option('--no-cover', 'Skip cover page')
  .option('--no-toc', 'Skip table of contents');

program.parse();

const opts = program.opts();

async function main() {
  const startTime = Date.now();

  // Validate inputs
  const inputFiles = opts.input.map((p) => resolve(p));
  for (const f of inputFiles) {
    if (!existsSync(f)) {
      console.error(`❌ Input file not found: ${f}`);
      process.exit(1);
    }
  }

  // Parse all specs
  console.log(`📄 Parsing ${inputFiles.length} OpenAPI spec(s)…`);
  const specs = inputFiles.map((f) => {
    const raw = readFileSync(f, 'utf8');
    const json = JSON.parse(raw);
    const parsed = parseOpenApiSpec(json);
    console.log(`   ✓ ${basename(f)}: ${parsed.stats.endpointCount} endpoints, ${parsed.stats.tagCount} tags`);
    return { file: basename(f), ...parsed };
  });

  // Determine output path
  const outputPath = opts.output
    ? resolve(opts.output)
    : resolve(`./${opts.project.replace(/\s+/g, '-').toLowerCase()}-api-docs.pdf`);

  // Build template data
  const templateData = {
    company: opts.company,
    project: opts.project,
    baseUrl: opts.baseUrl || specs[0]?.baseUrl || 'N/A',
    authType: opts.authType || specs[0]?.authType || 'N/A',
    date: new Date().toISOString().split('T')[0],
    version: specs[0]?.version || '1.0.0',
    specs,
    theme: opts.theme,
    showCover: opts.cover !== false,
    showToc: opts.toc !== false,
  };

  // Render HTML
  console.log('🎨 Rendering HTML template…');
  const html = renderHtml(templateData);

  // Save intermediate HTML in dev mode
  if (opts.dev) {
    const htmlPath = outputPath.replace(/\.pdf$/, '.html');
    writeFileSync(htmlPath, html, 'utf8');
    console.log(`   💾 Dev HTML saved: ${htmlPath}`);
  }

  // Generate PDF
  console.log('🖨️  Generating PDF…');
  await generatePdf(html, outputPath, { showCover: opts.cover !== false });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`   📎 ${outputPath}`);
}

main().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  if (opts.dev) console.error(err.stack);
  process.exit(1);
});
