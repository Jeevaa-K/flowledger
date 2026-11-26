const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// No real database is needed: the db module is mocked.
jest.mock('../src/db', () => {
  const mockDb = { get: jest.fn(), all: jest.fn(), run: jest.fn(), query: jest.fn() };
  return {
    db: mockDb,
    pool: { query: jest.fn(), end: jest.fn() },
    initDB: jest.fn(),
    withTransaction: jest.fn(async (fn) => {
      const mockClient = {
        query: jest.fn(async (text, params) => {
          const res = await mockDb.run(text, params);
          return res || { rows: [] };
        })
      };
      return fn(mockClient);
    })
  };
});

const { db } = require('../src/db');
const { createApp } = require('../src/app');
const { COOKIE_NAME, JWT_SECRET } = require('../src/config');

const app = createApp();
const sessionCookie = (payload = { id: 1, name: 'T', email: 't@t.io' }) =>
  `${COOKIE_NAME}=${jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })}`;

beforeEach(() => jest.clearAllMocks());

describe('health & routing', () => {
  test('GET /api/health is public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('unknown API path returns JSON 404, not the SPA page', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  test('non-API paths serve the frontend', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('malformed JSON returns 400', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});

describe('security headers', () => {
  test('CSP forbids inline scripts', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src '));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toMatch(/unsafe-inline/);
  });
});

describe('CORS & CSRF guard', () => {
  test('foreign origin cannot make state-changing requests', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  test('listed origin is allowed', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'https://app.example.com');
    expect(res.status).toBe(200);
  });

  test('same-origin request is allowed', async () => {
    const res = await request(app).post('/api/auth/logout')
      .set('Host', 'localhost:3001').set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
  });

  test('foreign origin gets no CORS headers on reads', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('authentication', () => {
  test('protected route without a session → 401', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(401);
  });

  test('tampered cookie → 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=garbage`);
    expect(res.status).toBe(401);
  });

  test('token signed with a different secret → 401', async () => {
    const bad = jwt.sign({ id: 1 }, 'another-secret-another-secret-123456');
    const res = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=${bad}`);
    expect(res.status).toBe(401);
  });

  test('valid session cookie reaches the handler', async () => {
    db.get.mockResolvedValue({ id: 1, name: 'T', email: 't@t.io' });
    const res = await request(app).get('/api/auth/me').set('Cookie', sessionCookie());
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('t@t.io');
  });

  test('Bearer header still works for API clients', async () => {
    db.get.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1 }, JWT_SECRET);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('login sets an httpOnly cookie and never returns the token in the body or X-Auth-Token on web', async () => {
    db.get.mockResolvedValue({
      id: 7, name: 'Jeeva', email: 'j@j.io', currency: '₹', theme: 'light',
      password: await bcrypt.hash('secret123', 4)
    });
    const res = await request(app).post('/api/auth/login').send({ email: 'J@J.io', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.email).toBe('j@j.io');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith(COOKIE_NAME));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.headers['x-auth-token']).toBeUndefined();
  });

  test('login with X-Client: native provides X-Auth-Token header', async () => {
    db.get.mockResolvedValue({
      id: 7, name: 'Jeeva', email: 'j@j.io', currency: '₹', theme: 'light',
      password: await bcrypt.hash('secret123', 4)
    });
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Client', 'native')
      .send({ email: 'j@j.io', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-token']).toBeDefined();
  });

  test('API responses include Cache-Control: no-store', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('wrong password → 401 and no cookie', async () => {
    db.get.mockResolvedValue({ id: 7, email: 'j@j.io', password: await bcrypt.hash('right-pass', 4) });
    const res = await request(app).post('/api/auth/login').send({ email: 'j@j.io', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('logout clears the session cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith(COOKIE_NAME));
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('logout – per-device cookie clearing', () => {
  test('logout with a valid cookie clears the cookie without bumping token_version', async () => {
    const token = jwt.sign({ id: 42, name: 'U', email: 'u@u.io', token_version: 1 }, JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `${COOKIE_NAME}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Logout must not invalidate other devices' sessions (token_version is for password change/reset)
    expect(db.run).not.toHaveBeenCalled();
    // Session cookie must be cleared
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith(COOKIE_NAME));
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  test('logout with no token still succeeds and clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(db.run).not.toHaveBeenCalled();
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith(COOKIE_NAME));
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  test('wrong current password on PUT /api/auth/password → 403', async () => {
    db.get.mockResolvedValueOnce({ id: 7, name: 'J', email: 'j@j.io', token_version: 1 }); // auth middleware
    db.get.mockResolvedValueOnce({ id: 7, password: await bcrypt.hash('right-pass', 4) }); // password lookup
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', sessionCookie({ id: 7, name: 'J', email: 'j@j.io', token_version: 1 }))
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword123' });
    expect(res.status).toBe(403);
  });
});

describe('currency change – amount conversion', () => {
  // Helper: sign an auth cookie for user id=1 with token_version=1
  const authCookie = () => sessionCookie({ id: 1, name: 'T', email: 't@t.io', token_version: 1 });

  test('PUT /auth/profile converts transaction amounts using conv.converted, not conv.amount', async () => {
    // db.get: (1) SELECT currency → oldCurr='₹', (2) auth middleware user lookup
    db.get
      .mockResolvedValueOnce({ id: 1, name: 'T', email: 't@t.io', currency: '₹', theme: 'light', token_version: 1 }) // auth middleware
      .mockResolvedValueOnce({ currency: '₹' }); // SELECT currency for profile

    // db.all: transactions then accounts
    db.all
      .mockResolvedValueOnce([
        { id: 10, amount: '8450', original_amount: null, original_currency: null }
      ])
      .mockResolvedValueOnce([
        { id: 20, starting_balance: '10000', currency: '₹' }
      ]);

    db.run.mockResolvedValue({});

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', authCookie())
      .send({ currency: '$' });

    expect(res.status).toBe(200);

    // Find the UPDATE transactions call
    const txnUpdate = db.run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE transactions SET amount')
    );
    expect(txnUpdate).toBeDefined();

    // conv.amount = original input (8450); conv.converted = 8450 / 84.5 ≈ 100.00
    // The saved amount must NOT equal 8450 (the raw input) – it must be the converted value
    const savedAmount = txnUpdate[1][0];
    expect(savedAmount).not.toBe(8450);
    expect(savedAmount).toBeCloseTo(100, 0); // 8450 INR → ~$100 USD at fallback rate

    // Same check for accounts
    const accUpdate = db.run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE accounts SET starting_balance')
    );
    expect(accUpdate).toBeDefined();
    const savedBalance = accUpdate[1][0];
    expect(savedBalance).not.toBe(10000);
    expect(savedBalance).toBeCloseTo(118.34, 0); // 10000 INR → ~$118 USD
  });

  test('no currency change → no conversion queries run', async () => {
    db.get
      .mockResolvedValueOnce({ id: 1, name: 'T', email: 't@t.io', currency: '₹', theme: 'light', token_version: 1 })
      .mockResolvedValueOnce({ currency: '₹' });
    db.run.mockResolvedValue({});

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', authCookie())
      .send({ theme: 'dark' }); // no currency key → no conversion

    expect(res.status).toBe(200);
    const hasConversionCall = db.all.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('transactions')
    );
    expect(hasConversionCall).toBe(false);
  });
});

