const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
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
  const user = db.createUser(username, hash);
  const token = signToken(user);

  res.status(201).json({ token, user: { id: user.id, username: user.username } });
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
  res.json({ token, user: { id: user.id, username: user.username } });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, username: user.username } });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const passErr = validatePassword(newPassword);
  if (passErr) return res.status(400).json({ error: passErr });

  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  db.updatePassword(req.user.userId, newHash);

  res.json({ message: 'Password changed successfully' });
});

module.exports = router;
