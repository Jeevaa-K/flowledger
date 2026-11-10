const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError, sanitizeTags, toDateString } = require('../utils');
const router = express.Router();

// ── Transactions ──────────────────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  try {
    const { type, category, from, to, account_id, tag, search, min_amount, max_amount, sort = 'date_desc', limit = 200, page } = req.query;
    let where = ' WHERE user_id=$1';
    const p = [req.user.id];
    let i = 2;
    if (type) { where += ` AND type=$${i++}`; p.push(type); }
    if (category) { where += ` AND category=$${i++}`; p.push(category); }
    if (from) { where += ` AND date>=$${i++}`; p.push(from); }
    if (to) { where += ` AND date<=$${i++}`; p.push(to); }
    if (account_id) { where += ` AND account_id=$${i++}`; p.push(account_id); }
    if (tag) { where += ` AND $${i++} = ANY(tags)`; p.push(tag.trim().toLowerCase()); }
    if (search && search.trim()) {
      where += ` AND (description ILIKE $${i} OR notes ILIKE $${i} OR category ILIKE $${i})`;
      p.push(`%${search.trim()}%`);
      i++;
    }
    if (min_amount && Number.isFinite(parseFloat(min_amount))) {
      where += ` AND amount >= $${i++}`;
      p.push(parseFloat(min_amount));
    }
    if (max_amount && Number.isFinite(parseFloat(max_amount))) {
      where += ` AND amount <= $${i++}`;
      p.push(parseFloat(max_amount));
    }

    let orderBy = 'ORDER BY date DESC, created_at DESC';
    if (sort === 'date_asc') orderBy = 'ORDER BY date ASC, created_at ASC';
    else if (sort === 'amount_desc') orderBy = 'ORDER BY amount DESC, date DESC';
    else if (sort === 'amount_asc') orderBy = 'ORDER BY amount ASC, date DESC';
    else if (sort === 'created_desc') orderBy = 'ORDER BY created_at DESC, date DESC';

    const pageSize = Math.min(parseInt(limit) || 200, 1000);

    if (page) {
      const pageNum = Math.max(parseInt(page) || 1, 1);
      const offset = (pageNum - 1) * pageSize;
      const countRow = await db.get(`SELECT COUNT(*) as c FROM transactions${where}`, p);
      const q = `SELECT * FROM transactions${where} ${orderBy} LIMIT $${i} OFFSET $${i + 1}`;
      const rows = await db.all(q, [...p, pageSize, offset]);
      res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
      res.setHeader('X-Total-Count', countRow?.c || 0);
      return res.json(rows);
    }

    const q = `SELECT * FROM transactions${where} ${orderBy} LIMIT $${i}`;
    res.json(await db.all(q, [...p, pageSize]));
  } catch (e) { safeError(res, e, 'List transactions'); }
});

