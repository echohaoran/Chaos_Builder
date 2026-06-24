const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'chaosbuilder-dev-secret-change-in-production') {
  if (process.env.NODE_ENV === 'production') {
    console.error('ERROR: JWT_SECRET environment variable must be set in production.');
    console.error('Generate a strong secret: openssl rand -base64 48');
    process.exit(1);
  }
  console.warn('WARNING: Using default JWT_SECRET. Set JWT_SECRET environment variable for production.');
}
const FINAL_SECRET = JWT_SECRET || 'chaosbuilder-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

function signToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, role: user.role || 'user' }, FINAL_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, FINAL_SECRET);
    // 检查用户是否被禁用
    const db = require('./db');
    const user = db.findUserById(payload.userId);
    if (user && user.disabled) {
      return res.status(403).json({ error: 'Account disabled', message: '该账户已被禁用，请联系管理员。' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { signToken, authMiddleware, adminMiddleware, JWT_SECRET: FINAL_SECRET, apiLimiter };
