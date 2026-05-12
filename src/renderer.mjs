/**
 * renderer.mjs — Render EJS template with parsed OpenAPI data
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

/**
 * Render the full documentation HTML from template data
 */
export function renderHtml(data) {
  const templatePath = join(TEMPLATES_DIR, 'main.ejs');
  const html = ejs.render(readFileSync(templatePath, 'utf8'), {
    ...data,
    filename: templatePath, // enables ejs includes
  });
  return html;
}

/**
 * Helper functions available in EJS templates
 */
export const helpers = {
  /**
   * Escape HTML special characters
   */
  esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * Indent for nested properties
   */
  indent(depth) {
    return '  '.repeat(depth);
  },

  /**
   * Format a schema type with format info
   */
  formatType(type, format) {
    if (!type) return 'any';
    if (format && format !== type) return `${type}&lt;${format}&gt;`;
    return type;
  },

  /**
   * HTTP status code class
   */
  statusClass(code) {
    if (code.startsWith('2')) return 'success';
    if (code.startsWith('3')) return 'redirect';
    if (code.startsWith('4')) return 'client-error';
    if (code.startsWith('5')) return 'server-error';
    return 'info';
  },
};