describe('forgot & reset password flow', () => {
  test('forgot password returns generic message for registered email', async () => {
    db.get.mockResolvedValueOnce({ id: 1, email: 'user@example.com' });
    db.run.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/auth/forgot')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset instructions have been sent/i);
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO password_resets'),
      expect.any(Array)
    );
  });

  test('forgot password returns same message for unregistered email', async () => {
    db.get.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/forgot')
      .send({ email: 'unknown@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset instructions have been sent/i);
  });

  test('reset password with valid token updates password and invalidates sessions atomically', async () => {
    db.get.mockResolvedValueOnce({
      id: 5,
      user_id: 1,
      token_hash: 'abc',
      expires_at: new Date(Date.now() + 60000)
    });
    db.run.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/reset')
      .send({ token: 'abc', newPassword: 'NewPassword123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET password=$1, token_version = token_version + 1'),
      expect.any(Array)
    );
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE password_resets SET used=true'),
      expect.any(Array)
    );
  });
});

describe('registration validation', () => {
  const post = (body) => request(app).post('/api/auth/register').send(body);

  test.each([
    [{}, 'missing fields'],
    [{ name: 'A', email: 'not-an-email', password: '123456' }, 'bad email'],
    [{ name: 'A', email: 'a@b.io', password: '123' }, 'short password'],
    [{ name: 'x'.repeat(101), email: 'a@b.io', password: '123456' }, 'long name']
  ])('%j → 400 (%s)', async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(db.get).not.toHaveBeenCalled();
  });

  test('duplicate email → 409', async () => {
    db.get.mockResolvedValueOnce({ id: 1 });
    const res = await post({ name: 'A', email: 'a@b.io', password: '123456' });
    expect(res.status).toBe(409);
  });
});

