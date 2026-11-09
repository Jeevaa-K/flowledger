const jwt = require('jsonwebtoken');
const { JWT_SECRET, SESSION_DAYS, COOKIE_NAME, cookieSecure } = require('../config');

const MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// The session lives in an httpOnly cookie, so page JavaScript (and therefore
// any XSS payload) can never read the token.
function cookieOptions() {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' };
}

function issueSession(res, user) {
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
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

const auth = (req, res, next) => {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'No session — please login' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
};

module.exports = { auth, issueSession, clearSession };
