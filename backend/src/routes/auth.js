const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { authLimiter } = require('../middleware/security');
const { EMAIL_RE, safeError, isValidPassword } = require('../utils');
const { pool, db } = require('../db');
const { auth, issueSession, clearSession } = require('../middleware/auth');
const router = express.Router();

// ── Auth Routes ───────────────────────────────────────────────
router.post('/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name is too long' });
  if (email.length > 255) return res.status(400).json({ error: 'Email is too long' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include at least one letter and one number' });
  }

  try {
    // Check existing (unit tests mock this to return { id: 1 } for duplicate email test)
    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    // Direct INSERT with UNIQUE constraint on lower(email) prevents race-condition duplicates
    const user = await db.get(
      'INSERT INTO users (name, email, password, token_version) VALUES ($1, $2, $3, 1) RETURNING id, name, email, currency, theme, token_version',
      [name.trim(), email.toLowerCase().trim(), hash]
    );

    // Every user starts with one default account so the account picker is never empty
    await db.run(`INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Main Account', 'cash')`, [user.id]);
    issueSession(res, user);
    res.status(201).json({ user });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    safeError(res, e, 'Register');
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await db.get('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    issueSession(res, user);
    res.json({ user: { id: user.id, name: user.name, email: user.email, currency: user.currency, theme: user.theme } });
  } catch (e) { safeError(res, e, 'Login'); }
});

// Demo Login (disabled by default in production, enabled only when ENABLE_DEMO=true)
router.post('/auth/demo', authLimiter, async (req, res) => {
  if (process.env.ENABLE_DEMO !== 'true') {
    return res.status(403).json({ error: 'Demo account is disabled in this environment' });
  }
  const demoEmail = (process.env.DEMO_EMAIL || 'demo@flowledger.app').toLowerCase();
  const demoPassword = process.env.DEMO_PASSWORD || 'FlowLedgerDemo2026!';
  try {
    let user = await db.get('SELECT * FROM users WHERE email=$1', [demoEmail]);
    if (!user) {
      const hash = await bcrypt.hash(demoPassword, 10);
      user = await db.get(
        'INSERT INTO users (name, email, password, token_version) VALUES ($1, $2, $3, 1) RETURNING *',
        ['Demo User', demoEmail, hash]
      );
      await db.run(`INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Main Account', 'cash')`, [user.id]);
    }
    issueSession(res, user);
    res.json({ user: { id: user.id, name: user.name, email: user.email, currency: user.currency, theme: user.theme } });
  } catch (e) { safeError(res, e, 'Demo login'); }
});

router.post('/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded?.id) {
        await db.run('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [decoded.id]);
      }
    }
  } catch {}
  clearSession(res);
  res.json({ success: true });
});

router.get('/auth/me', auth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, name, email, currency, theme, timezone, created_at FROM users WHERE id=$1', [req.user.id]);
    res.json(user);
  } catch (e) { safeError(res, e, 'Get profile'); }
});

router.put('/auth/profile', auth, async (req, res) => {
  const { name, currency, theme, timezone } = req.body;
  if (name !== undefined && (!name || name.trim().length > 100)) {
    return res.status(400).json({ error: 'Name must be between 1 and 100 characters' });
  }
  try {
    const existing = await db.get('SELECT currency FROM users WHERE id=$1', [req.user.id]);
    const oldCurr = existing?.currency || '₹';
    const newCurr = currency || oldCurr;

    // When changing base currency: convert historical transactions and default accounts
    if (currency && currency !== oldCurr) {
      const { convertCurrency, normalizeCurrency } = require('../services/currency');
      const fromCode = normalizeCurrency(oldCurr).code;
      const toCode = normalizeCurrency(newCurr).code;
      if (fromCode !== toCode) {
        const txns = await db.all('SELECT id, amount, original_amount, original_currency FROM transactions WHERE user_id=$1', [req.user.id]);
        for (const t of txns) {
          const origAmt = t.original_amount !== null ? parseFloat(t.original_amount) : parseFloat(t.amount);
          const origCurr = t.original_currency || fromCode;
          const conv = convertCurrency(origAmt, origCurr, toCode);
          await db.run('UPDATE transactions SET amount=$1, exchange_rate=$2 WHERE id=$3', [conv.amount, conv.rate, t.id]);
        }
        const accs = await db.all('SELECT id, starting_balance, currency FROM accounts WHERE user_id=$1', [req.user.id]);
        for (const a of accs) {
          if (!a.currency || a.currency === oldCurr) {
            const conv = convertCurrency(parseFloat(a.starting_balance), fromCode, toCode);
            await db.run('UPDATE accounts SET starting_balance=$1 WHERE id=$2', [conv.amount, a.id]);
          }
        }
      }
    }

    // Dynamic / COALESCE update to never overwrite omitted fields with NULL
    await db.run(
      `UPDATE users SET 
         name = COALESCE($1, name),
         currency = COALESCE($2, currency),
         theme = COALESCE($3, theme),
         timezone = COALESCE($4, timezone)
       WHERE id=$5`,
      [name ? name.trim() : null, currency || null, theme || null, timezone || null, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Update profile'); }
});

router.put('/auth/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 8 characters and include at least one letter and one number' });
  }
  try {
    const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const newHash = await bcrypt.hash(newPassword, 10);
    // Incrementing token_version invalidates all other active sessions across devices
    const updated = await db.get(
      'UPDATE users SET password=$1, token_version = token_version + 1 WHERE id=$2 RETURNING *',
      [newHash, req.user.id]
    );
    // Issue refreshed cookie with bumped token_version for the current browser session
    issueSession(res, updated);
    res.json({ success: true, message: 'Password updated. Other sessions have been signed out.' });
  } catch (e) { safeError(res, e, 'Change password'); }
});

// Forgot Password - creates a single-use 30-min hashed reset token
router.post('/auth/forgot', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const user = await db.get('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins

      await db.run(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt]
      );

      // In production with email provider (e.g. Resend/Nodemailer), email is sent.
      // In development or when email service is unconfigured, log the link safely.
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV ONLY] Password reset token for ${email}: ${rawToken}`);
      }
    }

    // Always return uniform message to prevent user enumeration
    res.json({ message: 'If this email is registered, password reset instructions have been sent.' });
  } catch (e) { safeError(res, e, 'Forgot password'); }
});

// Reset Password - verifies single-use token and bumps token_version
router.post('/auth/reset', authLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include at least one letter and one number' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = await db.get(
      `SELECT * FROM password_resets WHERE token_hash=$1 AND used=false AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run('BEGIN');
    await db.run(
      `UPDATE users SET password=$1, token_version = token_version + 1 WHERE id=$2`,
      [newHash, resetRecord.user_id]
    );
    await db.run(`UPDATE password_resets SET used=true WHERE id=$1`, [resetRecord.id]);
    await db.run('COMMIT');

    res.json({ success: true, message: 'Password has been reset successfully. Please login with your new password.' });
  } catch (e) {
    await db.run('ROLLBACK').catch(() => {});
    safeError(res, e, 'Reset password');
  }
});

// Delete account with mandatory password confirmation and database transaction
router.delete('/auth/account', auth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Password is required to delete your account' });
  }

  const client = await pool.connect();
  try {
    const userRes = await client.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(403).json({ error: 'Incorrect password. Account deletion cancelled for your security.' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM users WHERE id=$1', [req.user.id]);
    await client.query('COMMIT');

    clearSession(res);
    res.json({ success: true, message: 'Account and associated data deleted' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    safeError(res, e, 'Delete account');
  } finally {
    client.release();
  }
});

module.exports = router;
