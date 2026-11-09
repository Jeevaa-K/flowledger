const express = require('express');
const { auth } = require('../middleware/auth');
const { db } = require('../db');
const { safeError } = require('../utils');
const router = express.Router();

// ── Tags ──────────────────────────────────────────────────────
// Distinct tags this user has ever used, most-recently-used first, for
// the tag input's autocomplete dropdown. unnest() flattens each row's
// tags[] into one row per tag so DISTINCT + GROUP BY can dedupe across
// the whole history; MAX(created_at) orders by most recent use rather
// than alphabetically, since a user's currently-relevant tags (this
// month's trip, this year's tax season) are usually the recent ones.
router.get('/tags', auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT tag, MAX(created_at) as last_used
       FROM transactions, unnest(tags) as tag
       WHERE user_id=$1
       GROUP BY tag
       ORDER BY last_used DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(rows.map(r => r.tag));
  } catch (e) { safeError(res, e, 'List tags'); }
});

module.exports = router;
