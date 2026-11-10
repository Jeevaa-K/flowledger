const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError } = require('../utils');
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
    const group = await db.get(
      `INSERT INTO groups (user_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, name.trim(), (description || '').trim()]
    );

    // Add creator as first member ("You")
    const creatorUser = await db.get(`SELECT name, email FROM users WHERE id=$1`, [req.user.id]);
    await db.run(
      `INSERT INTO group_members (group_id, user_id, name, email) VALUES ($1, $2, $3, $4)`,
      [group.id, req.user.id, creatorUser.name + ' (You)', creatorUser.email]
    );

    // Add other members
    for (const mName of memberList) {
      if (mName.trim()) {
        await db.run(
          `INSERT INTO group_members (group_id, name) VALUES ($1, $2)`,
          [group.id, mName.trim()]
        );
      }
    }

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

  try {
    const group = await db.get(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const totalAmt = parseFloat(amount);
    const expDate = date || new Date().toISOString().slice(0, 10);

    const expense = await db.get(
      `INSERT INTO group_expenses (group_id, payer_id, description, amount, category, date) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [groupId, parseInt(payer_id), description.trim(), totalAmt, category || 'Other', expDate]
    );

    // Save splits
    let splitList = Array.isArray(splits) ? splits : [];
    if (!splitList.length) {
      // Equal split among all group members by default
      const members = await db.all(`SELECT id FROM group_members WHERE group_id=$1`, [groupId]);
      const share = Number((totalAmt / members.length).toFixed(2));
      splitList = members.map(m => ({ member_id: m.id, split_amount: share }));
    }

    for (const s of splitList) {
      await db.run(
        `INSERT INTO group_splits (expense_id, member_id, split_amount) VALUES ($1, $2, $3)`,
        [expense.id, parseInt(s.member_id), parseFloat(s.split_amount)]
      );
    }

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

  try {
    const group = await db.get(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.user.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const fromMember = await db.get(`SELECT name FROM group_members WHERE id=$1 AND group_id=$2`, [parseInt(from_id), groupId]);
    const toMember = await db.get(`SELECT name FROM group_members WHERE id=$1 AND group_id=$2`, [parseInt(to_id), groupId]);
    if (!fromMember || !toMember) return res.status(404).json({ error: 'Members not found' });

    const settleAmt = parseFloat(amount);
    const expDate = date || new Date().toISOString().slice(0, 10);
    const desc = `Settlement: ${fromMember.name} paid ${toMember.name}`;

    const expense = await db.get(
      `INSERT INTO group_expenses (group_id, payer_id, description, amount, category, date, is_settlement) 
       VALUES ($1, $2, $3, $4, 'Settlement', $5, true) RETURNING *`,
      [groupId, parseInt(from_id), desc, settleAmt, expDate]
    );

    // In a settlement: payer paid `amount`, recipient receives `amount` share
    await db.run(
      `INSERT INTO group_splits (expense_id, member_id, split_amount) VALUES ($1, $2, $3)`,
      [expense.id, parseInt(to_id), settleAmt]
    );

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
