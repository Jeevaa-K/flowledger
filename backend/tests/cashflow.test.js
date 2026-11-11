// Mock db before importing routes
jest.mock('../src/db', () => ({
  db: { get: jest.fn(), all: jest.fn(), run: jest.fn(), query: jest.fn() },
  pool: { query: jest.fn(), end: jest.fn() },
  initDB: jest.fn()
}));

const { db } = require('../src/db');
const reportsRouter = require('../src/routes/reports');

// Helper to find the route handler directly from the express router stack
function getHandler(method, path) {
  for (const layer of reportsRouter.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]) {
      // Find the last function in the route stack (after auth middleware)
      const handlers = layer.route.stack.map(s => s.handle);
      return handlers[handlers.length - 1];
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
}

describe('Cash Flow Forecast & Predictive Radar Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calculates safe 30-day forecast with positive net cash', async () => {
    const handler = getHandler('get', '/cashflow-forecast');

    const todayStr = new Date().toISOString().slice(0, 10);
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 5);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    // Mock accounts starting balance
    db.all.mockImplementation((query) => {
      if (query.includes('FROM accounts WHERE user_id=$1 AND archived=false')) {
        return Promise.resolve([{ starting_balance: '20000' }]);
      }
      if (query.includes('FROM recurring WHERE user_id=$1 AND active=1')) {
        return Promise.resolve([
          {
            id: 1,
            description: 'Salary',
            amount: 50000,
            type: 'income',
            category: 'Salary',
            frequency: 'monthly',
            next_date: nextDateStr,
            active: 1
          },
          {
            id: 2,
            description: 'Rent',
            amount: 15000,
            type: 'expense',
            category: 'Bills & Utilities',
            frequency: 'monthly',
            next_date: nextDateStr,
            active: 1
          }
        ]);
      }
      return Promise.resolve([]);
    });

    // Mock transactions net row & discretionary
    db.get.mockImplementation((query) => {
      if (query.includes('SUM(CASE WHEN type=\'income\' THEN amount ELSE -amount END)')) {
        return Promise.resolve({ net: '5000' });
      }
      if (query.includes('total_expense')) {
        return Promise.resolve({ total_expense: '15000' });
      }
      return Promise.resolve(null);
    });

    const req = {
      user: { id: 1 },
      query: { days: '30' }
    };
    let jsonResult = null;
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);

    expect(statusCode).toBe(200);
    expect(jsonResult).toBeDefined();
    expect(jsonResult.current_balance).toBe(25000); // 20000 + 5000
    expect(jsonResult.days).toBe(30);
    expect(jsonResult.timeline.length).toBe(31);
    expect(jsonResult.status).toBe('safe');
    expect(jsonResult.total_scheduled_income).toBe(50000);
    expect(jsonResult.total_scheduled_expense).toBe(15000);
    expect(jsonResult.upcoming_events.length).toBe(2);
  });

  test('flags danger status when balance dips into negative overdraft', async () => {
    const handler = getHandler('get', '/cashflow-forecast');

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 3);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    db.all.mockImplementation((query) => {
      if (query.includes('FROM accounts WHERE user_id=$1 AND archived=false')) {
        return Promise.resolve([{ starting_balance: '2000' }]);
      }
      if (query.includes('FROM recurring WHERE user_id=$1 AND active=1')) {
        return Promise.resolve([
          {
            id: 99,
            description: 'Large Loan EMI',
            amount: 10000,
            type: 'expense',
            category: 'Bills',
            frequency: 'monthly',
            next_date: nextDateStr,
            active: 1
          }
        ]);
      }
      return Promise.resolve([]);
    });

    db.get.mockImplementation((query) => {
      if (query.includes('SUM(CASE WHEN type=\'income\' THEN amount ELSE -amount END)')) {
        return Promise.resolve({ net: '0' });
      }
      if (query.includes('total_expense')) {
        return Promise.resolve({ total_expense: '0' });
      }
      return Promise.resolve(null);
    });

    const req = {
      user: { id: 1 },
      query: { days: '30' }
    };
    let jsonResult = null;
    const res = {
      status() { return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);

    expect(jsonResult.status).toBe('danger');
    expect(jsonResult.status_title).toBe('Overdraft Alert');
    expect(jsonResult.first_overdraft_date).toBe(nextDateStr);
    expect(jsonResult.lowest_point.balance).toBeLessThan(0);
    expect(jsonResult.insight).toContain('drops into deficit');
  });

  test('filters forecast to specific account when account_id is provided', async () => {
    const handler = getHandler('get', '/reports/cashflow-forecast');

    db.get.mockImplementation((query, params) => {
      if (query.includes('FROM accounts WHERE id=$1 AND user_id=$2')) {
        return Promise.resolve({ id: 5, name: 'HDFC Savings', type: 'bank', starting_balance: '50000' });
      }
      if (query.includes('FROM transactions WHERE account_id=$1')) {
        return Promise.resolve({ net: '-10000' });
      }
      if (query.includes('total_expense')) {
        return Promise.resolve({ total_expense: '5000' });
      }
      return Promise.resolve(null);
    });

    db.all.mockImplementation((query) => {
      if (query.includes('FROM recurring WHERE user_id=$1 AND active=1')) {
        return Promise.resolve([]);
      }
      if (query.includes('SELECT id, name, type, color, starting_balance FROM accounts')) {
        return Promise.resolve([{ id: 5, name: 'HDFC Savings', type: 'bank', starting_balance: '50000' }]);
      }
      return Promise.resolve([]);
    });

    const req = {
      user: { id: 1 },
      query: { days: '14', account_id: '5' }
    };
    let jsonResult = null;
    const res = {
      status() { return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);

    expect(jsonResult.account_id).toBe(5);
    expect(jsonResult.selected_account.name).toBe('HDFC Savings');
    expect(jsonResult.current_balance).toBe(40000); // 50000 - 10000
    expect(jsonResult.days).toBe(14);
  });
});

