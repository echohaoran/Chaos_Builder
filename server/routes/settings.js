const express = require('express');
const { authMiddleware } = require('../middleware');
const db = require('../db');

const router = express.Router();

router.use(authMiddleware);

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

module.exports = router;
