const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// No real database is needed: the db module is mocked.
jest.mock('../src/db', () => ({
  db: { get: jest.fn(), all: jest.fn(), run: jest.fn(), query: jest.fn() },
  pool: { query: jest.fn(), end: jest.fn() },
  initDB: jest.fn()
}));

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

  test('login sets an httpOnly cookie and never returns the token in the body', async () => {
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
