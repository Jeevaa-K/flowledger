const express = require('express');
const { auth } = require('../middleware/auth');
const { db, withTransaction } = require('../db');
const { safeError, getUserToday } = require('../utils');
const router = express.Router();

// ── Group Expense Splitting API ────────────────────────────────

// 1. List all groups for the logged in user
router.get('/groups', auth, async (req, res) => {
  try {
    const groups = await db.all(
      `SELECT g.*, 
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
              (SELECT COALESCE(SUM(ge.amount),0) FROM group_expenses ge WHERE ge.group_id = g.id AND ge.is_settlement=false) as total_expenses
       FROM groups g
       WHERE g.user_id = $1
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json(groups);
  } catch (e) {
    safeError(res, e, 'Get groups');
  }
});

// 2. Create a new group
router.post('/groups', auth, async (req, res) => {
  const { name, description, members } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Group name required' });
  const memberList = Array.isArray(members) ? members.filter(m => typeof m === 'string' && m.trim()) : [];

  try {
    const creatorUser = await db.get(`SELECT name, email FROM users WHERE id=$1`, [req.user.id]);

    const group = await withTransaction(async (client) => {
      const gRes = await client.query(
        `INSERT INTO groups (user_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
        [req.user.id, name.trim(), (description || '').trim()]
      );
      const g = gRes.rows[0];

      // Add creator as first member ("You")
      await client.query(
        `INSERT INTO group_members (group_id, user_id, name, email) VALUES ($1, $2, $3, $4)`,
        [g.id, req.user.id, creatorUser.name + ' (You)', creatorUser.email]
      );

      // Add other members
      for (const mName of memberList) {
        if (mName.trim()) {
          await client.query(
            `INSERT INTO group_members (group_id, name) VALUES ($1, $2)`,
            [g.id, mName.trim()]
          );
        }
      }
      return g;
    });

    res.json({ success: true, group });
  } catch (e) {
    safeError(res, e, 'Create group');
  }
});

// 3. Get group details (members, expenses, balances & settlement rules)
router.get('/groups/:id', auth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const group = await db.get(`SELECT * FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const members = await db.all(`SELECT * FROM group_members WHERE group_id=$1 ORDER BY id ASC`, [groupId]);

    // Fetch expenses with payer details
    const expenses = await db.all(
      `SELECT ge.*, gm.name as payer_name 
       FROM group_expenses ge 
       JOIN group_members gm ON ge.payer_id = gm.id 
       WHERE ge.group_id=$1 
       ORDER BY ge.date DESC, ge.id DESC`,
      [groupId]
    );

    // Fetch itemized splits for each expense
    for (const exp of expenses) {
      exp.splits = await db.all(
        `SELECT gs.*, gm.name as member_name 
         FROM group_splits gs 
         JOIN group_members gm ON gs.member_id = gm.id 
         WHERE gs.expense_id=$1`,
        [exp.id]
      );
    }

    // Compute net balances for each member
    // Net Balance = (Total Paid by Member) - (Total Owed/Share by Member)
    const memberBalances = {};
    members.forEach(m => {
      memberBalances[m.id] = { id: m.id, name: m.name, paid: 0, share: 0, net: 0 };
    });

    expenses.forEach(exp => {
      if (memberBalances[exp.payer_id]) {
        memberBalances[exp.payer_id].paid += Number(exp.amount);
      }
      exp.splits.forEach(s => {
        if (memberBalances[s.member_id]) {
          memberBalances[s.member_id].share += Number(s.split_amount);
        }
      });
    });

    Object.values(memberBalances).forEach(b => {
      b.net = Number((b.paid - b.share).toFixed(2));
    });

    // Calculate simplified settlements (who owes whom algorithm)
    const debtors = [];
    const creditors = [];

    Object.values(memberBalances).forEach(b => {
      if (b.net < -0.01) debtors.push({ ...b, amount: Math.abs(b.net) });
      else if (b.net > 0.01) creditors.push({ ...b, amount: b.net });
    });

    const settlements = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const settlementAmount = Math.min(d.amount, c.amount);

      settlements.push({
        from_id: d.id,
        from_name: d.name,
        to_id: c.id,
        to_name: c.name,
        amount: Number(settlementAmount.toFixed(2))
      });

      d.amount -= settlementAmount;
      c.amount -= settlementAmount;

      if (d.amount < 0.01) i++;
      if (c.amount < 0.01) j++;
    }

    res.json({
      group,
      members,
      expenses,
      balances: Object.values(memberBalances),
      settlements
    });
  } catch (e) {
    safeError(res, e, 'Get group details');
  }
});

// 4. Add a shared expense or custom split to a group
router.post('/groups/:id/expenses', auth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { description, amount, payer_id, category, date, splits } = req.body;

  if (!description || !amount || !payer_id) {
    return res.status(400).json({ error: 'Description, amount, and payer are required' });
  }

  const totalAmt = parseFloat(amount);
  if (!Number.isFinite(totalAmt) || totalAmt <= 0) {
    return res.status(400).json({ error: 'Expense amount must be a positive number' });
  }

  try {
    const group = await db.get(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Verify payer exists in this group
    const payerMember = await db.get(
      `SELECT id FROM group_members WHERE id=$1 AND group_id=$2`,
      [parseInt(payer_id), groupId]
    );
    if (!payerMember) {
      return res.status(400).json({ error: 'Payer does not belong to this group' });
    }

    const members = await db.all(`SELECT id FROM group_members WHERE group_id=$1`, [groupId]);
    const validMemberIds = new Set(members.map(m => m.id));

    // Calculate or validate splits
    let splitList = Array.isArray(splits) ? splits : [];
    if (!splitList.length) {
      // Equal split among all group members in integer minor units (paise)
      // base = floor(total / n), remainder = total % n, give 1 extra paisa to the first remainder people
      const totalPaise = Math.round(totalAmt * 100);
      const n = members.length;
      const basePaise = Math.floor(totalPaise / n);
      const remainder = totalPaise % n;
      splitList = members.map((m, idx) => ({
        member_id: m.id,
        split_amount: (basePaise + (idx < remainder ? 1 : 0)) / 100
      }));
    } else {
      // Validate each split member exists in this group and amounts are positive
      let totalSplitPaise = 0;
      for (const s of splitList) {
        const mid = parseInt(s.member_id);
        const sAmt = parseFloat(s.split_amount);
        if (!validMemberIds.has(mid)) {
          return res.status(400).json({ error: `Member ID ${mid} does not belong to this group` });
        }
        if (!Number.isFinite(sAmt) || sAmt < 0) {
          return res.status(400).json({ error: 'Split amount must be non-negative' });
        }
        totalSplitPaise += Math.round(sAmt * 100);
      }
      // Check sum(splits) equals total amount in integer paise
      const expectedTotalPaise = Math.round(totalAmt * 100);
      if (totalSplitPaise !== expectedTotalPaise) {
        return res.status(400).json({
          error: `Sum of splits (${(totalSplitPaise / 100).toFixed(2)}) must exactly equal total amount (${totalAmt.toFixed(2)})`
        });
      }
    }

    const expDate = date || new Date().toISOString().slice(0, 10);

    const expense = await withTransaction(async (client) => {
      const expRes = await client.query(
        `INSERT INTO group_expenses (group_id, payer_id, description, amount, category, date) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [groupId, parseInt(payer_id), description.trim(), totalAmt, category || 'Other', expDate]
      );
      const exp = expRes.rows[0];

      for (const s of splitList) {
        await client.query(
          `INSERT INTO group_splits (expense_id, member_id, split_amount) VALUES ($1, $2, $3)`,
          [exp.id, parseInt(s.member_id), parseFloat(s.split_amount)]
        );
      }
      return exp;
    });

    res.json({ success: true, expense });
  } catch (e) {
    safeError(res, e, 'Add group expense');
  }
});

