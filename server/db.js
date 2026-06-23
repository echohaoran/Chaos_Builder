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
        email TEXT,
        email_verified INTEGER DEFAULT 0,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS email_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by INTEGER,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_history_user_id ON generation_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON generation_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
    `);
    // 迁移:添加 role 列(老库)
    const userCols = db.prepare("PRAGMA table_info(users)").all();
    if (!userCols.some(function (c) { return c.name === 'role'; })) {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    }
    if (!userCols.some(function (c) { return c.name === 'email'; })) {
      db.exec("ALTER TABLE users ADD COLUMN email TEXT");
      db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
    }
    if (!userCols.some(function (c) { return c.name === 'disabled'; })) {
      db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
    }
    if (!userCols.some(function (c) { return c.name === 'api_calls'; })) {
      db.exec("ALTER TABLE users ADD COLUMN api_calls INTEGER NOT NULL DEFAULT 0");
    }
    if (!userCols.some(function (c) { return c.name === 'last_api_call'; })) {
      db.exec("ALTER TABLE users ADD COLUMN last_api_call TEXT");
    }
    // 迁移:pinned 列(老库)
    const presetCols = db.prepare("PRAGMA table_info(presets)").all();
    if (!presetCols.some(function (c) { return c.name === 'pinned'; })) {
      db.exec("ALTER TABLE presets ADD COLUMN pinned INTEGER DEFAULT 0");
    }
    // 初始化 app_settings 行
    const existing = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
    if (!existing) {
      db.prepare('INSERT INTO app_settings (id, settings_json) VALUES (1, ?)').run(JSON.stringify({
        imageProvider: 'ppio',
        imageModel: 'gpt-image-2',
        textProvider: 'openai',
        textModel: 'gpt-4o-mini',
      }));
    }
  }
  return db;
}

// --- Users ---

function findUserByUsername(username) {
  return getDb().prepare('SELECT id, username, email, email_verified, password_hash, role, created_at FROM users WHERE username = ?').get(username);
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT id, username, email, email_verified, role, created_at FROM users WHERE email = ?').get(email);
}

function createUser(username, email, passwordHash) {
  const stmt = getDb().prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const count = getDb().prepare('SELECT COUNT(*) as c FROM users').get().c;
  const role = count === 0 ? 'admin' : 'user';
  const result = stmt.run(username, email, passwordHash, role);
  return { id: result.lastInsertRowid, username, email, role, created_at: new Date().toISOString() };
}

function findUserById(id) {
  return getDb().prepare('SELECT id, username, email, email_verified, role, created_at FROM users WHERE id = ?').get(id);
}

// Email verification codes
function saveEmailCode(email, code, expiresAt) {
  getDb().prepare('INSERT INTO email_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);
}

function verifyEmailCode(email, code) {
  const row = getDb().prepare(
    "SELECT id FROM email_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).get(email, code);
  if (!row) return false;
  getDb().prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(row.id);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(email);
  return true;
}

function getUserCount() {
  return getDb().prepare('SELECT COUNT(*) as c FROM users').get().c;
}

function getUsers() {
  return getDb().prepare('SELECT id, username, role, disabled, api_calls, last_api_call, created_at FROM users ORDER BY created_at ASC').all();
}

function setUserRole(userId, role) {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

function setUserDisabled(userId, disabled) {
  getDb().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId);
}

function deleteUser(userId) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function incrementApiCalls(userId) {
  getDb().prepare("UPDATE users SET api_calls = api_calls + 1, last_api_call = datetime('now') WHERE id = ?").run(userId);
}

function updatePassword(id, newHash) {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, id);
}

// --- App Settings ---

function getAppSettings() {
  const row = getDb().prepare('SELECT settings_json FROM app_settings WHERE id = 1').get();
  return row ? JSON.parse(row.settings_json) : {};
}

function saveAppSettings(settings, userId) {
  getDb().prepare(`
    INSERT INTO app_settings (id, settings_json, updated_at, updated_by) VALUES (1, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(JSON.stringify(settings), userId);
}

// --- Generation History ---

function addHistory(userId, data) {
  const stmt = getDb().prepare(`
    INSERT INTO generation_history (user_id, prompt, model, size, quality, n, image_urls, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, data.prompt, data.model, data.size, data.quality, data.n, JSON.stringify(data.image_urls), data.mode);
  incrementApiCalls(userId);
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
    userId, data.name, data.description, data.prompt_template,
    JSON.stringify(data.settings || {}), data.cover_url,
    data.is_public ? 1 : 0, data.pinned ? 1 : 0
  );
  return { id: result.lastInsertRowid };
}

function getPresets(userId) {
  return getDb().prepare(
    'SELECT * FROM presets WHERE user_id = ? OR is_public = 1 ORDER BY pinned DESC, updated_at DESC'
  ).all(userId);
}

function getPresetById(userId, id) {
  return getDb().prepare('SELECT * FROM presets WHERE id = ? AND (user_id = ? OR is_public = 1)').get(id, userId);
}

function updatePreset(userId, id, data) {
  const fields = []; const values = [];
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
  findUserByUsername, findUserByEmail, createUser, findUserById, getUserCount, getUsers, setUserRole, setUserDisabled, deleteUser, updatePassword,
  getAppSettings, saveAppSettings,
  saveEmailCode, verifyEmailCode,
  addHistory, getHistory, getHistoryCount, deleteHistoryItem, clearHistory,
  createPreset, getPresets, getPresetById, updatePreset, deletePreset,
  getSettings, saveSettings
};
