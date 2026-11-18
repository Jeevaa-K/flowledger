# FlowLedger

Personal finance tracker: transactions, budgets, goals, accounts, recurring
payments, group expense splitting, PDF/CSV reports and a Groq-powered AI
assistant ("NOVA"). Node/Express + PostgreSQL backend, vanilla-JS frontend.

## Run locally
```bash
cd backend
cp .env.example .env     # then set JWT_SECRET (generate with: openssl rand -hex 64) and DATABASE_URL
npm install
npm run dev              # http://localhost:3001  (Windows: double-click start.bat)
```

## Test
```bash
cd backend && npm test   # no database required (the DB layer is mocked)
```

## Hybrid App (PWA & Mobile)

FlowLedger is built as a **hybrid application** with two deployment modes:

### 1. Progressive Web App (PWA)
- **Install anywhere**: Open in Chrome, Edge, Safari, or mobile browser, and click **📲 Install App** (or "Add to Home Screen").
- **Offline support**: Pre-caches static application shell and assets via Service Worker (`sw.js`).
- **Web App Manifest**: Full standalone app window experience with shortcuts and branding.

### 2. Native Mobile (Capacitor for Android / iOS)
The project is pre-configured with Capacitor (`capacitor.config.json`):
```bash
# 1. Install dependencies
npm install

# 2. Add Android or iOS native platform project
npm run cap:add:android
npm run cap:add:ios

# 3. Sync frontend assets into native project
npm run cap:sync

# 4. Open in Android Studio / Xcode to build APK or IPA
npm run cap:open:android
npm run cap:open:ios
```
*(In mobile webview, you can point to your backend API via `localStorage.setItem('fl_api_url', 'https://your-backend-url')` if hosted remotely).*

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
