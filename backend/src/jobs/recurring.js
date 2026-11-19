const cron = require('node-cron');
const { db } = require('../db');
const { getUserToday } = require('../utils');

// Advances a date by one period, clamping to the last valid day of the
// target month instead of letting JS overflow (e.g. Jan 31 + 1 month
// would silently become Mar 3, not Feb 28/29). anchorDay is the
// recurring rule's original day-of-month (e.g. 31) and is passed in
// explicitly on every call so a short month (Feb) only clamps that one
// occurrence — it doesn't permanently shrink a Jan-31 rule down to the
// 28th forever; March still lands back on the 31st.
function addPeriod(date, frequency, anchorDay) {
  const next = new Date(date);
  if (frequency === 'daily') { next.setDate(next.getDate() + 1); return next; }
  if (frequency === 'weekly') { next.setDate(next.getDate() + 7); return next; }
  if (frequency === 'monthly' || frequency === 'yearly') {
    const monthsToAdd = frequency === 'monthly' ? 1 : 12;
    // Setting date to 1 first avoids JS's own overflow before we control it
    // (e.g. jumping from day 31 straight into setMonth would already roll over).
    next.setDate(1);
    next.setMonth(next.getMonth() + monthsToAdd);
    const lastDayOfTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(anchorDay, lastDayOfTargetMonth));
    return next;
  }
  // Unknown frequency: advance by one day to prevent an infinite loop
  // in processDueRecurring's while loop. The INSERT will record today's date
  // for the transaction, so the slight date shift for the next_date update
  // only affects future scheduling, not the transaction itself.
  next.setDate(next.getDate() + 1);
  return next;
}

async function processDueRecurring() {
  try {
    // Join with users table to query timezone and default currency/account
    const due = await db.all(`
      SELECT r.*, u.timezone, u.currency as user_currency
      FROM recurring r
      JOIN users u ON r.user_id = u.id
      WHERE r.active=1
    `);

    for (const r of due) {
      const today = getUserToday(r.timezone || 'Asia/Kolkata');
      const nextDateStr = String(r.next_date).slice(0, 10);
      if (nextDateStr > today) continue;

      const anchorDay = parseInt(nextDateStr.slice(8, 10), 10);

      // Determine fallback account if not set
      let targetAccountId = r.account_id;
      if (!targetAccountId) {
        const defAcc = await db.get(`SELECT id FROM accounts WHERE user_id=$1 ORDER BY id ASC LIMIT 1`, [r.user_id]);
        targetAccountId = defAcc?.id || null;
      }

      let currentDue = new Date(r.next_date);
      let iterations = 0;
      while (currentDue.toISOString().slice(0, 10) <= today && iterations < 365) {
        iterations++;
        const txDate = currentDue.toISOString().slice(0, 10);
        await db.run(
          `INSERT INTO transactions (user_id, description, amount, type, category, date, account_id, original_currency, tags) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            r.user_id,
            r.description,
            r.amount,
            r.type,
            r.category,
            txDate,
            targetAccountId,
            r.currency || r.user_currency || '₹',
            r.tags || []
          ]
        );
        currentDue = addPeriod(currentDue, r.frequency, anchorDay);
      }

      await db.run('UPDATE recurring SET next_date=$1 WHERE id=$2', [currentDue.toISOString().slice(0, 10), r.id]);
    }
    if (due.length) console.log(`Processed recurring checks across ${due.length} active rule(s)`);
  } catch (e) { console.error('Cron error:', e.message); }
}

// Runs daily at midnight server time.
function startRecurringJob() {
  cron.schedule('0 0 * * *', processDueRecurring);
}

module.exports = { addPeriod, processDueRecurring, startRecurringJob };
