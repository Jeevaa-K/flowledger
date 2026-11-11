const {
  CURRENCIES,
  normalizeCurrency,
  getExchangeRate,
  convertCurrency,
  getAllRates
} = require('../src/services/currency');

// Mock db
jest.mock('../src/db', () => ({
  db: { get: jest.fn(), all: jest.fn(), run: jest.fn(), query: jest.fn() },
  pool: { query: jest.fn(), end: jest.fn() },
  initDB: jest.fn()
}));

const { db } = require('../src/db');
const currenciesRouter = require('../src/routes/currencies');
const transactionsRouter = require('../src/routes/transactions');

function getHandler(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]) {
      const handlers = layer.route.stack.map(s => s.handle);
      return handlers[handlers.length - 1];
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
}

describe('Currency and Exchange Rate Engine', () => {
  test('normalizes symbols and aliases correctly', () => {
    expect(normalizeCurrency('₹').code).toBe('INR');
    expect(normalizeCurrency('inr').code).toBe('INR');
    expect(normalizeCurrency('$').code).toBe('USD');
    expect(normalizeCurrency('USD').code).toBe('USD');
    expect(normalizeCurrency('€').code).toBe('EUR');
    expect(normalizeCurrency('£').code).toBe('GBP');
    expect(normalizeCurrency('د.إ').code).toBe('AED');
    expect(normalizeCurrency(null).code).toBe('INR');
  });

  test('calculates cross-rates between currency pairs', () => {
    expect(getExchangeRate('USD', 'USD')).toBe(1.0);
    expect(getExchangeRate('USD', 'INR')).toBeGreaterThan(80);
    expect(getExchangeRate('INR', 'USD')).toBeLessThan(0.02);
  });

  test('converts amounts between currencies accurately', () => {
    const usdToInr = convertCurrency(100, 'USD', 'INR');
    expect(usdToInr.converted).toBe(8450);
    expect(usdToInr.rate).toBe(84.5);
    expect(usdToInr.from.code).toBe('USD');
    expect(usdToInr.to.code).toBe('INR');

    // Custom rate override
    const custom = convertCurrency(100, 'USD', 'INR', 85.0);
    expect(custom.converted).toBe(8500);
    expect(custom.rate).toBe(85.0);
  });

  test('GET /currencies returns supported currencies list', async () => {
    const handler = getHandler(currenciesRouter, 'get', '/currencies');
    let jsonResult = null;
    const res = { json(data) { jsonResult = data; return this; } };
    await handler({}, res);

    expect(Array.isArray(jsonResult)).toBe(true);
    expect(jsonResult.length).toBeGreaterThanOrEqual(10);
    expect(jsonResult.some(c => c.code === 'USD')).toBe(true);
    expect(jsonResult.some(c => c.code === 'INR')).toBe(true);
  });

  test('POST /currencies/convert converts request body amounts', async () => {
    const handler = getHandler(currenciesRouter, 'post', '/currencies/convert');
    const req = {
      user: { currency: 'INR' },
      body: { amount: 50, from: 'USD', to: 'INR' }
    };
    let jsonResult = null;
    const res = {
      status() { return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);
    expect(jsonResult).toBeDefined();
    expect(jsonResult.converted).toBe(4225); // 50 * 84.5
    expect(jsonResult.from.code).toBe('USD');
    expect(jsonResult.to.code).toBe('INR');
  });

  test('POST /transactions converts foreign currency to base amount', async () => {
    const handler = getHandler(transactionsRouter, 'post', '/transactions');

    // Mock user having base currency INR
    db.get.mockImplementation((query) => {
      if (query.includes('FROM users WHERE id=$1')) {
        return Promise.resolve({ currency: 'INR' });
      }
      if (query.includes('FROM accounts WHERE id=$1 AND user_id=$2')) {
        return Promise.resolve({ id: 2 });
      }
      if (query.includes('INSERT INTO transactions')) {
        return Promise.resolve({
          id: 101,
          description: 'ChatGPT Subscription',
          amount: 1690,
          original_amount: 20,
          original_currency: 'USD',
          exchange_rate: 84.5,
          type: 'expense',
          category: 'Bills',
          date: '2026-11-11'
        });
      }
      return Promise.resolve(null);
    });

    const req = {
      user: { id: 1 },
      body: {
        description: 'ChatGPT Subscription',
        amount: 20,
        currency: 'USD',
        type: 'expense',
        category: 'Bills',
        date: '2026-11-11',
        account_id: 2
      }
    };

    let jsonResult = null;
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);
    expect(statusCode).toBe(201);
    expect(jsonResult.amount).toBe(1690); // 20 * 84.5 converted to base INR
    expect(jsonResult.original_amount).toBe(20);
    expect(jsonResult.original_currency).toBe('USD');
  });
});

