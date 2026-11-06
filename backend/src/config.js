require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const JWT_SECRET = process.env.JWT_SECRET;

// A missing or weak secret would let anyone forge login tokens,
// so refuse to start instead of running insecurely.
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET is too short (min 32 characters). Refusing to start.');
  process.exit(1);
}

const csv = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  isProd,
  isTest,
  PORT: process.env.PORT || 3001,
  JWT_SECRET,
  SESSION_DAYS: 7,
  COOKIE_NAME: 'fl_session',
  // Cross-origin browsers are only trusted if listed here. Same-origin
  // requests (the normal case: API + frontend served together) always work.
  allowedOrigins: csv(process.env.ALLOWED_ORIGINS),
  // Cookies are Secure in production (HTTPS). Set COOKIE_SECURE=false only
  // when testing a production build over plain http://localhost.
  cookieSecure: isProd && process.env.COOKIE_SECURE !== 'false'
};
