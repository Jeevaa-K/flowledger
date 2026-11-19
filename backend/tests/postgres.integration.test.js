const request = require('supertest');
const { pool, db, initDB } = require('../src/db');
const { createApp } = require('../src/app');
const { COOKIE_NAME } = require('../src/config');

const app = createApp();

describe('Real PostgreSQL Integration & Security Regressions', () => {
  let isDbConnected = false;
  let testSchema = `test_flowledger_${Date.now()}`;

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      isDbConnected = true;
      // Isolate tests in a dedicated schema
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
      await pool.query(`SET search_path TO "${testSchema}", public`);
      await initDB();
    } catch (err) {
      if (process.env.CI) {
        throw new Error(`FATAL: CI requires active PostgreSQL connection: ${err.message}`);
      }
      console.warn('Real Postgres connection not reachable in current environment. In CI, PostgreSQL service container will run these tests.');
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      } catch (_) {}
    }
    await pool.end().catch(() => {});
  });

  const runIfDb = () => (isDbConnected ? describe : describe.skip);

  runIfDb()('Full API & Security Regressions against PostgreSQL', () => {
    let user1 = { name: 'Alice Test', email: `alice_${Date.now()}@example.com`, password: 'Password123' };
    let user2 = { name: 'Bob Test', email: `bob_${Date.now()}@example.com`, password: 'Password456' };
    let user1Cookie = '';
    let user2Cookie = '';
    let user1Id = null;
    let user2Id = null;

    // ── 1. Authentication ──────────────────────────────────────
    describe('Auth workflows', () => {
      test('Registers user 1 successfully', async () => {
        const res = await request(app)
          .post('/api/auth/register')
          .send(user1);
        expect(res.status).toBe(201);
        expect(res.body.user).toBeDefined();
        expect(res.body.user.email).toBe(user1.email);
        user1Id = res.body.user.id;
        const setCookie = res.headers['set-cookie'];
        expect(setCookie).toBeDefined();
        user1Cookie = setCookie.find(c => c.startsWith(`${COOKIE_NAME}=`));
      });

      test('Registers user 2 successfully', async () => {
        const res = await request(app)
          .post('/api/auth/register')
          .send(user2);
        expect(res.status).toBe(201);
        user2Id = res.body.user.id;
        const setCookie = res.headers['set-cookie'];
        user2Cookie = setCookie.find(c => c.startsWith(`${COOKIE_NAME}=`));
      });

      test('Duplicate email registration returns 409 Conflict', async () => {
        const res = await request(app)
          .post('/api/auth/register')
          .send(user1);
        expect(res.status).toBe(409);
      });

      test('Login with valid credentials sets session cookie', async () => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: user1.email, password: user1.password });
        expect(res.status).toBe(200);
        expect(res.body.user.email).toBe(user1.email);
      });

      test('Login with wrong password returns 401 Unauthorized', async () => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: user1.email, password: 'WrongPassword999' });
        expect(res.status).toBe(401);
      });

      test('GET /api/auth/me returns current user info', async () => {
        const res = await request(app)
          .get('/api/auth/me')
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(user1Id);
        expect(res.body.email).toBe(user1.email);
      });
    });

    // ── 2. Security Regression: Delete account without password ─
    describe('Security Regression: Delete account without password', () => {
      test('Fails with 400 when deleting account without password', async () => {
        const res = await request(app)
          .delete('/api/auth/account')
          .set('Cookie', user1Cookie)
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/password is required/i);

        // Verify user still exists in database
        const check = await db.get('SELECT * FROM users WHERE id=$1', [user1Id]);
        expect(check).toBeDefined();
        expect(check.email).toBe(user1.email);
      });

      test('Fails with 403 when deleting account with incorrect password', async () => {
        const res = await request(app)
          .delete('/api/auth/account')
          .set('Cookie', user1Cookie)
          .send({ password: 'IncorrectPassword123' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/incorrect password/i);

        // Verify user still exists in database
        const check = await db.get('SELECT * FROM users WHERE id=$1', [user1Id]);
        expect(check).toBeDefined();
      });
    });

    // ── 3. Transactions & buildTransactionFilters ──────────────
    describe('Transactions and Filtering', () => {
      let txnId = null;

      test('Creates an expense and income transaction', async () => {
        const resExp = await request(app)
          .post('/api/transactions')
          .set('Cookie', user1Cookie)
          .send({
            description: 'Weekly Groceries',
            amount: 1500,
            type: 'expense',
            category: 'Groceries',
            date: '2026-03-10',
            tags: ['food', 'home']
          });
        expect(resExp.status).toBe(201);
        expect(resExp.body.id).toBeDefined();
        txnId = resExp.body.id;

        const resInc = await request(app)
          .post('/api/transactions')
          .set('Cookie', user1Cookie)
          .send({
            description: 'Consulting Salary',
            amount: 50000,
            type: 'income',
            category: 'Salary',
            date: '2026-03-01'
          });
        expect(resInc.status).toBe(201);
      });

      test('Lists transactions with parameterized filters (buildTransactionFilters)', async () => {
        const res = await request(app)
          .get('/api/transactions?type=expense&category=Groceries&search=Weekly')
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(1);
        expect(res.body[0].description).toBe('Weekly Groceries');
      });

      test('Exports CSV with same filters (buildTransactionFilters)', async () => {
        const res = await request(app)
          .get('/api/transactions/export-csv?type=expense&category=Groceries')
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.text).toContain('Weekly Groceries');
      });

      test('Updates a transaction', async () => {
        const res = await request(app)
          .put(`/api/transactions/${txnId}`)
          .set('Cookie', user1Cookie)
          .send({
            description: 'Organic Groceries',
            amount: 1750,
            type: 'expense',
            category: 'Groceries',
            date: '2026-03-10'
          });
        expect(res.status).toBe(200);
        expect(res.body.description).toBe('Organic Groceries');
      });

      test('Deletes a transaction', async () => {
        const res = await request(app)
          .delete(`/api/transactions/${txnId}`)
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        const check = await db.get('SELECT * FROM transactions WHERE id=$1', [txnId]);
        expect(check).toBeUndefined();
      });
    });

    // ── 4. Budgets ─────────────────────────────────────────────
    describe('Budgets Management', () => {
      let budgetId = null;

      test('Creates and lists category budgets', async () => {
        const res = await request(app)
          .post('/api/budgets')
          .set('Cookie', user1Cookie)
          .send({ category: 'Food & Dining', monthly_limit: 8000 });
        expect(res.status).toBe(200);
        expect(res.body.category).toBe('Food & Dining');
        budgetId = res.body.id;

        const list = await request(app)
          .get('/api/budgets')
          .set('Cookie', user1Cookie);
        expect(list.status).toBe(200);
        const b = list.body.find(item => item.category === 'Food & Dining');
        expect(b).toBeDefined();
        expect(Number(b.monthly_limit)).toBe(8000);
      });

      test('Budget suggestions route returns targets', async () => {
        const res = await request(app)
          .get('/api/budgets/suggest')
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.suggestions)).toBe(true);
      });

      test('Deletes a budget', async () => {
        const res = await request(app)
          .delete(`/api/budgets/${budgetId}`)
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
        const check = await db.get('SELECT * FROM budgets WHERE id=$1', [budgetId]);
        expect(check).toBeUndefined();
      });
    });

    // ── 5. Groups & Security Regression: Wrong Group Member ────
    describe('Groups & Security Regression: Wrong group member', () => {
      let group1Id = null;
      let group2Id = null;
      let group1Members = [];
      let group2Members = [];

      test('User 1 creates Group 1 and User 2 creates Group 2', async () => {
        const res1 = await request(app)
          .post('/api/groups')
          .set('Cookie', user1Cookie)
          .send({ name: 'Trip to Goa', members: ['Charlie'] });
        expect(res1.status).toBe(200);
        group1Id = res1.body.group.id;

        const res2 = await request(app)
          .post('/api/groups')
          .set('Cookie', user2Cookie)
          .send({ name: 'Apartment Roommates', members: ['Dave'] });
        expect(res2.status).toBe(200);
        group2Id = res2.body.group.id;

        group1Members = await db.all('SELECT * FROM group_members WHERE group_id=$1', [group1Id]);
        group2Members = await db.all('SELECT * FROM group_members WHERE group_id=$1', [group2Id]);
        expect(group1Members.length).toBe(2);
        expect(group2Members.length).toBe(2);
      });

      test('Security Regression: Reject expense if payer belongs to a DIFFERENT group', async () => {
        const wrongPayerId = group2Members[0].id;
        const res = await request(app)
          .post(`/api/groups/${group1Id}/expenses`)
          .set('Cookie', user1Cookie)
          .send({
            description: 'Beach Resort Hotel',
            amount: 6000,
            payer_id: wrongPayerId,
            category: 'Travel'
          });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/does not belong to this group/i);
      });

      test('Security Regression: Reject expense if split member belongs to a DIFFERENT group', async () => {
        const validPayerId = group1Members[0].id;
        const wrongSplitMemberId = group2Members[0].id;
        const res = await request(app)
          .post(`/api/groups/${group1Id}/expenses`)
          .set('Cookie', user1Cookie)
          .send({
            description: 'Beach Resort Hotel',
            amount: 6000,
            payer_id: validPayerId,
            splits: [
              { member_id: group1Members[0].id, split_amount: 3000 },
              { member_id: wrongSplitMemberId, split_amount: 3000 }
            ]
          });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/does not belong to this group/i);
      });

      test('Allows valid expense with equal split among group members', async () => {
        const validPayerId = group1Members[0].id;
        const res = await request(app)
          .post(`/api/groups/${group1Id}/expenses`)
          .set('Cookie', user1Cookie)
          .send({
            description: 'Dinner at Beach',
            amount: 2000,
            payer_id: validPayerId
          });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const details = await request(app)
          .get(`/api/groups/${group1Id}`)
          .set('Cookie', user1Cookie);
        expect(details.status).toBe(200);
        expect(details.body.expenses.length).toBe(1);
      });
    });

    // ── 6. Recurring & Interval Subscription Detection ─────────
    describe('Recurring and Subscription Detection', () => {
      let recId = null;

      test('Creates recurring rule', async () => {
        const res = await request(app)
          .post('/api/recurring')
          .set('Cookie', user1Cookie)
          .send({
            description: 'Cloud Storage',
            amount: 499,
            type: 'expense',
            category: 'Bills & Utilities',
            frequency: 'monthly',
            next_date: '2026-04-01'
          });
        expect(res.status).toBe(201);
        recId = res.body.id;
      });

      test('Detects subscriptions only with 3+ occurrences and regular intervals (ignores two coffees)', async () => {
        // 1. Insert 3 monthly transactions for "Gym Membership" (gap ~30 days)
        await db.run(
          `INSERT INTO transactions (user_id, description, amount, type, category, date) VALUES
           ($1, 'Anytime Gym Fitness', 1200, 'expense', 'Health', '2026-01-05'),
           ($1, 'Anytime Gym Fitness', 1200, 'expense', 'Health', '2026-02-04'),
           ($1, 'Anytime Gym Fitness', 1200, 'expense', 'Health', '2026-03-06')`,
          [user1Id]
        );

        // 2. Insert 2 occasional coffees (count = 2, gaps 1 day) - SHOULD NOT MATCH
        await db.run(
          `INSERT INTO transactions (user_id, description, amount, type, category, date) VALUES
           ($1, 'Blue Tokai Coffee', 240, 'expense', 'Food & Dining', '2026-03-01'),
           ($1, 'Blue Tokai Coffee', 240, 'expense', 'Food & Dining', '2026-03-02')`,
          [user1Id]
        );

        const res = await request(app)
          .get('/api/recurring/detect')
          .set('Cookie', user1Cookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        // Gym must be detected as monthly subscription with 3 occurrences
        const gym = res.body.find(d => d.description.toLowerCase().includes('gym'));
        expect(gym).toBeDefined();
        expect(gym.frequency).toBe('monthly');
        expect(gym.occurrences).toBe(3);
        expect(gym.amount).toBe(1200);

        // Coffee must NOT be detected!
        const coffee = res.body.find(d => d.description.toLowerCase().includes('coffee'));
        expect(coffee).toBeUndefined();
      });

      test('Deletes recurring rule', async () => {
        const res = await request(app)
          .delete(`/api/recurring/${recId}`)
          .set('Cookie', user1Cookie);
        expect(res.status).toBe(200);
      });
    });

    // ── 7. Clean up Account with Password ──────────────────────
    describe('Account deletion with password', () => {
      test('Successfully deletes user 1 with valid password', async () => {
        const res = await request(app)
          .delete('/api/auth/account')
          .set('Cookie', user1Cookie)
          .send({ password: user1.password });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const check = await db.get('SELECT * FROM users WHERE id=$1', [user1Id]);
        expect(check).toBeUndefined();
      });
    });
  });
});
