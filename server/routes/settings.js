const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware');
const db = require('../db');

const router = express.Router();

router.use(authMiddleware);

// User's own settings
router.get('/', (req, res) => {
  const settings = db.getSettings(req.user.userId);
  res.json(settings);
});

router.put('/', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  db.saveSettings(req.user.userId, req.body);
  res.json({ message: 'Settings saved' });
});

// Admin global settings
router.get('/admin', (req, res) => {
  const settings = db.getAppSettings();
  res.json(settings);
});

router.put('/admin', adminMiddleware, (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  db.saveAppSettings(req.body, req.user.userId);
  res.json({ message: 'Global settings saved' });
});

// Admin user management
router.get('/admin/users', adminMiddleware, (req, res) => {
  const users = db.getUsers();
  res.json({ users });
});

router.put('/admin/users/:userId/role', adminMiddleware, (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }
  db.setUserRole(parseInt(req.params.userId), role);
  res.json({ message: 'Role updated' });
});

router.put('/admin/users/:userId/disabled', adminMiddleware, (req, res) => {
  const { disabled } = req.body;
  if (typeof disabled !== 'boolean' && typeof disabled !== 'number') {
    return res.status(400).json({ error: 'disabled must be boolean or 0/1' });
  }
  db.setUserDisabled(parseInt(req.params.userId), disabled ? 1 : 0);
  res.json({ message: disabled ? 'User disabled' : 'User enabled' });
});

router.delete('/admin/users/:userId', adminMiddleware, (req, res) => {
  db.deleteUser(parseInt(req.params.userId));
  res.json({ message: 'User deleted' });
});

module.exports = router;