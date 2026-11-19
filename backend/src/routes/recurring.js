const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError, sanitizeTags, getUserToday, toDateString } = require('../utils');
const router = express.Router();

// Allowlist of valid frequency values — rejects typos / unexpected strings
// before they reach the cron job where addPeriod would loop forever on them.
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

// ── Recurring ─────────────────────────────────────────────────
router.get('/recurring', auth, async (req, res) => {
  try { res.json(await db.all('SELECT * FROM recurring WHERE user_id=$1 ORDER BY next_date ASC', [req.user.id])); }
  catch (e) { safeError(res, e, 'List recurring'); }
});

router.get('/recurring/detect', auth, async (req, res) => {
  try {
    // 1. Fetch user's existing recurring rules to avoid suggesting already-tracked subscriptions
    const existing = await db.all('SELECT LOWER(description) as desc_lower FROM recurring WHERE user_id=$1', [req.user.id]);
    const existingSet = new Set(existing.map(e => (e.desc_lower || '').trim()));

    // 2. Fetch recent transactions (up to 300)
    const txns = await db.all(
      'SELECT id, description, amount, type, category, date FROM transactions WHERE user_id=$1 ORDER BY date DESC LIMIT 300',
      [req.user.id]
    );

    const KNOWN_SUBS = [
      'netflix', 'spotify', 'prime', 'amazon prime', 'youtube', 'disney', 'hotstar',
      'apple', 'icloud', 'google', 'google one', 'gym', 'fitness', 'rent', 'wifi',
      'broadband', 'airtel', 'jio', 'vi', 'adobe', 'chatgpt', 'openai', 'github',
      'dropbox', 'audible', 'hulu', 'electricity', 'water', 'gas', 'maintenance',
      'newspaper', 'times prime', 'swiggy one', 'zomato gold', 'uber pass', 'playstation', 'xbox'
    ];

    // Group transactions by merchant and amount
    const groups = {};
    for (const t of txns) {
      if (!t.description || !t.amount) continue;
      const amt = parseFloat(t.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const cleanDesc = t.description.trim();
      const norm = cleanDesc.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!norm) continue;

      const groupKey = `${norm}___${amt.toFixed(2)}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          norm,
          amount: amt,
          originalDesc: cleanDesc,
          type: t.type || 'expense',
          category: t.category || 'Other',
          entries: []
        };
      }
      groups[groupKey].entries.push(t);
    }

    const detected = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const group of Object.values(groups)) {
      // Must have at least 3 occurrences (filters out occasional repeated expenses like 2 coffees)
      if (group.entries.length < 3) continue;

      // Skip if already in recurring
      const isAlreadyTracked = [...existingSet].some(ex => group.norm.includes(ex) || ex.includes(group.norm));
      if (isAlreadyTracked) continue;

      // Sort entries chronologically to inspect date intervals
      const sorted = [...group.entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const dates = [...new Set(sorted.map(e => toDateString(e.date)))].map(d => new Date(d));
      if (dates.length < 3) continue;

      // Calculate gaps in days between consecutive dates
      const gaps = [];
      for (let i = 0; i < dates.length - 1; i++) {
        const diffDays = Math.round((dates[i + 1] - dates[i]) / (1000 * 60 * 60 * 24));
        gaps.push(diffDays);
      }

      // Check cadence (weekly ~7 ±3 days, monthly ~30 ±3 days, yearly ~365 ±3 days)
      const cadences = [
        { name: 'weekly', target: 7, margin: 3 },
        { name: 'monthly', target: 30, margin: 3 },
        { name: 'yearly', target: 365, margin: 3 }
      ];

      let detectedFrequency = null;
      for (const c of cadences) {
        if (gaps.every(gap => Math.abs(gap - c.target) <= c.margin)) {
          detectedFrequency = c.name;
          break;
        }
      }

      if (!detectedFrequency) continue;

      const isKnownSub = KNOWN_SUBS.some(sub => group.norm.includes(sub));
      const latestTxn = sorted[sorted.length - 1];

      // Calculate next renewal date
      const nextDate = new Date(latestTxn.date);
      if (detectedFrequency === 'weekly') {
        nextDate.setDate(nextDate.getDate() + 7);
      } else if (detectedFrequency === 'yearly') {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      } else {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }

      while (nextDate.toISOString().slice(0, 10) < todayStr) {
        if (detectedFrequency === 'weekly') {
          nextDate.setDate(nextDate.getDate() + 7);
        } else if (detectedFrequency === 'yearly') {
          nextDate.setFullYear(nextDate.getFullYear() + 1);
        } else {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
      }

      detected.push({
        description: group.originalDesc,
        amount: group.amount,
        type: group.type,
        category: group.category || (isKnownSub ? 'Entertainment' : 'Bills'),
        frequency: detectedFrequency,
        next_date: nextDate.toISOString().slice(0, 10),
        last_paid_date: toDateString(latestTxn.date),
        occurrences: sorted.length,
        is_known_service: isKnownSub
      });
    }

    // Sort: known services first, then by occurrences
    detected.sort((a, b) => (b.is_known_service ? 1 : 0) - (a.is_known_service ? 1 : 0) || b.occurrences - a.occurrences);

    res.json(detected.slice(0, 10));
  } catch (e) {
    safeError(res, e, 'Detect recurring subscriptions');
  }
});

router.post('/recurring', auth, async (req, res) => {
  try {
    const { description, amount, type, category, frequency, next_date, account_id, currency, tags } = req.body;
    if (!description || !amount || !type || !category || !frequency || !next_date)
      return res.status(400).json({ error: 'All fields required' });
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!VALID_FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'Invalid frequency' });
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    let accId = account_id ? parseInt(account_id) : null;
    if (accId) {
      const acc = await db.get('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [accId, req.user.id]);
      if (!acc) accId = null;
    }
    if (!accId) {
      const defAcc = await db.get('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id ASC LIMIT 1', [req.user.id]);
      accId = defAcc?.id || null;
    }
    const cleanTags = sanitizeTags(tags || []);
    const curr = currency || req.user?.currency || '₹';

    const row = await db.get(
      `INSERT INTO recurring (user_id,description,amount,type,category,frequency,next_date,account_id,currency,tags) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, description.trim(), amt, type, category, frequency, next_date, accId, curr, cleanTags]
    );
    res.status(201).json(row);
  } catch (e) { safeError(res, e, 'Create recurring'); }
});