router.get('/transactions/export-csv', auth, async (req, res) => {
  try {
    const { type, category, from, to, account_id, tag, search, min_amount, max_amount, sort = 'date_desc' } = req.query;
    let where = ' WHERE user_id=$1';
    const p = [req.user.id];
    let i = 2;
    if (type) { where += ` AND type=$${i++}`; p.push(type); }
    if (category) { where += ` AND category=$${i++}`; p.push(category); }
    if (from) { where += ` AND date>=$${i++}`; p.push(from); }
    if (to) { where += ` AND date<=$${i++}`; p.push(to); }
    if (account_id) { where += ` AND account_id=$${i++}`; p.push(account_id); }
    if (tag) { where += ` AND $${i++} = ANY(tags)`; p.push(tag.trim().toLowerCase()); }
    if (search && search.trim()) {
      where += ` AND (description ILIKE $${i} OR notes ILIKE $${i} OR category ILIKE $${i})`;
      p.push(`%${search.trim()}%`);
      i++;
    }
    if (min_amount && Number.isFinite(parseFloat(min_amount))) {
      where += ` AND amount >= $${i++}`;
      p.push(parseFloat(min_amount));
    }
    if (max_amount && Number.isFinite(parseFloat(max_amount))) {
      where += ` AND amount <= $${i++}`;
      p.push(parseFloat(max_amount));
    }

    let orderBy = 'ORDER BY date DESC, created_at DESC';
    if (sort === 'date_asc') orderBy = 'ORDER BY date ASC, created_at ASC';
    else if (sort === 'amount_desc') orderBy = 'ORDER BY amount DESC, date DESC';
    else if (sort === 'amount_asc') orderBy = 'ORDER BY amount ASC, date DESC';
    else if (sort === 'created_desc') orderBy = 'ORDER BY created_at DESC, date DESC';

    const rows = await db.all(`SELECT date, type, category, description, amount, notes, tags FROM transactions${where} ${orderBy} LIMIT 2000`, p);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0,10)}.csv"`);

    let csv = 'Date,Type,Category,Description,Amount,Notes,Tags\r\n';
    for (const r of rows) {
      const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;
      const tags = Array.isArray(r.tags) ? r.tags.join(';') : '';
      csv += `${esc(r.date)},${esc(r.type)},${esc(r.category)},${esc(r.description)},${r.amount},${esc(r.notes)},${esc(tags)}\r\n`;
    }
    res.send(csv);
  } catch (e) {
    safeError(res, e, 'Export transactions CSV');
  }
});

// Single transaction by id — used by the Edit action so it always finds
// the row directly instead of searching a capped/paginated list (which
// silently missed anything past the 200 most recent transactions).
router.get('/transactions/:id', auth, async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Transaction not found' });
    res.json(row);
  } catch (e) { safeError(res, e, 'Get transaction'); }
});

