const express = require('express');
const { auth } = require('../middleware/auth');
const { groq, createGroqCompletion } = require('../services/ai');
const { db } = require('../db');
const router = express.Router();

// ── AI Natural Language Quick Add ─────────────────────────────
router.post('/ai/parse-text', auth, async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text prompt required' });
  if (text.length > 500) return res.status(400).json({ error: 'Text is too long (max 500 characters)' });
  if (!groq) return res.status(503).json({ error: 'AI not configured' });

  try {
    const categories = await db.all(
      `SELECT DISTINCT category FROM transactions WHERE user_id=$1 UNION SELECT DISTINCT category FROM budgets WHERE user_id=$1`,
      [req.user.id]
    );
    const catList = categories.map(c => c.category).filter(Boolean);
    const defaultCats = ['Food & Dining', 'Groceries', 'Shopping', 'Transportation', 'Bills & Utilities', 'Entertainment', 'Health', 'Housing', 'Salary', 'Investment', 'Other'];
    const validCats = Array.from(new Set([...catList, ...defaultCats]));

    const accounts = await db.all(`SELECT id, name, type FROM accounts WHERE user_id=$1 AND archived=false`, [req.user.id]);
    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are a financial entity extraction engine. Parse the user's transaction input into structured JSON.
Today's date is: ${today}.
User's available accounts: ${JSON.stringify(accounts)}.
User's available categories: ${JSON.stringify(validCats)}.

STRICT RULES:
1. Return ONLY a JSON object with these exact keys:
   - "description": concise text summarizing merchant/purpose (string)
   - "amount": positive numeric value (number)
   - "type": "expense" or "income" (string)
   - "category": choose nearest matching category from available list or best fit (string)
   - "account_id": numeric id of matching account from user's accounts list if mentioned/implied, or null (number|null)
   - "date": YYYY-MM-DD string, calculated relative to today (${today}) (string)
   - "tags": array of 1-3 relevant lowercase tags (array of strings)

Example output:
{
  "description": "Starbucks Coffee",
  "amount": 450,
  "type": "expense",
  "category": "Food & Dining",
  "account_id": 1,
  "date": "${today}",
  "tags": ["coffee", "work"]
}`;

    const completion = await createGroqCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.1
    });

    const parsed = JSON.parse(completion.choices[0].message.content || '{}');
    res.json({ success: true, result: parsed });
  } catch (e) {
    console.error('AI parse-text error:', e.message);
    // Graceful fallback for 401 or network errors: parse with regex rules
    try {
      const amountMatch = text.match(/(?:rs\.?|inr|₹|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/i);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;
      const isIncome = /\b(salary|earned|received|income|credited|deposit|freelance)\b/i.test(text);
      let cat = 'Other';
      if (/\b(coffee|starbucks|food|lunch|dinner|breakfast|burger|pizza|restaurant|eat|groceries|swiggy|zomato)\b/i.test(text)) cat = 'Food';
      else if (/\b(uber|ola|cab|fuel|petrol|diesel|metro|bus|train|flight|transport)\b/i.test(text)) cat = 'Transport';
      else if (/\b(shopping|amazon|flipkart|clothes|shoes|store|bought)\b/i.test(text)) cat = 'Shopping';
      else if (/\b(movie|cinema|netflix|spotify|game|entertainment)\b/i.test(text)) cat = 'Entertainment';
      else if (/\b(medicine|doctor|hospital|pharmacy|health)\b/i.test(text)) cat = 'Health';
      else if (/\b(bill|electricity|water|wifi|internet|recharge|rent)\b/i.test(text)) cat = 'Bills';
      else if (/\b(salary|freelance|investment)\b/i.test(text)) cat = isIncome ? 'Salary' : 'Other';

      const fallbackResult = {
        description: text.slice(0, 50).trim(),
        amount: amount || 0,
        type: isIncome ? 'income' : 'expense',
        category: cat,
        account_id: null,
        date: new Date().toISOString().slice(0, 10),
        tags: ['quick-add']
      };
      return res.json({ success: true, result: fallbackResult });
    } catch (_) {
      res.status(500).json({ error: 'Failed to parse text. Please try again or fill manually.' });
    }
  }
});

// ── AI Bank SMS & UPI Alert Instant Parser ────────────────────
router.post('/ai/parse-sms', auth, async (req, res) => {
  const rawText = req.body.sms || req.body.text;
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'Bank SMS or UPI notification text is required' });
  }
  const text = rawText.trim();
  if (text.length > 1000) {
    return res.status(400).json({ error: 'SMS text is too long (max 1000 characters)' });
  }

  try {
    const categories = await db.all(
      `SELECT DISTINCT category FROM transactions WHERE user_id=$1 UNION SELECT DISTINCT category FROM budgets WHERE user_id=$1`,
      [req.user.id]
    );
    const catList = categories.map(c => c.category).filter(Boolean);
    const defaultCats = ['Food & Dining', 'Groceries', 'Shopping', 'Transportation', 'Bills & Utilities', 'Entertainment', 'Health', 'Housing', 'Salary', 'Investment', 'Other'];
    const validCats = Array.from(new Set([...catList, ...defaultCats]));

    const accounts = await db.all(`SELECT id, name, type FROM accounts WHERE user_id=$1 AND archived=false`, [req.user.id]);
    const today = new Date().toISOString().slice(0, 10);

    let parsedResult = null;

    if (groq) {
      try {
        const systemPrompt = `You are a specialized Bank SMS and UPI transaction parsing engine.
Extract structured transaction data from bank debit/credit alert messages and UPI payment notifications (HDFC, SBI, ICICI, Axis, Kotak, PhonePe, Google Pay, Paytm, CRED, etc.).
Today's date is: ${today}.
User's configured accounts: ${JSON.stringify(accounts)}.
Available categories: ${JSON.stringify(validCats)}.

STRICT RULES:
1. Return ONLY a valid JSON object with these keys:
   - "amount": positive numeric amount (number, no symbols or commas).
   - "type": "expense" for debit/spent/paid/withdrawn/sent/used at; "income" for credit/received/salary/deposit/refund/cashback.
   - "merchant": clean merchant or beneficiary name (strip transaction codes, VPA paths like "/pay", "UPI/", "POS/", "NEFT"). E.g. "Swiggy", "Zomato", "Amazon", "Sharma Chai Point", "Salary".
   - "description": concise 3-7 word summary (string). E.g. "Paid to Swiggy via HDFC", "Salary Credited".
   - "category": best matching category from available categories (string).
   - "account_id": numeric id from user's accounts list if bank name or last 3-4 digits match, else null (number|null).
   - "date": YYYY-MM-DD date extracted from the SMS relative to today (${today}) (string).
   - "reference_no": UTR, Ref No, or Transaction ID if present, else null (string|null).
   - "balance": remaining account balance if stated in the SMS, else null (number|null).
   - "tags": array of 2-4 lowercase tags, e.g. ["upi", "bank-sms", "swiggy"] (array of strings).

Example output:
{
  "amount": 420.50,
  "type": "expense",
  "merchant": "Swiggy",
  "description": "Swiggy Food Order",
  "category": "Food & Dining",
  "account_id": 1,
  "date": "${today}",
  "reference_no": "431245678912",
  "balance": 14200.00,
  "tags": ["upi", "bank-sms", "swiggy"]
}`;

        const completion = await createGroqCompletion({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 380,
          temperature: 0.1
        });

        parsedResult = JSON.parse(completion.choices[0]?.message?.content || '{}');
      } catch (llmErr) {
        console.warn('Groq SMS parse error, falling back to heuristics:', llmErr.message);
      }
    }

    // Heuristic fallback if LLM returned incomplete/empty result or failed
    if (!parsedResult || !parsedResult.amount || isNaN(Number(parsedResult.amount))) {
      // 1. Amount detection (matches "Rs 450", "INR 450.50", "₹1,200.00", "Rs. 99")
      const amtMatch = text.match(/(?:(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹))/i);
      let detectedAmt = 0;
      if (amtMatch) {
        const raw = (amtMatch[1] || amtMatch[2] || '').replace(/,/g, '');
        detectedAmt = parseFloat(raw) || 0;
      }

      // 2. Debit vs Credit
      const isCredit = /\b(credited|received|deposit|deposited|salary|refund|refunded|cashback|reversed)\b/i.test(text);
      const isDebit = /\b(debited|spent|paid|withdrawn|used\s+at|sent|transferred\s+to|purchase|billed|charged)\b/i.test(text);
      const type = isCredit ? 'income' : 'expense';

      // 3. Merchant extraction
      let merchant = '';
      const upiPathMatch = text.match(/upi\/[a-z0-9_-]+\/([a-z0-9_ -]+)\//i);
      if (upiPathMatch) {
        merchant = upiPathMatch[1].trim();
      } else {
        const toMatch = text.match(/(?:to|at|vpa|paid\s+to|used\s+at|info[:\s]+)\s+([a-zA-Z0-9\s._&-]{2,35}?)(?:\s+(?:on|ref|avl|bal|via|using|\d{4})|[.,;]|$)/i);
        if (toMatch && toMatch[1]) {
          merchant = toMatch[1].trim().replace(/^upi\/?/i, '').replace(/[\/\\]pay$/i, '').replace(/[.,;]+$/, '');
        }
      }
      if (!merchant) {
        if (/swiggy/i.test(text)) merchant = 'Swiggy';
        else if (/zomato/i.test(text)) merchant = 'Zomato';
        else if (/uber/i.test(text)) merchant = 'Uber';
        else if (/ola/i.test(text)) merchant = 'Ola';
        else if (/amazon/i.test(text)) merchant = 'Amazon';
        else if (/flipkart/i.test(text)) merchant = 'Flipkart';
        else if (/netflix/i.test(text)) merchant = 'Netflix';
        else if (/starbucks/i.test(text)) merchant = 'Starbucks';
        else if (/salary/i.test(text)) merchant = 'Monthly Salary';
        else merchant = isCredit ? 'Credit Received' : 'Bank Payment';
      }

      // 4. Account matching by last 3-4 digits or bank name
      let matchedAccountId = null;
      const acctDigitsMatch = text.match(/(?:a\/c|acct|card|ending(?:\s+in)?|xx|\*+)\s*(?:no\.?)?\s*(\d{3,4})/i);
      const digits = acctDigitsMatch ? acctDigitsMatch[1] : null;

      for (const acc of accounts) {
        const accLower = acc.name.toLowerCase();
        if (digits && accLower.includes(digits)) {
          matchedAccountId = acc.id;
          break;
        }
        if (/hdfc/i.test(text) && accLower.includes('hdfc')) { matchedAccountId = acc.id; break; }
        if (/sbi/i.test(text) && accLower.includes('sbi')) { matchedAccountId = acc.id; break; }
        if (/icici/i.test(text) && accLower.includes('icici')) { matchedAccountId = acc.id; break; }
        if (/axis/i.test(text) && accLower.includes('axis')) { matchedAccountId = acc.id; break; }
        if (/kotak/i.test(text) && accLower.includes('kotak')) { matchedAccountId = acc.id; break; }
      }

      // 5. Category detection
      let category = isCredit ? 'Salary' : 'Other';
      const low = (merchant + ' ' + text).toLowerCase();
      if (/swiggy|zomato|starbucks|food|cafe|restaurant|mcdonald|kfc|burger|pizza|dine|dining|bake/i.test(low)) category = 'Food & Dining';
      else if (/grocer|blinkit|zepto|dunzo|dmart|instamart|bigbasket|supermarket/i.test(low)) category = 'Groceries';
      else if (/uber|ola|rapido|metro|fuel|petrol|diesel|gas|flight|irctc|train|makemytrip/i.test(low)) category = 'Transportation';
      else if (/amazon|flipkart|myntra|ajio|zara|h&m|shopping|retail|store/i.test(low)) category = 'Shopping';
      else if (/bill|electricity|water|wifi|broadband|airtel|jio|vi|recharge|dth|tata|rent/i.test(low)) category = 'Bills & Utilities';
      else if (/netflix|spotify|hotstar|prime|movie|cinema|bookmyshow|game/i.test(low)) category = 'Entertainment';
      else if (/hospital|pharmacy|doctor|apollo|medplus|pharmeasy|clinic|health/i.test(low)) category = 'Health';

      // 6. Ref No & Bal
      const refMatch = text.match(/(?:ref(?:\s+no)?|utr|txn(?:\s+id)?)[.:\s]+([a-zA-Z0-9]+)/i);
      const balMatch = text.match(/(?:avl|avail(?:able)?|tot(?:al)?)\s+bal(?:ance)?\s*[:.-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);

      parsedResult = {
        amount: detectedAmt,
        type,
        merchant,
        description: merchant,
        category,
        account_id: matchedAccountId,
        date: today,
        reference_no: refMatch ? refMatch[1] : null,
        balance: balMatch ? parseFloat(balMatch[1].replace(/,/g, '')) : null,
        tags: ['bank-sms', type === 'income' ? 'income' : 'expense']
      };
    }

    // Clean and validate amount
    const finalAmount = parseFloat(parsedResult.amount);
    if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) {
      return res.status(422).json({
        error: 'Could not detect a valid transaction amount from the SMS text. Please check the text or enter manually.',
        partialResult: parsedResult
      });
    }

    parsedResult.amount = Math.round(finalAmount * 100) / 100;
    parsedResult.type = parsedResult.type === 'income' ? 'income' : 'expense';
    parsedResult.description = parsedResult.description || parsedResult.merchant || 'Bank Transaction';
    parsedResult.date = (parsedResult.date && /^\d{4}-\d{2}-\d{2}$/.test(parsedResult.date)) ? parsedResult.date : today;

    // Optional direct saving if requested
    if (req.body.save === true) {
      const { sanitizeTags } = require('../utils');
      let accId = null;
      if (parsedResult.account_id) {
        const found = await db.get('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [parsedResult.account_id, req.user.id]);
        if (found) accId = found.id;
      }
      const savedRow = await db.get(
        'INSERT INTO transactions (user_id, description, amount, type, category, date, account_id, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          req.user.id,
          parsedResult.description.slice(0, 500),
          parsedResult.amount,
          parsedResult.type,
          parsedResult.category || 'Other',
          parsedResult.date,
          accId,
          sanitizeTags(Array.isArray(parsedResult.tags) ? parsedResult.tags : ['bank-sms'])
        ]
      );
      return res.status(201).json({ success: true, saved: true, result: parsedResult, transaction: savedRow });
    }

    res.json({ success: true, result: parsedResult });
  } catch (err) {
    console.error('AI parse-sms error:', err.message);
    res.status(500).json({ error: 'Failed to parse bank SMS. Please try again or fill manually.' });
  }
});

// ── AI Receipt Scanner (OCR) ──────────────────────────────────
router.post('/ai/scan-receipt', auth, async (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Receipt image data required' });
  if (!groq) return res.status(503).json({ error: 'AI not configured' });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const standardCategories = ['Food', 'Transport', 'Shopping', 'Entertainment', 'Health', 'Bills', 'Other'];

    const systemPrompt = `You are an expert receipt & invoice OCR parsing engine.
Examine the receipt image carefully and extract all structural data.
Today's date is: ${today}.
Standard categories: ${JSON.stringify(standardCategories)}.

Return ONLY a valid JSON object with the following fields:
{
  "merchant": "Store or merchant name (e.g. Starbucks, Walmart, Shell)",
  "amount": 0.00,
  "type": "expense",
  "category": "one of: Food, Transport, Shopping, Entertainment, Health, Bills, Other",
  "date": "YYYY-MM-DD date found on receipt, or ${today}",
  "tags": ["receipt", "merchant-name"],
  "line_items": ["Item name - price"]
}`;

    let jsonResult = null;
    const visionModels = Array.from(new Set([
      process.env.GROQ_VISION_MODEL,
      'llama-3.2-11b-vision-preview',
      'llama-3.2-90b-vision-preview',
      'qwen/qwen3.8-27b'
    ])).filter(Boolean);
    let lastErr = null;

    for (const vModel of visionModels) {
      try {
        const completion = await groq.chat.completions.create({
          model: vModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: systemPrompt },
                { type: 'image_url', image_url: { url: image } }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1500,
          temperature: 0.1
        });
        let content = completion.choices[0]?.message?.content || '';
        if (content.includes('</think>')) {
          content = content.split('</think>')[1].trim();
        }
        if (content) {
          jsonResult = JSON.parse(content);
          if (jsonResult) break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`Vision model ${vModel} failed:`, err.message);
      }
    }

    if (!jsonResult) {
      if (lastErr && (lastErr.status === 401 || (lastErr.message && lastErr.message.includes('invalid_api_key')))) {
        return res.status(401).json({ error: 'Groq API key is invalid or expired. Please update GROQ_API_KEY in backend/.env' });
      }
      throw lastErr || new Error('Failed to process image');
    }

    // Clean and validate extracted amount
    let rawAmount = jsonResult.amount;
    if (typeof rawAmount === 'string') {
      rawAmount = parseFloat(rawAmount.replace(/[^0-9.]/g, ''));
    }
    const finalAmount = (typeof rawAmount === 'number' && !isNaN(rawAmount) && rawAmount > 0) ? rawAmount : 0;

    // Normalize category
    const catNormalize = {
      'food & dining': 'Food', 'groceries': 'Food', 'restaurant': 'Food', 'dining': 'Food',
      'transportation': 'Transport', 'travel': 'Transport', 'fuel': 'Transport', 'gas': 'Transport',
      'utilities': 'Bills', 'bills & utilities': 'Bills', 'housing': 'Bills',
      'medical': 'Health', 'healthcare': 'Health', 'pharmacy': 'Health',
      'retail': 'Shopping', 'clothing': 'Shopping', 'electronics': 'Shopping'
    };
    let cat = jsonResult.category || 'Other';
    if (catNormalize[cat.toLowerCase()]) cat = catNormalize[cat.toLowerCase()];
    if (!standardCategories.includes(cat)) cat = 'Other';

    // Validate date format (YYYY-MM-DD)
    let finalDate = today;
    if (jsonResult.date && /^\d{4}-\d{2}-\d{2}$/.test(jsonResult.date)) {
      finalDate = jsonResult.date;
    }

    const cleanedResult = {
      merchant: jsonResult.merchant || 'Store Receipt',
      amount: finalAmount,
      type: 'expense',
      category: cat,
      date: finalDate,
      tags: Array.isArray(jsonResult.tags) ? jsonResult.tags.map(t => String(t).toLowerCase()) : ['receipt'],
      line_items: Array.isArray(jsonResult.line_items) ? jsonResult.line_items : []
    };

    if (!cleanedResult.amount) {
      return res.status(422).json({
        error: 'Could not detect total amount from receipt. Please ensure total is clearly visible or enter manually.',
        partialResult: cleanedResult
      });
    }

    res.json({ success: true, result: cleanedResult });
  } catch (e) {
    console.error('AI scan-receipt error:', e.message);
    res.status(500).json({ error: 'Failed to scan receipt. Please verify image clarity and try again.' });
  }
});

module.exports = router;