router.put('/recurring/:id', auth, async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM recurring WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Recurring transaction not found' });

    const { description, amount, type, category, frequency, next_date, active, account_id, currency, tags } = req.body;
    if (frequency !== undefined && !VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }
    if (type !== undefined && !['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    const amt = amount !== undefined ? parseFloat(amount) : existing.amount;
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    let accId = existing.account_id;
    if (account_id !== undefined) {
      accId = account_id ? parseInt(account_id) : null;
      if (accId) {
        const acc = await db.get('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [accId, req.user.id]);
        if (!acc) accId = null;
      }
    }
    const cleanTags = tags !== undefined ? sanitizeTags(tags) : existing.tags;
    const curr = currency !== undefined ? currency : (existing.currency || req.user?.currency || '₹');

    const row = await db.get(
      `UPDATE recurring SET 
         description = COALESCE($1, description),
         amount = $2,
         type = COALESCE($3, type),
         category = COALESCE($4, category),
         frequency = COALESCE($5, frequency),
         next_date = COALESCE($6, next_date),
         active = COALESCE($7, active),
         account_id = $8,
         currency = $9,
         tags = $10
       WHERE id=$11 AND user_id=$12 RETURNING *`,
      [
        description !== undefined ? description.trim() : null,
        amt,
        type || null,
        category || null,
        frequency || null,
        next_date || null,
        active !== undefined ? (active ? 1 : 0) : null,
        accId,
        curr,
        cleanTags,
        req.params.id,
        req.user.id
      ]
    );
    res.json(row);
  } catch (e) { safeError(res, e, 'Update recurring'); }
});

router.delete('/recurring/:id', auth, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM recurring WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Recurring transaction not found' });
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete recurring'); }
});

module.exports = router;
