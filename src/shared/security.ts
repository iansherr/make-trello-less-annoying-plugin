/**
 * The two sanitising helpers the board export needs. Copied from timeworthy/ikmal-webtools `core/security.ts`
 * (the plugin cannot import host code); keep them in step with it.
 */

/** Escapes characters for HTML text and attribute context to prevent DOM XSS. Encodes: &, <, >, ", ' */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Neutralizes CSV / spreadsheet formula injection (DDE attacks): a cell that starts with '=', '+', '-', '@', tab or
 * carriage return is prefixed with a single quote.
 */
export function sanitizeCsvCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '""';
  let str = String(cell);

  // If starts with formula trigger character, prefix with apostrophe to disarm Excel/Sheets
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  return `"${str.replace(/"/g, '""')}"`;
}
