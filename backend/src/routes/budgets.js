const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError } = require('../utils');
const { groq, createGroqCompletion } = require('../services/ai');
const router = express.Router();

// ── Budgets ───────────────────────────────────────────────────
router.get('/budgets', auth, async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const budgets = await db.all('SELECT * FROM budgets WHERE user_id=$1', [req.user.id]);
    const result = await Promise.all(budgets.map(async b => {
      const row = await db.get(
        `SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND category=$2 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$3`,
        [req.user.id, b.category, month]
      );
      const spent = parseFloat(row?.t || 0);
      return { ...b, spent, percent: Math.min(Math.round((spent / b.monthly_limit) * 100), 100) };
    }));
    res.json(result);
  } catch (e) { safeError(res, e, 'List budgets'); }
});

router.post('/budgets', auth, async (req, res) => {
  try {
    const { category, monthly_limit } = req.body;
    if (!category) return res.status(400).json({ error: 'Category required' });
    const limit = parseFloat(monthly_limit);
    if (!Number.isFinite(limit) || limit <= 0) return res.status(400).json({ error: 'Invalid limit' });
    await db.run(
      'INSERT INTO budgets (user_id,category,monthly_limit) VALUES ($1,$2,$3) ON CONFLICT (user_id,category) DO UPDATE SET monthly_limit=$3',
      [req.user.id, category, limit]
    );
    res.status(201).json({ success: true });
  } catch (e) { safeError(res, e, 'Save budget'); }
});

router.delete('/budgets/:id', auth, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM budgets WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Budget not found' });
    res.json({ success: true });
  } catch (e) { safeError(res, e, 'Delete budget'); }
});

