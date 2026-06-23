const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const emailSvc = require('./email');
const { signToken, authMiddleware } = require('./middleware');

const router = express.Router();
const BCRYPT_ROUNDS = 10;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{1,32}$/;

function validateUsername(username) {
  if (!username || typeof username !== 'string') return 'Username is required';
  if (!USERNAME_REGEX.test(username)) return 'Username must be 1-32 characters, letters, numbers, and underscores only';
  return null;
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  return null;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format';
  return null;
}

router.post('/register', (req, res) => {
  const { username, password } = req.body;

  const userErr = validateUsername(username);
  if (userErr) return res.status(400).json({ error: userErr });

  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const user = db.createUser(username, null, hash);
  const token = signToken(user);

  res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role, email: null, email_verified: 0 } });
});

router.post('/register-email', (req, res) => {
  const { username, password, email, code } = req.body;

  const userErr = validateUsername(username);
  if (userErr) return res.status(400).json({ error: userErr });

  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  const emailErr = validateEmail(email);
  if (emailErr) return res.status(400).json({ error: emailErr });

  if (!code) return res.status(400).json({ error: 'Verification code is required' });

  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Verify code
  if (!db.verifyEmailCode(email, code)) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const user = db.createUser(username, email, hash);
  const token = signToken(user);

  res.status(201).json({ token, user: { id: user.id, username: user.username, email, role: user.role, email_verified: 1 } });
});

router.post('/send-code', async (req, res) => {
  const { email } = req.body;
  const emailErr = validateEmail(email);
  if (emailErr) return res.status(400).json({ error: emailErr });

  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.saveEmailCode(email, code, expiresAt);

  const result = await emailSvc.sendVerificationEmail(email, code);
  if (!result.ok) {
    return res.status(500).json({ error: 'Failed to send email: ' + (result.error || 'SMTP not configured') });
  }
  res.json({ message: 'Verification code sent' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const userErr = validateUsername(username);
  if (userErr) return res.status(400).json({ error: userErr });

  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  const user = db.findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, email_verified: user.email_verified } });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role, email_verified: user.email_verified } });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const passErr = validatePassword(newPassword);
  if (passErr) return res.status(400).json({ error: passErr });

  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Need the full user with password_hash
  const fullUser = db.getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
  if (!fullUser || !bcrypt.compareSync(oldPassword, fullUser.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  db.updatePassword(req.user.userId, newHash);

  res.json({ message: 'Password changed successfully' });
});

module.exports = router;