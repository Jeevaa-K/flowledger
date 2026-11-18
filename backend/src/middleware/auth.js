const jwt = require('jsonwebtoken');
const { JWT_SECRET, SESSION_DAYS, COOKIE_NAME, cookieSecure } = require('../config');
const { db } = require('../db');

const MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// The session lives in an httpOnly cookie, so page JavaScript (and therefore
// any XSS payload) can never read the token.
function cookieOptions() {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' };
}

function issueSession(res, user) {
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
  // Expose token in header so Capacitor/mobile native apps can store and send Authorization: Bearer
  res.set('X-Auth-Token', token);
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
      'SELECT id, name, email, currency, theme, timezone, token_version FROM users WHERE id=$1',
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
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
};

module.exports = { auth, issueSession, clearSession };
