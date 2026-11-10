const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError } = require('../utils');
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

    // Group transactions by normalized description
    const groups = {};
    for (const t of txns) {
      if (!t.description || !t.amount) continue;
      const cleanDesc = t.description.trim();
      const norm = cleanDesc.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!groups[norm]) {
        groups[norm] = {
          originalDesc: cleanDesc,
          type: t.type || 'expense',
          category: t.category || 'Other',
          entries: []
        };
      }
      groups[norm].entries.push(t);
    }

    const detected = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const [norm, group] of Object.entries(groups)) {
      // Skip if already in recurring
      const isAlreadyTracked = [...existingSet].some(ex => norm.includes(ex) || ex.includes(norm));
      if (isAlreadyTracked) continue;

      const isKnownSub = KNOWN_SUBS.some(sub => norm.includes(sub));
      const count = group.entries.length;

      // Detect if it's a known subscription keyword or occurs 2+ times with regular amounts
      if (isKnownSub || count >= 2) {
        const latestTxn = group.entries[0];
        const amounts = group.entries.map(e => parseFloat(e.amount));
        const avgAmt = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);

        // Estimate next renewal date (1 month after latest transaction)
        const lastDate = new Date(latestTxn.date);
        const nextDate = new Date(lastDate);
        nextDate.setMonth(nextDate.getMonth() + 1);

        // If next date falls in the past, roll it forward until it is in the future
        while (nextDate.toISOString().slice(0, 10) < todayStr) {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }

        detected.push({
          description: group.originalDesc,
          amount: avgAmt,
          type: group.type,
          category: group.category || (isKnownSub ? 'Entertainment' : 'Bills'),
          frequency: 'monthly',
          next_date: nextDate.toISOString().slice(0, 10),
          last_paid_date: latestTxn.date,
          occurrences: count,
          is_known_service: isKnownSub
        });
      }
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
    const { description, amount, type, category, frequency, next_date } = req.body;
    if (!description || !amount || !type || !category || !frequency || !next_date)
      return res.status(400).json({ error: 'All fields required' });
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!VALID_FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'Invalid frequency' });
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const row = await db.get(
      'INSERT INTO recurring (user_id,description,amount,type,category,frequency,next_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id, description, amt, type, category, frequency, next_date]
    );
    res.status(201).json(row);
  } catch (e) { safeError(res, e, 'Create recurring'); }
});

router.put('/recurring/:id', auth, async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM recurring WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Recurring transaction not found' });

    const { description, amount, type, category, frequency, next_date, active } = req.body;
    if (frequency !== undefined && !VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }
    if (type !== undefined && !['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    const amt = amount !== undefined ? parseFloat(amount) : existing.amount;
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const row = await db.get(
      'UPDATE recurring SET description=$1,amount=$2,type=$3,category=$4,frequency=$5,next_date=$6,active=$7 WHERE id=$8 AND user_id=$9 RETURNING *',
      [
        description !== undefined ? description : existing.description,
        amt,
        type !== undefined ? type : existing.type,
        category !== undefined ? category : existing.category,
        frequency !== undefined ? frequency : existing.frequency,
        next_date !== undefined ? next_date : existing.next_date,
        active !== undefined ? (active ? 1 : 0) : existing.active,
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
