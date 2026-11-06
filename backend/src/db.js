const { Pool, types } = require('pg');
const { isProd } = require('./config');

// Return SQL DATE columns as plain 'YYYY-MM-DD' strings. The default parser
// builds a JS Date at *local* midnight, which shifts the day (e.g. one day
// early in IST) as soon as it is serialized with toISOString().
types.setTypeParser(1082, (value) => value);

// TLS to the database in production. Certificates are verified by default.
//   DB_SSL=false                    -> no TLS (e.g. Render internal URL)
//   DB_SSL_REJECT_UNAUTHORIZED=false -> TLS without verification (last resort)
//   DB_SSL_CA=<PEM text>            -> trust a specific CA certificate
function buildSsl() {
  if (!isProd || process.env.DB_SSL === 'false') return false;
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') return { rejectUnauthorized: false };
  const ssl = { rejectUnauthorized: true };
  if (process.env.DB_SSL_CA) ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  return ssl;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSsl()
});

const db = {
  query: (text, params) => pool.query(text, params),
  get: async (text, params) => (await pool.query(text, params)).rows[0],
  all: async (text, params) => (await pool.query(text, params)).rows,
  run: (text, params) => pool.query(text, params)
};

async function initDB() {
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    currency TEXT DEFAULT '₹',
    theme TEXT DEFAULT 'light',
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS budgets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    monthly_limit NUMERIC NOT NULL,
    UNIQUE(user_id, category)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS ai_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model TEXT DEFAULT 'chatgpt',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS ai_chats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES ai_sessions(id) ON DELETE CASCADE,
    model TEXT DEFAULT 'chatgpt',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES ai_sessions(id) ON DELETE CASCADE`);
  await db.run(`ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'chatgpt'`);
  await db.run(`CREATE TABLE IF NOT EXISTS recurring (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    frequency TEXT NOT NULL,
    next_date DATE NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS goals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target NUMERIC NOT NULL,
    saved NUMERIC NOT NULL DEFAULT 0,
    target_date DATE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'cash',
    starting_balance NUMERIC NOT NULL DEFAULT 0,
    color TEXT DEFAULT '#6366f1',
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  // Nullable + ON DELETE SET NULL on purpose: deleting an account should
  // never delete the transaction history that happened on it — it just
  // becomes unassigned ("No account") the same way deleting a budget
  // leaves its transactions untouched elsewhere in this file.
  await db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL`);
  // Free-text tags, stored as a native Postgres array rather than a join
  // table — tags are ad-hoc and per-user (no cross-user tag catalog to
  // normalize against), so an array column keeps writes to one row and
  // reads simple. GIN index makes "has tag X" filtering fast even as a
  // user's transaction count grows.
  await db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);
  // Referenced by text search and CSV export; the column was never created before.
  await db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT`);
  await db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_id TEXT`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_tags ON transactions USING GIN (tags)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_split_id ON transactions (split_id)`);
  // ── Group Expense Splitting Tables ─────────────────────────────
  await db.run(`CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS group_expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    payer_id INTEGER NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    category TEXT DEFAULT 'Other',
    date DATE NOT NULL,
    is_settlement BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS group_splits (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
    split_amount NUMERIC NOT NULL
  )`);
  await migrateDefaultAccounts();
  console.log('✅ Database tables ready');
}

// One-time backfill: any user who has transactions but no accounts yet
// (i.e. everyone from before this feature existed) gets a single "Main
// Account" and all their existing unassigned transactions are pointed at
// it. Runs on every boot but is a no-op after the first time per user —
// safe to leave in initDB() alongside the other idempotent migrations.
async function migrateDefaultAccounts() {
  const usersNeedingMigration = await db.all(`
    SELECT DISTINCT t.user_id FROM transactions t
    WHERE t.account_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = t.user_id)
  `);
  for (const { user_id } of usersNeedingMigration) {
    const account = await db.get(
      `INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Main Account', 'cash') RETURNING id`,
      [user_id]
    );
    await db.run(
      `UPDATE transactions SET account_id=$1 WHERE user_id=$2 AND account_id IS NULL`,
      [account.id, user_id]
    );
  }
  if (usersNeedingMigration.length) {
    console.log(`✅ Created default accounts for ${usersNeedingMigration.length} user(s)`);
  }
}


module.exports = { pool, db, initDB };
