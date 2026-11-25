const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { allowedOrigins } = require('../config');

// Scripts: same-origin files + cdnjs only — no inline script execution.
// (Styles still allow 'unsafe-inline' because the UI uses style="" attributes.)
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

// An origin is trusted if it is this very server (same-origin) or is listed
// in ALLOWED_ORIGINS. Nothing else gets CORS headers.
function isAllowedOrigin(origin, req) {
  if (allowedOrigins.includes(origin)) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

const corsMiddleware = cors((req, cb) => {
  const origin = req.header('Origin');
  cb(null, {
    origin: !origin || isAllowedOrigin(origin, req),
    credentials: true,
    // Needed so the browser lets fetch() read the pagination header.
    exposedHeaders: ['X-Total-Count']
  });
});

// CSRF defence in depth (on top of SameSite=Lax cookies): a state-changing
// request that carries a foreign Origin header is rejected outright.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function originGuard(req, res, next) {
  const origin = req.header('Origin');
  if (SAFE_METHODS.has(req.method) || !origin || isAllowedOrigin(origin, req)) return next();
  res.status(403).json({ error: 'Cross-origin request blocked' });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

// Must be mounted AFTER `auth` so req.user.id is populated and users behind
// a shared NAT/proxy each get their own AI quota bucket.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : 'anon'),
  message: { error: 'AI rate limit reached. Please wait a few minutes before trying again.' }
});

module.exports = { securityHeaders, corsMiddleware, originGuard, authLimiter, apiLimiter, aiLimiter };
