const express = require('express');
const { authMiddleware } = require('../middleware');
const db = require('../db');

const router = express.Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const items = db.getHistory(req.user.userId, { limit, offset });
  const total = db.getHistoryCount(req.user.userId);
  const parsed = items.map(item => ({
    ...item,
    image_urls: JSON.parse(item.image_urls || '[]')
  }));
  res.json({ items: parsed, total, limit, offset });
});

router.post('/', (req, res) => {
  const { prompt, model, size, quality, n, image_urls, mode } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  if (!image_urls || !Array.isArray(image_urls)) return res.status(400).json({ error: 'image_urls must be an array' });
  const result = db.addHistory(req.user.userId, { prompt, model, size, quality, n, image_urls, mode });
  res.status(201).json(result);
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const deleted = db.deleteHistoryItem(req.user.userId, id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

router.delete('/', (req, res) => {
  const count = db.clearHistory(req.user.userId);
  res.json({ message: `Cleared ${count} items` });
});

module.exports = router;
