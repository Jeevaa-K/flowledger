// Sends a generic message to the client while logging full detail server-side,
// so database schema / internals never leak in API responses.
function safeError(res, err, context, status = 500) {
  console.error(`${context} error:`, err);
  res.status(status).json({ error: 'Something went wrong. Please try again.' });
}

// Normalizes a tags array from the client: trims whitespace, lowercases
// (so "Reimbursable" and "reimbursable" are the same tag), drops empties,
// dedupes, and caps both tag length and count so a bad request can't
// bloat a row or the GIN index.
function sanitizeTags(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase().slice(0, 30);
    if (t) seen.add(t);
    if (seen.size >= 15) break; // cap tags per transaction
  }
  return [...seen];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Formats a Date object or ISO string to 'YYYY-MM-DD' using local date getters,
// avoiding UTC date shifts (e.g. at UTC+05:30, midnight local is 18:30 UTC previous day).
function toDateString(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const match = d.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Sanitizes text for PDFKit rendering with standard Helvetica font (WinAnsiEncoding).
// Replaces emojis, unrenderable characters, or undefined values with Latin-1 equivalents
// or question marks, preventing PDFKit crashes.
function pdfSafeText(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  return String(val)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .trim() || fallback;
}

// Escapes a CSV field: quotes it, doubles internal quotes, and neutralizes
// leading =/+/-/@ so a description like "=cmd|..." can't execute as a
// formula when the file is opened in Excel/Sheets (CSV injection).
function csvField(val) {
  let s = String(val ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports = { safeError, sanitizeTags, EMAIL_RE, toDateString, pdfSafeText, csvField };
