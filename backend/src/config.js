const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
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
const INSECURE_JWT_DEFAULTS = new Set([
  'CHANGE_ME_generate_with_openssl_rand_hex_64',
  'change_me_to_a_long_random_string_of_32_plus_chars',
  'secret',
  'jwt_secret',
  'your_secret_key_here'
]);

if (isProd && (INSECURE_JWT_DEFAULTS.has(JWT_SECRET) || /change_me/i.test(JWT_SECRET))) {
  console.error('❌ FATAL: Default or placeholder JWT_SECRET detected in production. Generate a secure secret using: openssl rand -hex 64');
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