// Verifies account_id (if provided) belongs to this user before it's
// trusted in an INSERT/UPDATE — otherwise a user could attach their own
// transaction to another user's account by guessing/incrementing an id.
// Returns the validated id (or null if none was given), or throws a
// {status,error} object the route handlers turn into a 400.
async function resolveAccountId(accountId, userId) {
  if (accountId === undefined || accountId === null || accountId === '') return null;
  const account = await db.get('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [accountId, userId]);
  if (!account) throw { status: 400, error: 'Invalid account' };
  return account.id;
}

router.post('/transactions', auth, async (req, res) => {
  try {
    const { description, amount, type, category, date, account_id, tags } = req.body;
    if (!description || !amount || !type || !category || !date)
      return res.status(400).json({ error: 'All fields required' });
    if (description.length > 500) return res.status(400).json({ error: 'Description is too long' });
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const accId = await resolveAccountId(account_id, req.user.id);
    const row = await db.get(
      'INSERT INTO transactions (user_id,description,amount,type,category,date,account_id,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, description, amt, type, category, date, accId, sanitizeTags(tags)]
    );
    res.status(201).json(row);
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    safeError(res, e, 'Create transaction');
  }
});

// ── Split Transactions (Multiple categories per receipt / bill) ───
router.post('/transactions/split', auth, async (req, res) => {
  try {
    const { description, total_amount, type = 'expense', date, account_id, tags = [], splits } = req.body;
    if (!description || !total_amount || !date) {
      return res.status(400).json({ error: 'Description, total amount, and date are required' });
    }
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const totalAmt = parseFloat(total_amount);
    if (!Number.isFinite(totalAmt) || totalAmt <= 0) return res.status(400).json({ error: 'Invalid total amount' });

    if (!Array.isArray(splits) || splits.length < 2) {
      return res.status(400).json({ error: 'Split transactions require at least 2 category parts' });
    }

    // Validate each split part
    let sumAllocated = 0;
    for (const s of splits) {
      const partAmt = parseFloat(s.amount);
      if (!Number.isFinite(partAmt) || partAmt <= 0) {
        return res.status(400).json({ error: `Invalid amount for category "${s.category || 'Unknown'}"` });
      }
      if (!s.category || !s.category.trim()) {
        return res.status(400).json({ error: 'Every split part must have a category' });
      }
      sumAllocated += partAmt;
    }

    // Tolerance check (within ₹0.05 for rounding)
    if (Math.abs(sumAllocated - totalAmt) > 0.05) {
      return res.status(400).json({
        error: `Sum of splits (₹${sumAllocated.toFixed(2)}) must equal total amount (₹${totalAmt.toFixed(2)})`
      });
    }

    const accId = await resolveAccountId(account_id, req.user.id);
    const splitId = 'split_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const baseTags = sanitizeTags(['split', ...(Array.isArray(tags) ? tags : [])]);

    const createdRows = [];
    for (const s of splits) {
      const partAmt = parseFloat(s.amount);
      const partNote = s.note ? s.note.trim() : '';
      const partDesc = partNote ? `${description} (${partNote})` : `${description} [${s.category.trim()}]`;
      const partTags = partNote ? sanitizeTags([...baseTags, s.category.toLowerCase().replace(/[^a-z0-9]/g, '')]) : baseTags;

      const row = await db.get(
        `INSERT INTO transactions (user_id, description, amount, type, category, date, account_id, tags, notes, split_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          req.user.id,
          partDesc.slice(0, 500),
          partAmt,
          type,
          s.category.trim(),
          date,
          accId,
          partTags,
          partNote || `Part of split bill "${description}" (₹${totalAmt})`,
          splitId
        ]
      );
      createdRows.push(row);
    }

    res.status(201).json({
      success: true,
      split_id: splitId,
      total_amount: totalAmt,
      count: createdRows.length,
      transactions: createdRows
    });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    safeError(res, e, 'Create split transaction');
  }
});

router.get('/transactions/split/:split_id', auth, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT * FROM transactions WHERE split_id=$1 AND user_id=$2 ORDER BY id ASC',
      [req.params.split_id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Split group not found' });
    const total = rows.reduce((acc, r) => acc + parseFloat(r.amount || 0), 0);
    res.json({ split_id: req.params.split_id, total_amount: total, count: rows.length, transactions: rows });
  } catch (e) { safeError(res, e, 'Get split group'); }
});

router.delete('/transactions/split/:split_id', auth, async (req, res) => {
  try {
    const result = await db.run(
      'DELETE FROM transactions WHERE split_id=$1 AND user_id=$2',
      [req.params.split_id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Split group not found' });
    res.json({ success: true, deletedCount: result.rowCount });
  } catch (e) { safeError(res, e, 'Delete split group'); }
});

router.put('/transactions/:id', auth, async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });

    const { description, amount, type, category, date, account_id, tags, notes } = req.body;
    if (type && !['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const amt = amount !== undefined ? parseFloat(amount) : parseFloat(existing.amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (description !== undefined && description.length > 500) return res.status(400).json({ error: 'Description is too long' });

    const accId = account_id !== undefined ? await resolveAccountId(account_id, req.user.id) : existing.account_id;
    const tagsVal = tags !== undefined ? sanitizeTags(tags) : existing.tags;
    const finalDesc = description !== undefined ? description : existing.description;
    const finalType = type !== undefined ? type : existing.type;
    const finalCat = category !== undefined ? category : existing.category;
    const finalDate = date !== undefined ? date : existing.date;
    const finalNotes = notes !== undefined ? notes : existing.notes;

    const row = await db.get(
      `UPDATE transactions SET description=$1,amount=$2,type=$3,category=$4,date=$5,
         account_id=$6, tags=$7, notes=$8
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [finalDesc, amt, finalType, finalCat, finalDate, accId, tagsVal, finalNotes, req.params.id, req.user.id]
    );
    res.json(row);
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    safeError(res, e, 'Update transaction');
  }
});

router.delete('/transactions/:id', auth, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete transaction'); }
});

router.post('/transactions/import', auth, async (req, res) => {
  const { transactions, account_id } = req.body;
  if (!Array.isArray(transactions) || !transactions.length)
    return res.status(400).json({ error: 'No transactions provided' });
  if (transactions.length > 5000) return res.status(400).json({ error: 'Too many rows in one import (max 5000)' });
  try {
    // One account for the whole file, not per-row — matches how a real
    // bank/CSV export works (the file IS that account's statement).
    const accId = await resolveAccountId(account_id, req.user.id);
    // Duplicate guard: re-importing the same file (or a browser retry)
    // used to silently double every row. A row counts as a duplicate of
    // an already-stored transaction when description+amount+type+category+
    // date all match exactly — narrow enough that two genuinely different
    // same-day purchases (different description) still both import.
    const dates = [...new Set(transactions.map(t => t.date).filter(Boolean))];
    const existingRows = dates.length
      ? await db.all(
        `SELECT description,amount,type,category,date FROM transactions WHERE user_id=$1 AND date = ANY($2::date[])`,
        [req.user.id, dates]
      )
      : [];
    const dupKey = r => `${r.description}|${Number(r.amount)}|${r.type}|${r.category}|${toDateString(r.date)}`;
    const existingKeys = new Set(existingRows.map(dupKey));

    let imported = 0, skipped = 0;
    for (const t of transactions) {
      if (!t.description || !t.amount || !t.type || !t.category || !t.date) continue;
      if (!['income', 'expense'].includes(t.type)) continue;
      const amt = parseFloat(t.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const description = String(t.description).slice(0, 500);
      const key = `${description}|${amt}|${t.type}|${t.category}|${t.date}`;
      if (existingKeys.has(key)) { skipped++; continue; }
      await db.run(
        'INSERT INTO transactions (user_id,description,amount,type,category,date,account_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.user.id, description, amt, t.type, t.category, t.date, accId]
      );
      existingKeys.add(key); // guards against duplicates within the same uploaded file too
      imported++;
    }
    res.json({ success: true, imported, skipped });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    safeError(res, e, 'Import transactions');
  }
});

// ── Summary ───────────────────────────────────────────────────
router.get('/summary', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    let dateFilter = '';
    const p = [req.user.id];
    if (month && year) {
      dateFilter = `AND TO_CHAR(date,'YYYY-MM') = $2`;
      p.push(`${year}-${String(month).padStart(2, '0')}`);
    }

    const incRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='income' ${dateFilter}`, p);
    const expRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='expense' ${dateFilter}`, p);
    const inc = parseFloat(incRow?.t || 0);
    const exp = parseFloat(expRow?.t || 0);

    const byCategory = await db.all(
      `SELECT category, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE user_id=$1 AND type='expense' ${dateFilter} GROUP BY category ORDER BY total DESC`, p
    );
    const monthlyTrend = await db.all(
      `SELECT TO_CHAR(date,'YYYY-MM') as month,
       SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
       SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
       FROM transactions WHERE user_id=$1 GROUP BY TO_CHAR(date,'YYYY-MM') ORDER BY month DESC LIMIT 6`,
      [req.user.id]
    );
    const last3 = await db.all(
      `SELECT TO_CHAR(date,'YYYY-MM') as month, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
       FROM transactions WHERE user_id=$1 GROUP BY TO_CHAR(date,'YYYY-MM') ORDER BY month DESC LIMIT 3`,
      [req.user.id]
    );
    const forecastExpense = last3.length ? Math.round(last3.reduce((s, r) => s + parseFloat(r.expense), 0) / last3.length) : 0;
    const savingsRate = inc > 0 ? (((inc - exp) / inc) * 100).toFixed(1) : 0;
    res.json({ income: inc, expense: exp, balance: inc - exp, savingsRate, byCategory, monthlyTrend, forecastExpense });
  } catch (e) { safeError(res, e, 'Summary'); }
});

module.exports = router;
