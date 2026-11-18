// ── Currency and Foreign Exchange (FX) Service ───────────────────────
const { db } = require('../db');

const CURRENCIES = {
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳', locale: 'en-IN' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸', locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺', locale: 'de-DE' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧', locale: 'en-GB' },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪', locale: 'ar-AE' },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦', locale: 'en-CA' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺', locale: 'en-AU' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬', locale: 'en-SG' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵', locale: 'ja-JP' },
  CHF: { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', flag: '🇨🇭', locale: 'de-CH' }
};

// Fallback reference rates (relative to 1 USD)
const DEFAULT_RATES_USD = {
  USD: 1.0,
  INR: 84.50,
  EUR: 0.92,
  GBP: 0.79,
  AED: 3.67,
  CAD: 1.39,
  AUD: 1.52,
  SGD: 1.33,
  JPY: 152.80,
  CHF: 0.88
};

let cachedRatesUsd = { ...DEFAULT_RATES_USD };
let lastFetchedAt = null;

// Map symbols/aliases to 3-letter currency code
const SYMBOL_TO_CODE = {
  '₹': 'INR', 'inr': 'INR', 'rs': 'INR', 'rupee': 'INR', 'rupees': 'INR',
  '$': 'USD', 'usd': 'USD', 'dollar': 'USD', 'dollars': 'USD',
  '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
  '£': 'GBP', 'gbp': 'GBP', 'pound': 'GBP', 'pounds': 'GBP',
  'د.إ': 'AED', 'aed': 'AED', 'dirham': 'AED', 'dirhams': 'AED',
  'c$': 'CAD', 'cad': 'CAD',
  'a$': 'AUD', 'aud': 'AUD',
  's$': 'SGD', 'sgd': 'SGD',
  '¥': 'JPY', 'jpy': 'JPY', 'yen': 'JPY',
  'fr': 'CHF', 'chf': 'CHF'
};

function normalizeCurrency(input) {
  if (!input) return CURRENCIES.INR;
  const clean = String(input).trim().toLowerCase();
  const code = SYMBOL_TO_CODE[clean] || (CURRENCIES[clean.toUpperCase()] ? clean.toUpperCase() : 'INR');
  return CURRENCIES[code] || CURRENCIES.INR;
}

/**
 * Load cached FX rates from database
 */
async function loadCachedFxRates() {
  try {
    const row = await db.get('SELECT rates, fetched_at FROM fx_rates WHERE base=$1', ['USD']);
    if (row && row.rates) {
      const parsed = typeof row.rates === 'string' ? JSON.parse(row.rates) : row.rates;
      cachedRatesUsd = { ...DEFAULT_RATES_USD, ...parsed, USD: 1.0 };
      lastFetchedAt = row.fetched_at instanceof Date ? row.fetched_at.toISOString() : String(row.fetched_at);
      return true;
    }
  } catch (_) {
    // DB not ready or running unit test mock
  }
  return false;
}

/**
 * Refresh live market rates from Frankfurter or open exchange rate API
 */
async function refreshFxRates() {
  try {
    let freshRates = null;
    const fetchedTime = new Date().toISOString();

    // 1. Primary: Frankfurter API (free, reliable ECB data)
    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD');
      if (res.ok) {
        const data = await res.json();
        if (data && data.rates && typeof data.rates === 'object') {
          freshRates = data.rates;
        }
      }
    } catch (_) {}

    // 2. Secondary fallback API
    if (!freshRates) {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (res.ok) {
          const data = await res.json();
          if (data && data.rates && typeof data.rates === 'object') {
            freshRates = data.rates;
          }
        }
      } catch (_) {}
    }

    if (freshRates) {
      cachedRatesUsd = { ...DEFAULT_RATES_USD, ...freshRates, USD: 1.0 };
      lastFetchedAt = fetchedTime;
      try {
        await db.run(
          `INSERT INTO fx_rates (base, rates, fetched_at) VALUES ('USD', $1, $2)
           ON CONFLICT (base) DO UPDATE SET rates = EXCLUDED.rates, fetched_at = EXCLUDED.fetched_at`,
          [JSON.stringify(cachedRatesUsd), fetchedTime]
        );
        console.log(`✅ FX rates updated from live API (fetched_at: ${fetchedTime})`);
      } catch (_) {}
    }
  } catch (err) {
    console.warn('⚠️ Unable to refresh FX rates from API, using fallback rates:', err.message);
  }
}

// Scheduled daily refresh & startup loader (unref so tests/server can exit cleanly)
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    const hasCached = await loadCachedFxRates();
    const isStale = !lastFetchedAt || (Date.now() - new Date(lastFetchedAt).getTime() > 24 * 60 * 60 * 1000);
    if (!hasCached || isStale) {
      await refreshFxRates();
    }
  })().catch(() => {});

  const dailyTimer = setInterval(() => {
    refreshFxRates().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  if (dailyTimer.unref) dailyTimer.unref();
}

/**
 * Returns the exchange rate between any two currencies.
 * 1 unit of `from` = X units of `to`.
 */
function getExchangeRate(fromInput, toInput) {
  const from = normalizeCurrency(fromInput).code;
  const to = normalizeCurrency(toInput).code;
  if (from === to) return 1.0;

  const fromUsdRate = cachedRatesUsd[from] || DEFAULT_RATES_USD[from] || 1.0;
  const toUsdRate = cachedRatesUsd[to] || DEFAULT_RATES_USD[to] || 1.0;

  // Rate: (1 / fromUsdRate) * toUsdRate
  const rate = toUsdRate / fromUsdRate;
  return Math.round(rate * 10000) / 10000;
}

/**
 * Converts an amount from one currency to another.
 */
function convertCurrency(amount, fromInput, toInput, customRate = null) {
  const num = parseFloat(amount) || 0;
  const fromMeta = normalizeCurrency(fromInput);
  const toMeta = normalizeCurrency(toInput);

  if (fromMeta.code === toMeta.code) {
    return {
      amount: num,
      from: fromMeta,
      to: toMeta,
      rate: 1.0,
      converted: num
    };
  }

  const rate = (customRate && Number.isFinite(parseFloat(customRate)) && parseFloat(customRate) > 0)
    ? parseFloat(customRate)
    : getExchangeRate(fromMeta.code, toMeta.code);

  const converted = Math.round(num * rate * 100) / 100;
  return {
    amount: num,
    from: fromMeta,
    to: toMeta,
    rate,
    converted
  };
}

/**
 * Returns all currencies rates relative to a given base.
 */
function getAllRates(baseInput = 'INR') {
  const base = normalizeCurrency(baseInput).code;
  const rates = {};
  for (const code of Object.keys(CURRENCIES)) {
    rates[code] = getExchangeRate(base, code);
  }
  return {
    base,
    baseMeta: CURRENCIES[base],
    rates,
    lastUpdated: lastFetchedAt || new Date().toISOString()
  };
}

module.exports = {
  CURRENCIES,
  DEFAULT_RATES_USD,
  normalizeCurrency,
  getExchangeRate,
  convertCurrency,
  getAllRates,
  loadCachedFxRates,
  refreshFxRates
};

