const express = require('express');
const { auth } = require('../middleware/auth');
const { CURRENCIES, getAllRates, convertCurrency, getExchangeRate, normalizeCurrency } = require('../services/currency');
const router = express.Router();

// ── Currencies & FX Rates ─────────────────────────────────────

// Public or authenticated list of supported currencies
router.get('/currencies', (req, res) => {
  res.json(Object.values(CURRENCIES));
});

// Rates relative to a base (defaults to user currency if logged in, or INR)
router.get('/currencies/rates', auth, (req, res) => {
  const userBase = req.user?.currency || 'INR';
  const base = req.query.base || userBase;
  const data = getAllRates(base);
  res.json(data);
});

// Instant conversion endpoint
router.post('/currencies/convert', auth, (req, res) => {
  const { amount, from, to, rate } = req.body;
  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Valid numeric amount is required' });
  }
  const userBase = req.user?.currency || 'INR';
  const fromCurr = from || userBase;
  const toCurr = to || userBase;
  const result = convertCurrency(parseFloat(amount), fromCurr, toCurr, rate);
  res.json(result);
});

module.exports = router;

