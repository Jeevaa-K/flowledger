const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError } = require('../utils');
const { normalizeCurrency, getExchangeRate } = require('../services/currency');
const router = express.Router();

// ── Accounts ──────────────────────────────────────────────────
const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'wallet', 'other'];

// Balance is computed on read (starting_balance + all income - all expense
// ever posted to the account), never stored — so it can never drift out
// of sync with the transactions table the way a cached counter could.
router.get('/accounts', auth, async (req, res) => {
  try {
    const userBase = normalizeCurrency(req.user?.currency || 'INR');
    const accounts = await db.all(
      'SELECT * FROM accounts WHERE user_id=$1 ORDER BY archived ASC, created_at ASC',
      [req.user.id]
    );
    const result = await Promise.all(accounts.map(async a => {
      const row = await db.get(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) as net
         FROM transactions WHERE account_id=$1`,
        [a.id]
      );
      const accCurrency = normalizeCurrency(a.currency || userBase.code);
      const rateToBase = (accCurrency.code === userBase.code) ? 1.0 : getExchangeRate(accCurrency.code, userBase.code);
      const rawBalance = Number(a.starting_balance) + parseFloat(row?.net || 0);
      const balance = Math.round(rawBalance * 100) / 100;
      const baseBalance = Math.round(balance * rateToBase * 100) / 100;

      return {
        ...a,
        currency: accCurrency.code,
        currency_symbol: accCurrency.symbol,
        starting_balance: Number(a.starting_balance),
        balance,
        base_balance: baseBalance,
        rate_to_base: rateToBase
      };
    }));
    res.json(result);
  } catch (e) { safeError(res, e, 'List accounts'); }
});

router.post('/accounts', auth, async (req, res) => {
  try {
    const { name, type, starting_balance, color, currency } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Account name required' });
    if (name.length > 100) return res.status(400).json({ error: 'Account name is too long' });
    const accType = ACCOUNT_TYPES.includes(type) ? type : 'cash';
    const startBal = parseFloat(starting_balance);
    const startBalVal = Number.isFinite(startBal) ? startBal : 0;
    const accCurr = normalizeCurrency(currency || req.user?.currency || 'INR');
    const row = await db.get(
      'INSERT INTO accounts (user_id,name,type,starting_balance,color,currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, name.trim(), accType, startBalVal, color || '#6366f1', accCurr.code]
    );
    res.status(201).json({
      ...row,
      currency: accCurr.code,
      currency_symbol: accCurr.symbol,
      starting_balance: Number(row.starting_balance),
      balance: Number(row.starting_balance)
    });
  } catch (e) { safeError(res, e, 'Create account'); }
});

router.put('/accounts/:id', auth, async (req, res) => {
  try {
    const { name, type, starting_balance, color, archived, currency } = req.body;
    if (name !== undefined && (!name.trim() || name.length > 100))
      return res.status(400).json({ error: 'Invalid account name' });
    const accType = type !== undefined ? (ACCOUNT_TYPES.includes(type) ? type : 'cash') : undefined;
    const startBal = starting_balance !== undefined ? parseFloat(starting_balance) : undefined;
    if (startBal !== undefined && !Number.isFinite(startBal))
      return res.status(400).json({ error: 'Invalid starting balance' });
    const accCurr = currency !== undefined ? normalizeCurrency(currency).code : undefined;
    const row = await db.get(
      `UPDATE accounts SET
         name=COALESCE($1,name), type=COALESCE($2,type),
         starting_balance=COALESCE($3,starting_balance), color=COALESCE($4,color),
         archived=COALESCE($5,archived), currency=COALESCE($6,currency)
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [name?.trim(), accType, startBal, color, archived, accCurr, req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Account not found' });
    res.json({ ...row, starting_balance: Number(row.starting_balance) });
  } catch (e) { safeError(res, e, 'Update account'); }
});

// Deleting an account never deletes its transactions — the FK is
// ON DELETE SET NULL, so they simply become unassigned ("No account")
// and stay fully visible in history, exports, and reports.
router.delete('/accounts/:id', auth, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM accounts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete account'); }
});

module.exports = router;
