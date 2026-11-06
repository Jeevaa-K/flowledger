# FlowLedger

Personal finance tracker: transactions, budgets, goals, accounts, recurring
payments, group expense splitting, PDF/CSV reports and a Groq-powered AI
assistant ("NOVA"). Node/Express + PostgreSQL backend, vanilla-JS frontend.

## Run locally
```bash
cd backend
cp .env.example .env     # then set JWT_SECRET and DATABASE_URL
npm install
npm run dev              # http://localhost:3001  (Windows: double-click start.bat)
```

## Test
```bash
cd backend && npm test   # no database required (the DB layer is mocked)
```

## Project layout
```
backend/
  server.js              entry point: DB init, cron job, listen, graceful shutdown
  src/
    app.js               Express app factory (middleware + route mounting)
    config.js            env validation (fails fast on a weak JWT_SECRET)
    db.js                pg pool, schema creation / idempotent migrations
    middleware/          auth (session cookie), security (CSP, CORS, CSRF guard, rate limits)
    routes/              auth, transactions, budgets, goals, accounts, tags,
                         recurring, aiChat, aiTools, groups, reports
    services/ai.js       Groq client + model fallback, Langfuse tracing
    jobs/recurring.js    nightly recurring-transaction processor
    utils.js             safeError, sanitizeTags, csvField, EMAIL_RE
  tests/                 Jest + supertest
frontend/                static SPA served by the backend
```

## Security model
- **Session**: 7-day JWT in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in
  production). JavaScript never sees the token. `POST /api/auth/logout` clears it.
- **CSRF**: SameSite cookie + a server-side `Origin` check on all state-changing requests.
- **CORS**: same-origin by default; other origins must be listed in `ALLOWED_ORIGINS`.
- **CSP**: scripts only from `'self'` and cdnjs — no inline scripts.
- **Database TLS**: verified by default in production (see `.env.example`).
- Rate limiting on auth (20 / 15 min) and the API (300 / 15 min); bcrypt password hashing.

## Deploying (Render)
Set `NODE_ENV=production`, `JWT_SECRET`, `DATABASE_URL`, optionally `GROQ_API_KEY`.
Health check path: `/api/health`.
If the database connection fails with a certificate error, see the DB TLS notes in `.env.example`.
