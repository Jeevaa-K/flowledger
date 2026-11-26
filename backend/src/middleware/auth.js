const jwt = require('jsonwebtoken');
const { JWT_SECRET, SESSION_DAYS, COOKIE_NAME, cookieSecure, DEMO_EMAIL } = require('../config');
const { db } = require('../db');

function isDemoUser(user) {
  if (!user || !user.email) return false;
  return user.email.toLowerCase().trim() === DEMO_EMAIL;
}

const MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// The session lives in an httpOnly cookie, so page JavaScript (and therefore
// any XSS payload) can never read the token.
function cookieOptions() {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' };
}

function issueSession(res, user, req = null) {
  const request = req || res.req;
  const token = jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      token_version: user.token_version !== undefined ? user.token_version : 1
    },
    JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
  // Expose token in header ONLY when the client says it is native (X-Client: native)
  const isNative = request && (
    (typeof request.get === 'function' && request.get('X-Client') === 'native') ||
    request.headers?.['x-client'] === 'native'
  );
  if (isNative) {
    res.set('X-Auth-Token', token);
  }
  return token;
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

// Cookie first; a Bearer header is still accepted for scripts / API clients.
function readToken(req) {
  const fromCookie = req.cookies && req.cookies[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

const auth = async (req, res, next) => {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'No session — please login' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get(
      'SELECT id, name, email, currency, theme, timezone, ai_consent, token_version FROM users WHERE id=$1',
      [decoded.id]
    );
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    if (
      decoded.token_version !== undefined &&
      user.token_version !== undefined &&
      decoded.token_version !== user.token_version
    ) {
      return res.status(401).json({ error: 'Session has been invalidated. Please login again.' });
    }
    req.user = user;
    req.isDemo = isDemoUser(user);

    // If this is a demo account attempting a state-changing operation on any protected route
    // (except safe demo endpoints like /api/auth/logout), enforce read-only restriction.
    const isStateMutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (req.isDemo && isStateMutation && req.path !== '/auth/logout') {
      return res.status(403).json({
        error: 'Demo account is read-only. Data modifications are disabled.'
      });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
};

const READ_ONLY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware that prevents demo accounts from modifying data.
 * Safe read methods (GET, HEAD, OPTIONS) are allowed.
 */
const demoReadOnly = (req, res, next) => {
  if (req.isDemo && READ_ONLY_METHODS.has(req.method)) {
    return res.status(403).json({
      error: 'Demo account is read-only. Data modifications are disabled.'
    });
  }
  next();
};

module.exports = { auth, issueSession, clearSession, demoReadOnly, isDemoUser };
