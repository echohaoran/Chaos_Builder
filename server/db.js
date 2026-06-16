const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'chaosbuilder.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS generation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT DEFAULT 'gpt-image-2',
        size TEXT,
        quality TEXT,
        n INTEGER DEFAULT 1,
        image_urls TEXT,
        mode TEXT DEFAULT 'text-to-image',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt_template TEXT,
        settings TEXT,
        cover_url TEXT,
        is_public INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_history_user_id ON generation_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON generation_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
    `);
    // 老库迁移:加上 pinned 列(不存在时)
    const cols = db.prepare("PRAGMA table_info(presets)").all();
    if (!cols.some(function (c) { return c.name === 'pinned'; })) {
      db.exec("ALTER TABLE presets ADD COLUMN pinned INTEGER DEFAULT 0");
    }
  }
  return db;
}

// --- Users ---

function findUserByUsername(username) {
  return getDb().prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?').get(username);
}

function createUser(username, passwordHash) {
  const stmt = getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
  const result = stmt.run(username, passwordHash);
  return { id: result.lastInsertRowid, username, created_at: new Date().toISOString() };
}

function findUserById(id) {
  return getDb().prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

function updatePassword(id, newHash) {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, id);
}

// --- Generation History ---

function addHistory(userId, data) {
  const stmt = getDb().prepare(`
    INSERT INTO generation_history (user_id, prompt, model, size, quality, n, image_urls, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, data.prompt, data.model, data.size, data.quality, data.n, JSON.stringify(data.image_urls), data.mode);
  return { id: result.lastInsertRowid };
}

function getHistory(userId, { limit = 50, offset = 0 } = {}) {
  return getDb().prepare(
    'SELECT * FROM generation_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(userId, limit, offset);
}

function getHistoryCount(userId) {
  return getDb().prepare('SELECT COUNT(*) as count FROM generation_history WHERE user_id = ?').get(userId).count;
}

function deleteHistoryItem(userId, id) {
  const result = getDb().prepare('DELETE FROM generation_history WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

function clearHistory(userId) {
  const result = getDb().prepare('DELETE FROM generation_history WHERE user_id = ?').run(userId);
  return result.changes;
}

// --- Presets ---

function createPreset(userId, data) {
  const stmt = getDb().prepare(`
    INSERT INTO presets (user_id, name, description, prompt_template, settings, cover_url, is_public, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    userId,
    data.name,
    data.description,
    data.prompt_template,
    JSON.stringify(data.settings || {}),
    data.cover_url,
    data.is_public ? 1 : 0,
    data.pinned ? 1 : 0
  );
  return { id: result.lastInsertRowid };
}

function getPresets(userId) {
  // 按 pinned DESC 优先,再按 updated_at DESC
  return getDb().prepare(
    'SELECT * FROM presets WHERE user_id = ? OR is_public = 1 ORDER BY pinned DESC, updated_at DESC'
  ).all(userId);
}

function getPresetById(userId, id) {
  return getDb().prepare('SELECT * FROM presets WHERE id = ? AND (user_id = ? OR is_public = 1)').get(id, userId);
}

function updatePreset(userId, id, data) {
  const fields = [];
  const values = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.prompt_template !== undefined) { fields.push('prompt_template = ?'); values.push(data.prompt_template); }
  if (data.settings !== undefined) { fields.push('settings = ?'); values.push(JSON.stringify(data.settings)); }
  if (data.cover_url !== undefined) { fields.push('cover_url = ?'); values.push(data.cover_url); }
  if (data.is_public !== undefined) { fields.push('is_public = ?'); values.push(data.is_public ? 1 : 0); }
  if (data.pinned !== undefined) { fields.push('pinned = ?'); values.push(data.pinned ? 1 : 0); }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now')");
  values.push(id, userId);
  const result = getDb().prepare(`UPDATE presets SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  return result.changes > 0;
}

function deletePreset(userId, id) {
  const result = getDb().prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

// --- User Settings ---

function getSettings(userId) {
  const row = getDb().prepare('SELECT settings_json FROM user_settings WHERE user_id = ?').get(userId);
  return row ? JSON.parse(row.settings_json) : {};
}

function saveSettings(userId, settings) {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(settings));
}

module.exports = {
  getDb,
  findUserByUsername, createUser, findUserById, updatePassword,
  addHistory, getHistory, getHistoryCount, deleteHistoryItem, clearHistory,
  createPreset, getPresets, getPresetById, updatePreset, deletePreset,
  getSettings, saveSettings
};
