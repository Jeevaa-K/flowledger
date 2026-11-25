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
// Escapes a CSV field: quotes it, doubles internal quotes, and neutralizes
// leading =/+/-/@ so a description like "=cmd|..." can't execute as a
// formula when the file is opened in Excel/Sheets (CSV injection).
function csvField(val) {
  let s = String(val ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}


// Bounded in-memory cache keyed by (key, YYYY-MM month) so AI summaries
// don't re-hit Groq on every page load while auto-expiring on month rollover.
function createMonthlyCache(maxEntries = 500) {
  const store = new Map();
  return {
    get(key, month) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.month !== month) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, month, value) {
      if (store.size >= maxEntries) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
      store.set(key, { month, value });
    }
  };
}

function isValidIsoDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function normalizeCategory(cat, validCats, fallback = 'Other') {
  if (typeof cat !== 'string') return fallback;
  const trimmed = cat.trim().toLowerCase();
  if (!trimmed) return fallback;
  const match = validCats.find(c => String(c).toLowerCase() === trimmed);
  return match || fallback;
}

module.exports = { safeError, sanitizeTags, EMAIL_RE, csvField, createMonthlyCache, isValidIsoDate, normalizeCategory };
