const cron = require('node-cron');
const { db } = require('../db');

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
  return next; // unknown frequency — leave unchanged rather than guess
}

async function processDueRecurring() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const due = await db.all('SELECT * FROM recurring WHERE active=1 AND next_date<=$1', [today]);
    for (const r of due) {
      await db.run(
        'INSERT INTO transactions (user_id,description,amount,type,category,date) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.user_id, r.description, r.amount, r.type, r.category, today]
      );
      // anchorDay is fixed from the rule's ORIGINAL next_date, not
      // re-derived after each step — otherwise a clamp in a short month
      // (e.g. Feb 28) would permanently shrink a "31st of the month" rule.
      const anchorDay = parseInt(String(r.next_date).slice(8, 10), 10);
      // Loop in case next_date fell more than one period behind (e.g. server
      // was down) — advances one period at a time so intermediate months
      // are still generated correctly rather than skipped.
      let next = new Date(r.next_date);
      do { next = addPeriod(next, r.frequency, anchorDay); }
      while (next.toISOString().slice(0, 10) <= today);
      await db.run('UPDATE recurring SET next_date=$1 WHERE id=$2', [next.toISOString().slice(0, 10), r.id]);
    }
    if (due.length) console.log(`✅ Processed ${due.length} recurring transactions`);
  } catch (e) { console.error('Cron error:', e.message); }
}

// Runs daily at midnight server time.
function startRecurringJob() {
  cron.schedule('0 0 * * *', processDueRecurring);
}

module.exports = { addPeriod, processDueRecurring, startRecurringJob };