// 5. Record a settlement payment ("Settle Up")
router.post('/groups/:id/settle', auth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { from_id, to_id, amount, date } = req.body;

  if (!from_id || !to_id || !amount) {
    return res.status(400).json({ error: 'Payer, recipient, and amount required' });
  }
  if (parseInt(from_id) === parseInt(to_id)) {
    return res.status(400).json({ error: 'Payer and recipient cannot be the same member' });
  }

  const settleAmt = parseFloat(amount);
  if (!Number.isFinite(settleAmt) || settleAmt <= 0) {
    return res.status(400).json({ error: 'Settlement amount must be greater than zero' });
  }

  try {
    const group = await db.get(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const fromMember = await db.get(`SELECT name FROM group_members WHERE id=$1 AND group_id=$2`, [parseInt(from_id), groupId]);
    const toMember = await db.get(`SELECT name FROM group_members WHERE id=$1 AND group_id=$2`, [parseInt(to_id), groupId]);
    if (!fromMember || !toMember) return res.status(404).json({ error: 'Members not found in this group' });

    const expDate = date || new Date().toISOString().slice(0, 10);
    const desc = `Settlement: ${fromMember.name} paid ${toMember.name}`;

    const expense = await withTransaction(async (client) => {
      const expRes = await client.query(
        `INSERT INTO group_expenses (group_id, payer_id, description, amount, category, date, is_settlement) 
         VALUES ($1, $2, $3, $4, 'Settlement', $5, true) RETURNING *`,
        [groupId, parseInt(from_id), desc, settleAmt, expDate]
      );
      const exp = expRes.rows[0];

      // In a settlement: payer paid `amount`, recipient receives `amount` share
      await client.query(
        `INSERT INTO group_splits (expense_id, member_id, split_amount) VALUES ($1, $2, $3)`,
        [exp.id, parseInt(to_id), settleAmt]
      );
      return exp;
    });

    res.json({ success: true, expense });
  } catch (e) {
    safeError(res, e, 'Record settlement');
  }
});

// 6. Delete a group expense
router.delete('/groups/:id/expenses/:expenseId', auth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const expenseId = parseInt(req.params.expenseId);
  try {
    const group = await db.get(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    await db.run(`DELETE FROM group_expenses WHERE id=$1 AND group_id=$2`, [expenseId, groupId]);
    res.json({ success: true });
  } catch (e) {
    safeError(res, e, 'Delete group expense');
  }
});

// 7. Delete an entire group
router.delete('/groups/:id', auth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    await db.run(`DELETE FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    safeError(res, e, 'Delete group');
  }
});

module.exports = router;
