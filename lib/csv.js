// Escape a single CSV cell.
//
// Beyond quote-escaping, this neutralizes spreadsheet formula injection:
// Excel / LibreOffice / Google Sheets treat a cell whose first character is
// `=`, `+`, `-`, `@` (or a control prefix like TAB/CR) as a formula, so
// attacker-controlled values (tracked URLs, referrers, UTM fields, search
// keywords) must be forced to plain text with a leading apostrophe.
function escapeCsv(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { escapeCsv };