// ── AI Budget Auto-Suggestions & Bulk Apply ─────────────────────
router.get('/budgets/suggest', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Existing user budgets
    const existingBudgets = await db.all('SELECT * FROM budgets WHERE user_id=$1', [userId]);
    const budgetMap = new Map();
    existingBudgets.forEach(b => budgetMap.set(b.category, b));

    // 2. Query distinct months of expense activity in past 180 days
    const monthsRow = await db.all(
      `SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') as month 
       FROM transactions 
       WHERE user_id=$1 AND type='expense' AND date >= CURRENT_DATE - INTERVAL '180 days'
       ORDER BY month DESC`,
      [userId]
    );

    const activeMonthsCount = Math.max(monthsRow.length, 1);
    const latestMonth = monthsRow[0]?.month || new Date().toISOString().slice(0, 7);

    // 3. Category totals over active period
    let catRows = await db.all(
      `SELECT category,
              SUM(amount) as total_spent,
              COUNT(*) as tx_count,
              SUM(CASE WHEN TO_CHAR(date, 'YYYY-MM') = $2 THEN amount ELSE 0 END) as latest_month_spent
       FROM transactions
       WHERE user_id=$1 AND type='expense' AND date >= CURRENT_DATE - INTERVAL '180 days'
       GROUP BY category
       ORDER BY total_spent DESC`,
      [userId, latestMonth]
    );

    let effectiveMonths = activeMonthsCount;
    if (catRows.length === 0) {
      const allTimeCatRows = await db.all(
        `SELECT category, SUM(amount) as total_spent, COUNT(*) as tx_count, SUM(amount) as latest_month_spent
         FROM transactions
         WHERE user_id=$1 AND type='expense'
         GROUP BY category
         ORDER BY total_spent DESC`,
        [userId]
      );
      if (allTimeCatRows.length > 0) {
        catRows = allTimeCatRows;
        effectiveMonths = 1;
      }
    }

    const standardStarter = [
      { category: 'Food', suggestedLimit: 5000, avgMonthlySpend: 0, reason: 'Starter benchmark for groceries, meals, and snacks.' },
      { category: 'Transport', suggestedLimit: 2500, avgMonthlySpend: 0, reason: 'Standard allowance for daily commute, fuel, and transit.' },
      { category: 'Shopping', suggestedLimit: 3000, avgMonthlySpend: 0, reason: 'Practical cap to curb impulse retail and lifestyle purchases.' },
      { category: 'Bills', suggestedLimit: 3500, avgMonthlySpend: 0, reason: 'Essential monthly reserve for utilities, broadband, and recharges.' },
      { category: 'Entertainment', suggestedLimit: 2000, avgMonthlySpend: 0, reason: 'Balanced allowance for movies, outings, and subscriptions.' }
    ];

    let suggestions = [];

    if (catRows.length === 0) {
      suggestions = standardStarter.map(s => {
        const existing = budgetMap.get(s.category);
        return {
          ...s,
          currentLimit: existing ? parseFloat(existing.monthly_limit) : null,
          budgetId: existing ? existing.id : null,
          trend: 'starter',
          txCount: 0
        };
      });
    } else {
      for (const row of catRows) {
        const cat = row.category;
        const total = parseFloat(row.total_spent) || 0;
        const avg = Math.round(total / effectiveMonths);
        const latest = parseFloat(row.latest_month_spent) || 0;

        // Suggested limit formula: add 10-15% headroom, rounded cleanly
        const cushionRate = 1.12;
        const rawSuggested = avg * cushionRate;
        let suggestedLimit = 500;
        if (rawSuggested <= 1000) {
          suggestedLimit = Math.ceil(rawSuggested / 50) * 50;
        } else if (rawSuggested <= 10000) {
          suggestedLimit = Math.ceil(rawSuggested / 100) * 100;
        } else {
          suggestedLimit = Math.ceil(rawSuggested / 500) * 500;
        }
        suggestedLimit = Math.max(suggestedLimit, 200);

        let trend = 'stable';
        if (latest > avg * 1.15) trend = 'increasing';
        else if (latest < avg * 0.85) trend = 'decreasing';

        let reason = '';
        if (trend === 'increasing') {
          reason = `Recent spend is trending higher than your 3-month average of ₹${avg.toLocaleString('en-IN')}. This limit puts a disciplined ceiling on it.`;
        } else if (trend === 'decreasing') {
          reason = `Spending has cooled down recently. Locking in ₹${suggestedLimit.toLocaleString('en-IN')} protects your newfound savings.`;
        } else {
          reason = `Consistent 3-month spending pace of ~₹${avg.toLocaleString('en-IN')}/mo. Includes a healthy 12% safety buffer.`;
        }

        const existing = budgetMap.get(cat);
        suggestions.push({
          category: cat,
          avgMonthlySpend: avg,
          latestMonthSpend: latest,
          suggestedLimit,
          currentLimit: existing ? parseFloat(existing.monthly_limit) : null,
          budgetId: existing ? existing.id : null,
          trend,
          reason,
          txCount: parseInt(row.tx_count) || 0
        });
      }
    }

    let aiSummary = '';
    if (groq && suggestions.length > 0 && catRows.length > 0) {
      try {
        const prompt = `You are an expert personal finance coach on FlowLedger.
Here are category budget suggestions based on actual user expense velocity:
${JSON.stringify(suggestions.map(s => ({
  cat: s.category,
  avg: s.avgMonthlySpend,
  suggested: s.suggestedLimit,
  current: s.currentLimit,
  trend: s.trend
})))}

Give a punchy, 2-sentence executive assessment of these budget limits and 1 actionable rule of thumb.
Do not use markdown headers (#). Keep it encouraging, numbers-focused, and under 80 words.`;

        const completion = await createGroqCompletion({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 160,
          temperature: 0.6
        });
        aiSummary = completion.choices[0]?.message?.content?.trim() || '';
      } catch (err) {
        aiSummary = '';
      }
    }

    if (!aiSummary) {
      const totalSuggested = suggestions.reduce((s, c) => s + c.suggestedLimit, 0);
      aiSummary = `Analyzed ${suggestions.length} spending categories over ${effectiveMonths} active month${effectiveMonths > 1 ? 's' : ''}. Applying these recommended caps will establish a balanced total monthly budget of ₹${totalSuggested.toLocaleString('en-IN')}.`;
    }

    const totalSuggested = suggestions.reduce((s, c) => s + c.suggestedLimit, 0);
    const totalCurrent = suggestions.reduce((s, c) => s + (c.currentLimit || 0), 0);

    res.json({
      suggestions,
      totalSuggested,
      totalCurrent,
      activeMonthsCount: effectiveMonths,
      aiSummary
    });
  } catch (e) {
    safeError(res, e, 'Suggest budgets');
  }
});

router.post('/budgets/apply-suggestions', auth, async (req, res) => {
  try {
    const { budgets } = req.body;
    if (!Array.isArray(budgets) || budgets.length === 0) {
      return res.status(400).json({ error: 'No budgets provided to apply' });
    }

    let appliedCount = 0;
    for (const b of budgets) {
      const category = (b.category || '').trim();
      const limit = parseFloat(b.monthly_limit);
      if (category && Number.isFinite(limit) && limit > 0) {
        await db.run(
          'INSERT INTO budgets (user_id, category, monthly_limit) VALUES ($1,$2,$3) ON CONFLICT (user_id, category) DO UPDATE SET monthly_limit=$3',
          [req.user.id, category, limit]
        );
        appliedCount++;
      }
    }

    res.json({ success: true, count: appliedCount });
  } catch (e) {
    safeError(res, e, 'Apply budget suggestions');
  }
});

module.exports = router;
