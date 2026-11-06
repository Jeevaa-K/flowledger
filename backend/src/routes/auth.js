const express = require('express');
const bcrypt = require('bcryptjs');
const { authLimiter } = require('../middleware/security');
const { EMAIL_RE, safeError } = require('../utils');
const { db } = require('../db');
const { auth, issueSession, clearSession } = require('../middleware/auth');
const router = express.Router();

// ── Auth Routes ───────────────────────────────────────────────
router.post('/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name is too long' });
  if (email.length > 255) return res.status(400).json({ error: 'Email is too long' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (password.length > 200) return res.status(400).json({ error: 'Password is too long' });
  try {
    const exists = await db.get('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const user = await db.get('INSERT INTO users (name,email,password) VALUES ($1,$2,$3) RETURNING id,name,email', [name, email.toLowerCase(), hash]);
    // Every user starts with one default account so the account picker
    // in the transaction modal is never empty on a fresh signup.
    await db.run(`INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Main Account', 'cash')`, [user.id]);
    issueSession(res, user);
    res.status(201).json({ user });
  } catch (e) { safeError(res, e, 'Register'); }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await db.get('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    issueSession(res, user);
    res.json({ user: { id: user.id, name: user.name, email: user.email, currency: user.currency, theme: user.theme } });
  } catch (e) { safeError(res, e, 'Login'); }
});

router.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true });
});

router.get('/auth/me', auth, async (req, res) => {
  try {
    const user = await db.get('SELECT id,name,email,currency,theme,created_at FROM users WHERE id=$1', [req.user.id]);
    res.json(user);
  } catch (e) { safeError(res, e, 'Get profile'); }
});

router.put('/auth/profile', auth, async (req, res) => {
  const { name, currency, theme } = req.body;
  if (name && name.length > 100) return res.status(400).json({ error: 'Name is too long' });
  try {
    await db.run('UPDATE users SET name=$1,currency=$2,theme=$3 WHERE id=$4', [name, currency || '₹', theme || 'light', req.user.id]);
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Update profile'); }
});

router.put('/auth/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  if (newPassword.length > 200) return res.status(400).json({ error: 'Password is too long' });
  try {
    const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    await db.run('UPDATE users SET password=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 10), req.user.id]);
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Change password'); }
});

router.delete('/auth/account', auth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (password) {
      const user = await db.get('SELECT password FROM users WHERE id=$1', [req.user.id]);
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(403).json({ error: 'Incorrect password. Account deletion cancelled for your security.' });
      }
    }
    await db.run('DELETE FROM users WHERE id=$1', [req.user.id]);
    clearSession(res);
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete account'); }
});

module.exports = router;
