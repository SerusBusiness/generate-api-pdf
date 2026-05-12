#!/usr/bin/env node

/**
 * generate-api-pdf — CLI tool to generate professional API documentation PDFs
 *
 * Usage:
 *   generate-api-pdf -i openapi.json -c "Company" -p "Project"
 *   generate-api-pdf -i spec1.json -i spec2.json -c "Company" -p "Project"
 *   generate-api-pdf -i ./specs/ -c "Company" -p "Project"
 *
 * -i accepts files and/or directories. Directories are scanned for *-openapi.json files.
 * Each spec gets its own PDF output.
 */

import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOpenApiSpec } from '../src/parser.mjs';
import { renderHtml } from '../src/renderer.mjs';
import { generatePdf } from '../src/generator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('generate-api-pdf')
  .description('Generate professional API documentation PDF from OpenAPI JSON spec(s)')
  .version('1.0.0')
  .requiredOption('-i, --input <paths...>', 'OpenAPI JSON file(s) or directory(ies)')
  .requiredOption('-c, --company <name>', 'Company name for cover page')
  .option('-p, --project <name>', 'Project name for cover page (default: spec info.title or "API Documentation"')
  .option('-o, --output <path>', 'Output PDF path or directory')
  .option('--base-url <url>', 'Override base URL in documentation')
  .option('--auth-type <type>', 'Authentication type label (e.g., "JWT Bearer", "API Key")')
  .option('--theme <preset>', 'Color theme: navy (default), dark, blue', 'navy')
  .option('--dev', 'Development mode: save intermediate HTML file')
  .option('--no-cover', 'Skip cover page')
  .option('--no-toc', 'Skip table of contents');

program.parse();

const opts = program.opts();

/**
 * Expand input paths: directories are scanned for *-openapi.json files
 */
function expandInputs(paths) {
  const files = [];
  for (const p of paths) {
    const resolved = resolve(p);
    if (!existsSync(resolved)) {
      console.error(`Input not found: ${resolved}`);
      process.exit(1);
    }

    if (statSync(resolved).isDirectory()) {
      // Scan for *-openapi.json files in the directory
      const entries = readdirSync(resolved)
        .filter((f) => f.endsWith('-openapi.json') || f.endsWith('.openapi.json'))
        .sort();

      if (entries.length === 0) {
        console.warn(`Warning: No *-openapi.json files found in ${resolved}`);
      } else {
        for (const entry of entries) {
          files.push(join(resolved, entry));
        }
      }
    } else {
      files.push(resolved);
    }
  }
  // Deduplicate
  return [...new Set(files)];
}

/**
 * Generate a single PDF from one parsed spec
 */
async function generateOne(spec, index, total) {
  const label = total > 1 ? `[${index + 1}/${total}] ` : '';

  // Derive project name: CLI --project → spec info.title → "API Documentation"
  const projectName = opts.project || spec.title || 'API Documentation';

  // Derive output path
  // Auto-name from spec file: gateway-openapi.json → gateway-api-docs.pdf
  const baseName = spec.file.replace(/-openapi\.json$/i, '').replace(/\.json$/i, '');
  const autoFileName = `${baseName}-api-docs.pdf`;

  let outputPath;
  if (opts.output) {
    const resolved = resolve(opts.output);
    // If -o ends with /, always treat as directory (even if it doesn't exist yet)
    const endsWithSlash = resolved.endsWith('/') || opts.output.endsWith('/');
    const isExistingDir = existsSync(resolved) && statSync(resolved).isDirectory();
    if (endsWithSlash || isExistingDir) {
      mkdirSync(resolved, { recursive: true });
      outputPath = resolve(resolved, autoFileName);
    } else if (total === 1) {
      outputPath = resolved; // single input: -o is the exact file path
    } else {
      // multi input without trailing slash and dir doesn't exist yet
      // treat the parent directory as output location
      mkdirSync(dirname(resolved), { recursive: true });
      outputPath = resolve(dirname(resolved), autoFileName);
    }
  } else {
    outputPath = resolve(process.cwd(), autoFileName);
  }
  mkdirSync(dirname(outputPath), { recursive: true });

  // Derive base URL: CLI override → spec server → N/A
  const baseUrl = opts.baseUrl || spec.baseUrl || 'N/A';

  // Build template data (single spec per PDF)
  const templateData = {
    company: opts.company,
    project: projectName,
    baseUrl,
    authType: opts.authType || spec.authType || 'N/A',
    date: new Date().toISOString().split('T')[0],
    version: spec.version || '1.0.0',
    specs: [spec],
    theme: opts.theme,
    showCover: opts.cover !== false,
    showToc: opts.toc !== false,
  };

  // Render HTML
  console.log(`${label}Rendering HTML template...`);
  const html = renderHtml(templateData);

  // Save intermediate HTML in dev mode
  if (opts.dev) {
    const htmlPath = outputPath.replace(/\.pdf$/, '.html');
    writeFileSync(htmlPath, html, 'utf8');
    console.log(`   Dev HTML saved: ${htmlPath}`);
  }

  // Generate PDF
  console.log(`${label}Generating PDF...`);
  await generatePdf(html, outputPath, { showCover: opts.cover !== false, specs: [spec] });

  return outputPath;
}

async function main() {
  const startTime = Date.now();

  // Expand input paths (resolve directories → files)
  const inputFiles = expandInputs(opts.input.flat());

  if (inputFiles.length === 0) {
    console.error('No input files found. Provide JSON files or a directory with *-openapi.json files.');
    process.exit(1);
  }

  // Parse all specs
  console.log(`Parsing ${inputFiles.length} OpenAPI spec(s)...`);
  const specs = inputFiles.map((f) => {
    let json;
    try {
      const raw = readFileSync(f, 'utf8');
      json = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read or parse ${f}: ${err.message}`);
    }

    if (!json || typeof json !== 'object' || !json.paths) {
      throw new Error(`Invalid OpenAPI document: ${f} is missing a paths object`);
    }

    const parsed = parseOpenApiSpec(json);
    console.log(`   ${basename(f)}: ${parsed.stats.endpointCount} endpoints, ${parsed.stats.tagCount} tags`);
    return { file: basename(f), ...parsed };
  });

  // Generate one PDF per spec
  const outputs = [];
  for (let i = 0; i < specs.length; i++) {
    const out = await generateOne(specs[i], i, specs.length);
    outputs.push(out);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  for (const out of outputs) {
    console.log(`   ${out}`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (opts.dev) console.error(err.stack);
  process.exit(1);
});
