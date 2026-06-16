const express = require('express');
const { authMiddleware } = require('../middleware');
const db = require('../db');

const router = express.Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const items = db.getPresets(req.user.userId);
  const parsed = items.map(item => ({
    ...item,
    settings: JSON.parse(item.settings || '{}'),
    is_public: !!item.is_public,
    pinned: !!item.pinned
  }));
  res.json({ items: parsed });
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const item = db.getPresetById(req.user.userId, id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...item,
    settings: JSON.parse(item.settings || '{}'),
    is_public: !!item.is_public,
    pinned: !!item.pinned
  });
});

router.post('/', (req, res) => {
  const { name, description, prompt_template, settings, cover_url, is_public, pinned } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.createPreset(req.user.userId, { name, description, prompt_template, settings, cover_url, is_public, pinned });
  res.status(201).json(result);
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const updated = db.updatePreset(req.user.userId, id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found or not owned' });
  res.json({ message: 'Updated' });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const deleted = db.deletePreset(req.user.userId, id);
  if (!deleted) return res.status(404).json({ error: 'Not found or not owned' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
