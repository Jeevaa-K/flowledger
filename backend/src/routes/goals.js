const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError, toDateString } = require('../utils');
const router = express.Router();

// ── Goals ─────────────────────────────────────────────────────
// Frontend maps target_date <-> "date" and target/saved as numbers;
// mapRow keeps that translation in one place instead of scattered
// across every route below.
function mapGoalRow(g) {
  return { id: g.id, name: g.name, target: Number(g.target), saved: Number(g.saved), date: toDateString(g.target_date) };
}

router.get('/goals', auth, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at ASC', [req.user.id]);
    res.json(rows.map(mapGoalRow));
  } catch (e) { safeError(res, e, 'List goals'); }
});

router.post('/goals', auth, async (req, res) => {
  try {
    const { name, target, saved, date } = req.body;
    if (!name || name.length > 100) return res.status(400).json({ error: 'Goal name required (max 100 chars)' });
    const targetNum = parseFloat(target);
    if (!Number.isFinite(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'Invalid target amount' });
    const savedNum = parseFloat(saved);
    const savedVal = Number.isFinite(savedNum) && savedNum >= 0 ? savedNum : 0;
    const row = await db.get(
      'INSERT INTO goals (user_id,name,target,saved,target_date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, name, targetNum, savedVal, date || null]
    );
    res.status(201).json(mapGoalRow(row));
  } catch (e) { safeError(res, e, 'Create goal'); }
});

router.put('/goals/:id', auth, async (req, res) => {
  try {
    const { name, target, saved, date } = req.body;
    if (name && name.length > 100) return res.status(400).json({ error: 'Goal name too long' });
    const targetNum = target !== undefined ? parseFloat(target) : undefined;
    if (targetNum !== undefined && (!Number.isFinite(targetNum) || targetNum <= 0)) return res.status(400).json({ error: 'Invalid target amount' });
    const savedNum = saved !== undefined ? parseFloat(saved) : undefined;
    if (savedNum !== undefined && (!Number.isFinite(savedNum) || savedNum < 0)) return res.status(400).json({ error: 'Invalid saved amount' });
    const row = await db.get(
      'UPDATE goals SET name=$1,target=$2,saved=$3,target_date=$4 WHERE id=$5 AND user_id=$6 RETURNING *',
      [name, targetNum, savedNum, date || null, req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Goal not found' });
    res.json(mapGoalRow(row));
  } catch (e) { safeError(res, e, 'Update goal'); }
});

router.delete('/goals/:id', auth, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Goal not found' });
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete goal'); }
});

module.exports = router;
