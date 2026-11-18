const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { allowedOrigins } = require('../config');

// Scripts: same-origin files + cdnjs only — no inline script execution.
// (Styles still allow 'unsafe-inline' because the UI uses style="" attributes.)
// Hybrid & PWA: allows service worker, web manifest, and Capacitor native origins.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", 'capacitor://localhost', 'http://localhost'],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'capacitor://localhost', 'http://localhost', 'https:'],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

// Explicit allowed origins for web, Capacitor native hybrid apps, and configured domains
const EXPLICIT_ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  ...allowedOrigins
];

// An origin is trusted if it is this very server (same-origin), listed in EXPLICIT_ALLOWED_ORIGINS,
// or a native hybrid app container (Capacitor/Cordova webview).
function isAllowedOrigin(origin, req) {
  if (!origin) return true;
  if (EXPLICIT_ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const originHost = new URL(origin).host;
    if (originHost && req && req.headers && req.headers.host && originHost === req.headers.host) {
      return true;
    }
  } catch {}
  return false;
}

const corsMiddleware = cors((req, cb) => {
  const origin = req.header('Origin');
  cb(null, {
    origin: !origin || isAllowedOrigin(origin, req),
    credentials: true,
    // Expose pagination header and native auth token header for Capacitor apps
    exposedHeaders: ['X-Total-Count', 'X-Auth-Token']
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

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  keyGenerator: (req) => req.user?.id ? String(req.user.id) : (req.ip || 'anonymous'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a minute and try again.' }
});

module.exports = { securityHeaders, corsMiddleware, originGuard, authLimiter, apiLimiter, aiLimiter };
