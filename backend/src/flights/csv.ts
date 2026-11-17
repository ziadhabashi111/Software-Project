/**
 * Minimal CSV writer for the passenger export (FLT-29). Quotes cells that
 * need it and neutralises spreadsheet formulas: a cell starting with = + - @
 * is prefixed with a quote so Excel shows it as text instead of running it.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')
    .concat('\r\n');
}
