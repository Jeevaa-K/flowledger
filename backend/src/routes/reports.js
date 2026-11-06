const express = require('express');
const PDFDocument = require('pdfkit');
const { auth } = require('../middleware/auth');
const { db, pool } = require('../db');
const { csvField, safeError } = require('../utils');
const { groq } = require('../services/ai');
const router = express.Router();

// ── CSV Export ────────────────────────────────────────────────
// Auth token must come from the Authorization header, never a ?token=
// query string — query params get written to server access logs, browser
// history, and proxy logs, which would leak a valid JWT. The frontend
// fetches this as a blob (see api.js) instead of navigating a plain URL,
// so it can send the header.
router.get('/export/csv', auth, async (req, res) => {
  const user = req.user;
  try {
    const rows = await db.all('SELECT * FROM transactions WHERE user_id=$1 ORDER BY date DESC', [user.id]);
    const csv = 'ID,Description,Amount,Type,Category,Date\n' +
      rows.map(r => [r.id, csvField(r.description), r.amount, csvField(r.type), csvField(r.category), r.date].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
    res.send(csv);
  } catch (e) { safeError(res, e, 'CSV export'); }
});

// ── Spending Velocity / Burn Rate ──────────────────────────────────────────
router.get('/burnrate', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now    = new Date();
    const month  = parseInt(req.query.month) || (now.getMonth() + 1);
    const year   = parseInt(req.query.year)  || now.getFullYear();

    // Total income & expense for the requested month
    const summaryRes = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
       FROM transactions
       WHERE user_id=$1 AND TO_CHAR(date,'YYYY-MM')=$2`,
      [userId, `${year}-${String(month).padStart(2,'0')}`]
    );

    const income  = parseFloat(summaryRes.rows[0].income)  || 0;
    const expense = parseFloat(summaryRes.rows[0].expense) || 0;

    // Days elapsed & days in month
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth = (month === now.getMonth() + 1 && year === now.getFullYear());
    const daysElapsed = isCurrentMonth
      ? Math.max(now.getDate(), 1)
      : daysInMonth;

    const dailyRate        = daysElapsed > 0 ? expense / daysElapsed : 0;
    const projectedExpense = dailyRate * daysInMonth;
    const projectedSavings = income - projectedExpense;
    const daysLeft         = isCurrentMonth ? daysInMonth - now.getDate() : 0;
    const budgetLeft       = income - expense;
    const safeDaily        = daysLeft > 0 ? budgetLeft / daysLeft : 0;

    // Pace status: safe / warning / danger
    let pace = 'safe';
    if (projectedExpense >= income * 0.95) pace = 'danger';
    else if (projectedExpense >= income * 0.80) pace = 'warning';

    res.json({
      income, expense, dailyRate, projectedExpense, projectedSavings,
      daysElapsed, daysLeft, daysInMonth, safeDaily, pace, isCurrentMonth,
      month, year
    });
  } catch(e) {
    console.error('Burn rate error:', e);
    res.status(500).json({ error: e.message });
  }
});


// ── AI Financial Audit & Monthly Statement ───────────────────
router.get('/reports/audit', auth, async (req, res) => {
  const user = req.user;
  try {
    const { month, year } = req.query;
    const m = month && year ? `${year}-${String(month).padStart(2, '0')}` : new Date().toISOString().slice(0, 7);
    const mDate = new Date(`${m}-01T00:00:00Z`);
    const mName = mDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Previous month string
    const prevDate = new Date(mDate);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevM = prevDate.toISOString().slice(0, 7);

    // Queries
    const [incRow, expRow, prevExpRow, cats, topTxns, totalCountRow] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='income' AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, m]),
      db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, m]),
      db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, prevM]),
      db.all(`SELECT category, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2 GROUP BY category ORDER BY total DESC`, [user.id, m]),
      db.all(`SELECT description, amount, category, date FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2 ORDER BY amount DESC LIMIT 5`, [user.id, m]),
      db.get(`SELECT COUNT(*) as c FROM transactions WHERE user_id=$1 AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, m])
    ]);

    const income = parseFloat(incRow?.t || 0);
    const expense = parseFloat(expRow?.t || 0);
    const prevExpense = parseFloat(prevExpRow?.t || 0);
    const netSavings = income - expense;
    const savingsRate = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;
    const momChange = prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 100) : 0;

    // AI CFO prompt
    let aiAnalysis = '';
    const catSummary = cats.map(c => `${c.category}: Rs.${Math.round(c.total)} (${expense > 0 ? Math.round((c.total / expense) * 100) : 0}%)`).join(', ') || 'No expenses';
    const merchantSummary = topTxns.map(t => `${t.description} (Rs.${Math.round(t.amount)})`).join(', ') || 'None';

    if (groq) {
      try {
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are an elite Chief Financial Officer (CFO) and personal finance advisor. Provide a high-impact, analytical monthly financial audit formatted cleanly in Markdown.'
            },
            {
              role: 'user',
              content: `Analyze this monthly financial statement for ${mName}:
- Total Inflows: Rs.${income}
- Total Outflows: Rs.${expense}
- Net Savings: Rs.${netSavings} (Savings Rate: ${savingsRate}%)
- Previous Month Outflow: Rs.${prevExpense} (MoM Change: ${momChange >= 0 ? '+' : ''}${momChange}%)
- Category Spending: ${catSummary}
- Top 5 Outflow Transactions: ${merchantSummary}

Format your response in three crisp sections:
### 📊 Financial Health & Verdict
2-3 concise sentences evaluating cash flow surplus/deficit, savings rate health, and month-over-month trajectory.

### 🔍 Spending Leakages & Patterns
2-3 bullet points identifying significant category concentrations or anomalies.

### 💡 CFO Strategic Action Plan
2 actionable, high-ROI recommendations for the upcoming month.`
            }
          ],
          temperature: 0.4,
          max_tokens: 500
        });
        aiAnalysis = completion.choices[0]?.message?.content || '';
      } catch (err) {
        console.warn('Groq CFO audit error:', err.message);
      }
    }

    // Rule-based fallback if AI is unavailable or returned empty
    if (!aiAnalysis) {
      const topCat = cats[0]?.category || 'General';
      const topPct = expense > 0 && cats[0] ? Math.round((cats[0].total / expense) * 100) : 0;
      aiAnalysis = `### 📊 Financial Health & Verdict
For ${mName}, your cash flow yielded a net savings of Rs.${netSavings.toLocaleString('en-IN')} with a savings rate of ${savingsRate}%. ${savingsRate >= 20 ? 'Your savings rate exceeds the benchmark 20% target, demonstrating strong financial discipline.' : 'Your savings rate is below the recommended 20% target; focus on widening the gap between income and expenses.'}

### 🔍 Spending Leakages & Patterns
• **Category Concentration**: ${topCat} was your largest cost center, consuming ${topPct}% of your total expenditure.
• **Month-over-Month Shift**: Your spending ${momChange > 0 ? 'increased by ' + momChange + '%' : momChange < 0 ? 'decreased by ' + Math.abs(momChange) + '%' : 'remained steady'} compared to the prior month.

### 💡 CFO Strategic Action Plan
• **Trim ${topCat}**: Target a 10-15% reduction in ${topCat} discretionary expenses next month.
• **Automate Goal Reserves**: Transfer at least 15% of total income into liquid emergency savings immediately on payday.`;
    }

    res.json({
      period: m,
      periodName: mName,
      summary: {
        income,
        expense,
        netSavings,
        savingsRate,
        txnCount: parseInt(totalCountRow?.c || 0),
        prevExpense,
        momChange
      },
      byCategory: cats.map(c => ({
        category: c.category,
        total: parseFloat(c.total),
        percent: expense > 0 ? Math.round((c.total / expense) * 100) : 0,
        count: parseInt(c.count)
      })),
      topMerchants: topTxns.map(t => ({
        description: t.description,
        amount: parseFloat(t.amount),
        category: t.category,
        date: t.date
      })),
      aiAnalysis
    });
  } catch (e) {
    safeError(res, e, 'Generate monthly audit');
  }
});