describe('demo account security & read-only restrictions', () => {
  const origEnableDemo = process.env.ENABLE_DEMO;
  const origDemoPassword = process.env.DEMO_PASSWORD;
  const origDemoEmail = process.env.DEMO_EMAIL;

  afterEach(() => {
    process.env.ENABLE_DEMO = origEnableDemo;
    process.env.DEMO_PASSWORD = origDemoPassword;
    process.env.DEMO_EMAIL = origDemoEmail;
  });

  test('POST /api/auth/demo is rejected when ENABLE_DEMO is not true', async () => {
    delete process.env.ENABLE_DEMO;
    const res = await request(app).post('/api/auth/demo');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });

  test('POST /api/auth/demo fails if DEMO_PASSWORD is not set', async () => {
    process.env.ENABLE_DEMO = 'true';
    delete process.env.DEMO_PASSWORD;
    const res = await request(app).post('/api/auth/demo');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/DEMO_PASSWORD/);
  });

  test('POST /api/auth/demo succeeds with DEMO_PASSWORD and sets session', async () => {
    process.env.ENABLE_DEMO = 'true';
    process.env.DEMO_PASSWORD = 'CustomDemoSecret123!';
    db.get.mockResolvedValueOnce({
      id: 99,
      name: 'Demo User',
      email: 'demo@flowledger.app',
      currency: '₹',
      theme: 'light',
      ai_consent: false,
      token_version: 1
    });

    const res = await request(app).post('/api/auth/demo');
    expect(res.status).toBe(200);
    expect(res.body.user.is_demo).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('demo user cannot change password (PUT /api/auth/password blocked)', async () => {
    const demoUser = { id: 99, name: 'Demo User', email: 'demo@flowledger.app', token_version: 1 };
    db.get.mockResolvedValueOnce(demoUser); // auth middleware

    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', sessionCookie(demoUser))
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/demo account/i);
  });

  test('demo user cannot delete account (DELETE /api/auth/account blocked)', async () => {
    const demoUser = { id: 99, name: 'Demo User', email: 'demo@flowledger.app', token_version: 1 };
    db.get.mockResolvedValueOnce(demoUser); // auth middleware

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', sessionCookie(demoUser))
      .send({ password: 'anyPassword' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/demo account/i);
  });

  test('demo user is read-only for data mutations (POST/PUT/DELETE /api/transactions)', async () => {
    const demoUser = { id: 99, name: 'Demo User', email: 'demo@flowledger.app', token_version: 1 };

    // POST /api/transactions
    db.get.mockResolvedValueOnce(demoUser);
    const postRes = await request(app)
      .post('/api/transactions')
      .set('Cookie', sessionCookie(demoUser))
      .send({ description: 'Coffee', amount: 50, type: 'expense', category: 'Food', date: '2026-01-01' });

    expect(postRes.status).toBe(403);
    expect(postRes.body.error).toMatch(/read-only/i);

    // DELETE /api/transactions/1
    db.get.mockResolvedValueOnce(demoUser);
    const delRes = await request(app)
      .delete('/api/transactions/1')
      .set('Cookie', sessionCookie(demoUser));

    expect(delRes.status).toBe(403);
    expect(delRes.body.error).toMatch(/read-only/i);
  });

  test('demo user can read transactions (GET /api/transactions allowed)', async () => {
    const demoUser = { id: 99, name: 'Demo User', email: 'demo@flowledger.app', token_version: 1 };
    db.get.mockResolvedValueOnce(demoUser); // auth middleware
    db.all.mockResolvedValueOnce([]); // get transactions

    const res = await request(app)
      .get('/api/transactions')
      .set('Cookie', sessionCookie(demoUser));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