router.get('/export/monthly-csv', auth, async (req, res) => {
  const user = req.user;
  try {
    const { month, year } = req.query;
    const m = month && year ? `${year}-${String(month).padStart(2, '0')}` : new Date().toISOString().slice(0, 7);
    const rows = await db.all(`SELECT * FROM transactions WHERE user_id=$1 AND TO_CHAR(date,'YYYY-MM')=$2 ORDER BY date DESC`, [user.id, m]);
    const csv = 'Date,Description,Category,Type,Amount\n' +
      rows.map(r => [r.date ? new Date(r.date).toISOString().slice(0, 10) : '', csvField(r.description), csvField(r.category), csvField(r.type), r.amount].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${m}.csv"`);
    res.send(csv);
  } catch (e) { safeError(res, e, 'Monthly CSV export'); }
});

// ── PDF Report ────────────────────────────────────────────────
// Same header-only auth as /api/export/csv above — no ?token= fallback.
router.get('/export/pdf', auth, async (req, res) => {
  const user = req.user;
  try {
    const { month, year } = req.query;
    const m = month && year ? `${year}-${String(month).padStart(2, '0')}` : new Date().toISOString().slice(0, 7);

    const incRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='income' AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, m]);
    const expRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2`, [user.id, m]);
    const inc = parseFloat(incRow?.t || 0);
    const exp = parseFloat(expRow?.t || 0);
    const txns = await db.all(`SELECT * FROM transactions WHERE user_id=$1 AND TO_CHAR(date,'YYYY-MM')=$2 ORDER BY date DESC`, [user.id, m]);
    const cats = await db.all(`SELECT category, SUM(amount) as total FROM transactions WHERE user_id=$1 AND type='expense' AND TO_CHAR(date,'YYYY-MM')=$2 GROUP BY category ORDER BY total DESC`, [user.id, m]);
    const userInfo = await db.get('SELECT name,email FROM users WHERE id=$1', [user.id]);

    if (!userInfo) return res.status(404).json({ error: 'User not found' });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="flowledger-${m}.pdf"`);
    doc.on('error', err => console.error('PDF stream error:', err.message));
    doc.pipe(res);

    doc.fontSize(24).font('Helvetica-Bold').fillColor('#111').text('FlowLedger', 50, 50);
    doc.fontSize(12).font('Helvetica').fillColor('#666').text(`Financial Report - ${m}`, 50, 82);
    doc.fontSize(10).text(`Generated for: ${userInfo.name} (${userInfo.email})`, 50, 98);
    doc.moveTo(50, 120).lineTo(545, 120).stroke('#e5e7eb');

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#111').text('Summary', 50, 135);
    doc.fontSize(11).font('Helvetica');
    doc.fillColor('#10b981').text(`Income:   Rs.${inc.toLocaleString('en-IN')}`, 50, 158);
    doc.fillColor('#ef4444').text(`Expenses: Rs.${exp.toLocaleString('en-IN')}`, 50, 175);
    doc.fillColor(inc - exp >= 0 ? '#6366f1' : '#ef4444').text(`Balance:  Rs.${(inc - exp).toLocaleString('en-IN')}`, 50, 192);
    doc.fillColor('#f59e0b').text(`Savings Rate: ${inc > 0 ? (((inc - exp) / inc) * 100).toFixed(1) : 0}%`, 50, 209);

    if (cats.length) {
      doc.moveTo(50, 235).lineTo(545, 235).stroke('#e5e7eb');
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#111').text('Category Breakdown', 50, 248);
      let cy = 270;
      cats.forEach(cat => {
        doc.fontSize(10).font('Helvetica').fillColor('#374151').text(cat.category, 50, cy);
        doc.fillColor('#ef4444').text(`Rs.${Number(cat.total).toLocaleString('en-IN')}`, 400, cy, { align: 'right', width: 145 });
        cy += 18;
      });
    }

    const startY = cats.length ? 270 + cats.length * 18 + 30 : 270;
    doc.moveTo(50, startY).lineTo(545, startY).stroke('#e5e7eb');
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#111').text('Transactions', 50, startY + 13);
    let ty = startY + 38;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
    doc.text('Date', 50, ty); doc.text('Description', 110, ty); doc.text('Category', 310, ty); doc.text('Amount', 430, ty, { width: 115, align: 'right' });
    ty += 16;
    doc.moveTo(50, ty).lineTo(545, ty).stroke('#e5e7eb');
    ty += 6;

    txns.slice(0, 40).forEach(t => {
      if (ty > 750) { doc.addPage(); ty = 50; }
      const d = t.date ? new Date(t.date).toISOString().slice(0, 10) : '';
      doc.fontSize(9).font('Helvetica').fillColor('#374151');
      doc.text(d, 50, ty, { width: 55 });
      doc.text(t.description, 110, ty, { width: 190, ellipsis: true });
      doc.text(t.category, 310, ty, { width: 110 });
      doc.fillColor(t.type === 'income' ? '#10b981' : '#ef4444')
        .text(`${t.type === 'income' ? '+' : '-'}Rs.${Number(t.amount).toLocaleString('en-IN')}`, 430, ty, { width: 115, align: 'right' });
      ty += 16;
    });

    doc.end();
  } catch (e) {
    console.error('PDF error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not generate report. Please try again.' });
  }
});

module.exports = router;
