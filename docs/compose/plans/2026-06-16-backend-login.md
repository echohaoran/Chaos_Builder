# ChaosBuilder 后端登录系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Express+SQLite+JWT 搭建认证后端，完全替换前端 localStorage 伪认证，保持 `window.Auth` 公开 API 签名兼容。

**Architecture:** `chaosbuilder-server/` 子目录（5 文件）提供 4 个 REST 端点。前端 `js/auth.js` 完全重写：登录模态框新增密码输入，令牌存 localStorage，所有 API 调用走后端 JWT 验证。`js/api.js` 的 `configKey()`/`historyKeyPrefix()` 通过 `Auth.userKey()` 保持用户数据隔离。

**Tech Stack:** Node.js 18+, Express 4, better-sqlite3 11, bcryptjs 2.4, jsonwebtoken 9, cors 2.8

---

## 文件结构

```
chaosbuilder-server/       ← 新建
├── package.json
├── server.js              ← Express 入口，端口 3001
├── db.js                  ← SQLite users 表初始化
├── auth.js                ← 4 个认证路由
└── middleware.js           ← JWT 验证中间件

js/
├── config.js              ← 新建：AUTH_API_BASE 集中配置
├── auth.js                ← 完全重写（562行 → ~350行）
├── i18n.js                ← 修改：新增 6 个 auth key
└── api.js                 ← 无需修改（userKey 签名已兼容）
```

---

### Task 1: 后端项目骨架

**Covers:** S1

**Files:**
- Create: `chaosbuilder-server/package.json`
- Create: `chaosbuilder-server/.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "chaosbuilder-server",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.0.0",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```
node_modules/
*.db
```

- [ ] **Step 3: 安装依赖**

```bash
cd chaosbuilder-server && npm install
```

预期：`npm install` 成功，`node_modules/` 生成，无错误。

---

### Task 2: 数据库模块

**Covers:** S1

**Files:**
- Create: `chaosbuilder-server/db.js`

- [ ] **Step 1: 创建 db.js**

```js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'chaosbuilder.db');

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
      )
    `);
  }
  return db;
}

module.exports = { getDb };
```

- [ ] **Step 2: 验证模块可加载**

```bash
cd chaosbuilder-server && node -e "const { getDb } = require('./db'); const db = getDb(); const row = db.prepare('SELECT count(*) as cnt FROM users').get(); console.log('row:', row); console.log('ok');"
```

预期：输出 `row: { cnt: 0 }` 和 `ok`，无错误。

---

### Task 3: JWT 中间件

**Covers:** S2 (JWT 验证部分)

**Files:**
- Create: `chaosbuilder-server/middleware.js`

- [ ] **Step 1: 创建 middleware.js**

```js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'chaosbuilder-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '缺少认证令牌' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

module.exports = { signToken, authMiddleware, JWT_SECRET, JWT_EXPIRES_IN };
```

- [ ] **Step 2: 验证 signToken + 验证 往返**

```bash
cd chaosbuilder-server && node -e "
const { signToken, authMiddleware } = require('./middleware');
const token = signToken({ id: 1, username: 'test' });
console.log('token:', typeof token === 'string' && token.split('.').length === 3);
const jwt = require('jsonwebtoken');
const decoded = jwt.verify(token, require('./middleware').JWT_SECRET);
console.log('decoded:', decoded.userId === 1 && decoded.username === 'test');
console.log('ok');
"
```

预期：两行 `true` 和 `ok`，无错误。

---

### Task 4: 认证路由

**Covers:** S2 (全部 4 个 API 端点)

**Files:**
- Create: `chaosbuilder-server/auth.js`

- [ ] **Step 1: 创建 auth.js**

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const { signToken, authMiddleware } = require('./middleware');

const router = express.Router();
const SALT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{1,32}$/;

function validateUsername(username) {
  if (!username || !USERNAME_RE.test(username)) {
    return '用户名须为 1-32 位字母、数字或下划线';
  }
  return null;
}

function validatePassword(password) {
  if (!password || password.length < 6) {
    return '密码至少需要 6 位';
  }
  return null;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, password } = req.body || {};

  const userErr = validateUsername(username);
  if (userErr) return res.status(400).json({ error: userErr });

  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, password_hash);

  const token = signToken({ id: result.lastInsertRowid, username });
  res.status(201).json({ token, user: { id: result.lastInsertRowid, username } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  const userErr = validateUsername(username);
  if (userErr) return res.status(400).json({ error: userErr });

  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  const db = getDb();
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.user.userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  res.json({ user: { id: user.id, username: user.username } });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};

  if (!oldPassword) return res.status(400).json({ error: '请输入旧密码' });

  const passErr = validatePassword(newPassword);
  if (passErr) return res.status(400).json({ error: passErr });

  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: '旧密码错误' });
  }

  const newHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.userId);
  res.json({ message: '密码修改成功' });
});

module.exports = router;
```

- [ ] **Step 2: 验证路由模块可加载**

```bash
cd chaosbuilder-server && node -e "const auth = require('./auth'); console.log('router type:', typeof auth); console.log('stack length:', auth.stack.length); console.log('ok');"
```

预期：`router type: function`，`stack length: 4`（4 个路由），`ok`。

---

### Task 5: 服务器入口

**Covers:** S1

**Files:**
- Create: `chaosbuilder-server/server.js`

- [ ] **Step 1: 创建 server.js**

```js
const express = require('express');
const cors = require('cors');
const authRoutes = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`ChaosBuilder auth server running on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: 启动服务器并测试健康检查**

```bash
cd chaosbuilder-server && node server.js &
sleep 2
curl -s http://localhost:3001/api/health
```

预期：`{"status":"ok"}`

- [ ] **Step 3: 停止测试服务器**

```bash
kill $(lsof -ti:3001) 2>/dev/null || true
```

---

### Task 6: i18n 新增认证 key

**Covers:** S3

**Files:**
- Modify: `js/i18n.js`（zh-CN 第 33 行，en 第 284 行，zh-CN 第 45 行之后，en 第 296 行之后）

**变更清单：**
1. **修改** zh-CN `authLoginBtn`：`'登录 / 创建'` → `'登录'`
2. **修改** en `authLoginBtn`：`'Login / Create'` → `'Log in'`
3. **新增** zh-CN auth 段末尾（`authWelcome` 之后）4 个 key：`authPasswordLabel`, `authPasswordPlaceholder`, `authRegisterBtn`, `authErrorPassword`
4. **新增** en auth 段末尾（`authWelcome` 之后）4 个 key：同上（英文值）

- [ ] **Step 1: 修改 zh-CN authLoginBtn 值**

在 `js/i18n.js` 中找到第 33 行：
```
    authLoginBtn: '登录 / 创建',
```
替换为：
```
    authLoginBtn: '登录',
```

- [ ] **Step 2: 修改 en authLoginBtn 值**

在 `js/i18n.js` 中找到第 284 行：
```
    authLoginBtn: 'Login / Create',
```
替换为：
```
    authLoginBtn: 'Log in',
```

- [ ] **Step 3: 在 zh-CN auth段末尾新增 4 个 key**

在 `js/i18n.js` 第 45 行（`authWelcome: '欢迎，{name}',`）之后，空行之前，插入：

```
    authPasswordLabel: '密码',
    authPasswordPlaceholder: '输入密码',
    authRegisterBtn: '注册',
    authErrorPassword: '密码至少 6 位',
```

- [ ] **Step 4: 在 en auth段末尾新增 4 个 key**

在 `js/i18n.js` 第 296 行（`authWelcome: 'Welcome, {name}',`）之后，空行之前，插入：

```
    authPasswordLabel: 'Password',
    authPasswordPlaceholder: 'Enter password',
    authRegisterBtn: 'Register',
    authErrorPassword: 'Password must be at least 6 characters',
```

- [ ] **Step 5: 验证 i18n 无语法错误**

```bash
node --check js/i18n.js && echo "syntax ok"
```

预期：`syntax ok`

---

### Task 7: 前端配置模块

**Covers:** S3

**Files:**
- Create: `js/config.js`

- [ ] **Step 1: 创建 config.js**

```js
window.AUTH_CONFIG = {
  API_BASE: 'http://localhost:3001',
  TOKEN_KEY: 'chaos_builder_token',
};
```

- [ ] **Step 2: 在所有 HTML 页面中插入 config.js 引用**

在以下 8 个 HTML 文件中，将 `<script src="js/auth.js"></script>` 替换为：
```html
<script src="js/config.js"></script>
<script src="js/auth.js"></script>
```

文件列表：`index.html:357`, `landing.html:506`, `settings.html:250`, `preset-detail.html:417`, `preset-styles.html:330`, `multi-image.html:411`, `image-to-image.html:411`, `text-to-image.html:363`

- [ ] **Step 3: 确认无语法错误**

```bash
node --check js/config.js && echo "syntax ok"
```

预期：`syntax ok`

---

### Task 8: 重写前端 auth.js

**Covers:** S3 (全部前端接入逻辑)

**Files:**
- Create: `js/auth.js`（完全重写）

**关键要求：**
- 保持 `window.Auth` API 签名：`getCurrentUser()`, `login(name, password)`, `logout()`, `userKey(suffix)`, `renderUserMenu(selector)`, `showLoginModal({onLogin})`, `hideLoginModal()`, `init()`
- 保持登录模态框 DOM 结构与现有 CSS 兼容（class 名不变）
- 保持用户菜单 DOM 结构与现有 CSS 兼容
- 新增密码输入框
- 令牌存 `localStorage` key `chaos_builder_token`
- 注册行为：用户名+密码 → 先 POST /login → 401 则 POST /register → 成功存 token
- `userKey()` 必须返回与旧版相同格式：`'chaos_builder_u_' + user.id + ':' + suffix`（id 现在来自后端 integer）

- [ ] **Step 1: 写入重写的 auth.js**

```js
/**
 * ChaosBuilder backend-backed JWT authentication.
 * Replaces the old localStorage pseudo-auth with real login/register via the auth server.
 * Public API (window.Auth) unchanged so api.js and HTML continue to work.
 */

(function () {
  'use strict';

  var API_BASE = (window.AUTH_CONFIG && window.AUTH_CONFIG.API_BASE) || 'http://localhost:3001';
  var TOKEN_KEY = (window.AUTH_CONFIG && window.AUTH_CONFIG.TOKEN_KEY) || 'chaos_builder_token';
  var USERNAME_MAX_LENGTH = 32;

  /* ── token helpers ── */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  /* ── user state ── */

  var _currentUser = null;

  function parseTokenUser(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.userId && payload.username) {
        return { id: payload.userId, name: payload.username };
      }
    } catch (_) {}
    return null;
  }

  function restoreFromToken() {
    if (_currentUser) return _currentUser;
    var token = getToken();
    if (token) {
      _currentUser = parseTokenUser(token);
    }
    return _currentUser;
  }

  function getCurrentUser() {
    return restoreFromToken();
  }

  /* ── API calls ── */

  function authFetch(path, options) {
    var opts = options || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    var token = getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || ('请求失败 HTTP ' + res.status));
        }
        return data;
      });
    });
  }

  function apiLogin(username, password) {
    return authFetch('/api/auth/login', {
      method: 'POST',
      body: { username: username, password: password },
    });
  }

  function apiRegister(username, password) {
    return authFetch('/api/auth/register', {
      method: 'POST',
      body: { username: username, password: password },
    });
  }

  function apiMe() {
    return authFetch('/api/auth/me');
  }

  function apiChangePassword(oldPassword, newPassword) {
    return authFetch('/api/auth/change-password', {
      method: 'POST',
      body: { oldPassword: oldPassword, newPassword: newPassword },
    });
  }

  /* ── public auth actions ── */

  function login(name, password) {
    if (!name) return Promise.resolve(null);
    var trimmed = sanitizeUsername(name);
    if (!trimmed) return Promise.resolve(null);
    if (!password || password.length < 6) return Promise.resolve(null);

    return apiLogin(trimmed, password).then(function (data) {
      saveToken(data.token);
      _currentUser = { id: data.user.id, name: data.user.username };
      dispatchChanged('login');
      return _currentUser;
    }).catch(function (err) {
      throw err;
    });
  }

  function register(name, password) {
    if (!name) return Promise.resolve(null);
    var trimmed = sanitizeUsername(name);
    if (!trimmed) return Promise.resolve(null);

    return apiRegister(trimmed, password).then(function (data) {
      saveToken(data.token);
      _currentUser = { id: data.user.id, name: data.user.username };
      dispatchChanged('register');
      return _currentUser;
    });
  }

  function logout() {
    clearToken();
    _currentUser = null;
    dispatchChanged('logout');
  }

  function userKey(suffix) {
    var user = getCurrentUser();
    if (!user) return 'chaos_builder_guest:' + suffix;
    return 'chaos_builder_u_' + user.id + ':' + suffix;
  }

  /* ── validation ── */

  function sanitizeUsername(name) {
    return (name || '')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, USERNAME_MAX_LENGTH);
  }

  /* ── i18n helpers (same as original) ── */

  function translate(key, fallback) {
    if (window.I18N && window.I18N.t) return window.I18N.t(key, fallback);
    return fallback || key;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function getInitials(name) {
    if (!name) return '?';
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function dispatchChanged(reason) {
    document.dispatchEvent(new CustomEvent('auth:changed', {
      detail: { user: getCurrentUser(), reason: reason || 'change' },
    }));
  }

  /* ── requireAuth ── */

  function requireAuth() {
    var path = window.location.pathname || '';
    var file = path.split('/').pop() || 'index.html';
    var publicPages = ['index.html', 'landing.html'];
    if (publicPages.indexOf(file) !== -1) return;
    if (!getCurrentUser()) {
      window.location.href = 'index.html';
    }
  }

  /* ══════════════════════════════════════
   * Login modal (with password field)
   * ══════════════════════════════════════ */

  function getFocusableElements(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) {
      return el.offsetParent !== null;
    });
  }

  function trapFocus(overlay) {
    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      var focusables = getFocusableElements(overlay);
      if (!focusables.length) { e.preventDefault(); return; }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    overlay._focusTrapHandler = onKeyDown;
    overlay.addEventListener('keydown', onKeyDown);
  }

  function setButtonLoading(btn, isLoading) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.classList.toggle('is-loading', isLoading);
    if (isLoading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + escapeHtml(translate('authLoginBtnLoading', '处理中…'));
    } else if (btn.dataset.originalText) {
      btn.innerHTML = btn.dataset.originalText;
    }
  }

  function showFormError(form, messageKey) {
    if (!form) return;
    var error = form.querySelector('.auth-form-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'auth-form-error';
      error.setAttribute('role', 'alert');
      form.insertBefore(error, form.firstChild);
    }
    error.textContent = translate(messageKey, messageKey);
    error.hidden = false;
  }

  function clearFormError(form) {
    if (!form) return;
    var error = form.querySelector('.auth-form-error');
    if (error) { error.textContent = ''; error.hidden = true; }
  }

  function createLoginModal() {
    var overlay = document.getElementById('chaos-login-modal');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'chaos-login-modal';
    overlay.className = 'auth-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'auth-modal-heading');
    overlay.setAttribute('tabindex', '-1');
    overlay.innerHTML =
      '<div class="auth-modal">' +
        '<button type="button" class="auth-modal-close" aria-label="' + escapeHtml(translate('actionClose', 'Close')) + '">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<h2 id="auth-modal-heading" class="auth-modal-title" data-i18n="authLoginTitle">登录至混沌艺术</h2>' +
        '<p class="auth-modal-subtitle" data-i18n="authLoginSubtitle">每个账户的配置与生图记录相互独立。</p>' +
        '<form class="auth-form" id="auth-login-form" novalidate>' +
          '<div class="field">' +
            '<label for="auth-username" data-i18n="authUsernameLabel">用户名</label>' +
            '<input type="text" id="auth-username" name="username" autocomplete="username" maxlength="' + USERNAME_MAX_LENGTH + '" data-i18n-attr="placeholder" data-i18n-placeholder="authUsernamePlaceholder" placeholder="输入用户名" />' +
          '</div>' +
          '<div class="field">' +
            '<label for="auth-password" data-i18n="authPasswordLabel">密码</label>' +
            '<input type="password" id="auth-password" name="password" autocomplete="current-password" data-i18n-attr="placeholder" data-i18n-placeholder="authPasswordPlaceholder" placeholder="输入密码" />' +
          '</div>' +
          '<button type="submit" class="btn btn-primary" data-i18n="authLoginBtn">登录</button>' +
          '<button type="button" class="btn btn-secondary" id="auth-register-btn" data-i18n="authRegisterBtn">注册</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(overlay);

    var closeBtn = overlay.querySelector('.auth-modal-close');
    closeBtn.addEventListener('click', hideLoginModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hideLoginModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var activeOverlay = document.getElementById('chaos-login-modal');
        if (activeOverlay && activeOverlay.classList.contains('active')) hideLoginModal();
      }
    });

    var form = document.getElementById('auth-login-form');

    function handleSubmit(e) {
      e.preventDefault();
      clearFormError(form);
      var usernameInput = document.getElementById('auth-username');
      var passwordInput = document.getElementById('auth-password');
      var rawName = usernameInput.value;
      var trimmed = sanitizeUsername(rawName);
      if (!trimmed) {
        showFormError(form, 'authErrorEmptyUsername');
        usernameInput.focus();
        return;
      }
      var password = passwordInput.value;
      if (!password || password.length < 6) {
        showFormError(form, 'authErrorPassword');
        passwordInput.focus();
        return;
      }
      var submitBtn = form.querySelector('button[type="submit"]');
      setButtonLoading(submitBtn, true);

      login(trimmed, password)
        .then(function (user) {
          setButtonLoading(submitBtn, false);
          hideLoginModal();
          if (typeof overlay._onLogin === 'function') overlay._onLogin(user);
        })
        .catch(function (err) {
          setButtonLoading(submitBtn, false);
          showFormError(form, err.message || '登录失败，请重试');
        });
    }

    form.addEventListener('submit', handleSubmit);

    var registerBtn = document.getElementById('auth-register-btn');
    registerBtn.addEventListener('click', function () {
      clearFormError(form);
      var usernameInput = document.getElementById('auth-username');
      var passwordInput = document.getElementById('auth-password');
      var rawName = usernameInput.value;
      var trimmed = sanitizeUsername(rawName);
      if (!trimmed) {
        showFormError(form, 'authErrorEmptyUsername');
        usernameInput.focus();
        return;
      }
      var password = passwordInput.value;
      if (!password || password.length < 6) {
        showFormError(form, 'authErrorPassword');
        passwordInput.focus();
        return;
      }
      setButtonLoading(registerBtn, true);

      register(trimmed, password)
        .then(function (user) {
          setButtonLoading(registerBtn, false);
          hideLoginModal();
          if (typeof overlay._onLogin === 'function') overlay._onLogin(user);
          dispatchChanged('register');
        })
        .catch(function (err) {
          setButtonLoading(registerBtn, false);
          showFormError(form, err.message || '注册失败，请重试');
        });
    });

    trapFocus(overlay);
    if (window.I18N) window.I18N.apply();
    return overlay;
  }

  function showLoginModal(options) {
    options = options || {};
    var overlay = createLoginModal();
    overlay._previousActiveElement = document.activeElement;
    overlay._onLogin = options.onLogin || null;

    var usernameInput = document.getElementById('auth-username');
    var passwordInput = document.getElementById('auth-password');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    clearFormError(document.getElementById('auth-login-form'));

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (usernameInput) setTimeout(function () { usernameInput.focus(); }, 50);
    if (window.I18N) window.I18N.apply();
  }

  function hideLoginModal() {
    var overlay = document.getElementById('chaos-login-modal');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    var previous = overlay._previousActiveElement;
    if (previous && typeof previous.focus === 'function') {
      setTimeout(function () { previous.focus(); }, 0);
    }
  }

  /* ══════════════════════════════════════
   * User menu (same DOM as original)
   * ══════════════════════════════════════ */

  function createUserMenu(container) {
    container.innerHTML = '';
    container.className = 'user-menu';

    var user = getCurrentUser();
    var buttonId = 'user-menu-trigger-' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    var dropdownId = 'user-dropdown-' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    var button = document.createElement('button');
    button.type = 'button';
    button.id = buttonId;
    button.className = 'user-menu-trigger';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', dropdownId);

    if (user) {
      button.innerHTML =
        '<span class="user-avatar">' + escapeHtml(getInitials(user.name)) + '</span>' +
        '<span class="user-name">' + escapeHtml(user.name) + '</span>' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    } else {
      button.innerHTML =
        '<span class="user-avatar user-avatar--guest">?</span>' +
        '<span class="user-name" data-i18n="authLogin">登录</span>' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    }

    var dropdown = document.createElement('div');
    dropdown.id = dropdownId;
    dropdown.className = 'user-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-labelledby', buttonId);

    if (user) {
      dropdown.innerHTML =
        '<a href="settings.html" class="user-dropdown-item" role="menuitem" tabindex="-1">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          '<span data-i18n="navSettings">设置</span>' +
        '</a>' +
        '<button type="button" class="user-dropdown-item" role="menuitem" tabindex="-1" data-auth-action="switch">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
          '<span data-i18n="authSwitchAccount">切换账户</span>' +
        '</button>' +
        '<button type="button" class="user-dropdown-item" role="menuitem" tabindex="-1" data-auth-action="logout">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
          '<span data-i18n="authLogout">注销</span>' +
        '</button>';
    } else {
      dropdown.innerHTML =
        '<button type="button" class="user-dropdown-item" role="menuitem" tabindex="-1" data-auth-action="login">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
          '<span data-i18n="authLogin">登录</span>' +
        '</button>';
    }

    container.appendChild(button);
    container.appendChild(dropdown);

    function getMenuItems() {
      return Array.from(dropdown.querySelectorAll('[role="menuitem"]'));
    }

    function toggle() {
      if (!dropdown.classList.contains('active')) openMenu();
      else closeMenu();
    }

    function openMenu() {
      dropdown.classList.add('active');
      button.setAttribute('aria-expanded', 'true');
      var items = getMenuItems();
      if (items[0]) items[0].focus();
    }

    function closeMenu(returnFocus) {
      dropdown.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus !== false) button.focus();
    }

    function focusItem(direction) {
      var items = getMenuItems();
      if (!items.length) return;
      var activeIndex = items.indexOf(document.activeElement);
      var nextIndex;
      if (direction === 'next') {
        nextIndex = activeIndex >= 0 && activeIndex < items.length - 1 ? activeIndex + 1 : 0;
      } else if (direction === 'prev') {
        nextIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
      } else if (direction === 'first') {
        nextIndex = 0;
      } else if (direction === 'last') {
        nextIndex = items.length - 1;
      }
      items[nextIndex].focus();
    }

    button.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });

    button.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openMenu();
        focusItem(e.key === 'ArrowDown' ? 'next' : 'prev');
      }
    });

    dropdown.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusItem('next'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem('prev'); }
      else if (e.key === 'Home') { e.preventDefault(); focusItem('first'); }
      else if (e.key === 'End') { e.preventDefault(); focusItem('last'); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      else if (e.key === 'Tab') { e.preventDefault(); focusItem(e.shiftKey ? 'prev' : 'next'); }
    });

    dropdown.querySelectorAll('[data-auth-action]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = el.getAttribute('data-auth-action');
        if (action === 'login' || action === 'switch') {
          closeMenu(false);
          showLoginModal({
            onLogin: function () {
              renderUserMenu(container);
            },
          });
        } else if (action === 'logout') {
          logout();
          closeMenu(false);
          window.location.href = 'index.html';
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) closeMenu(false);
    });

    if (window.I18N) window.I18N.apply();
  }

  function renderUserMenu(selector) {
    var container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!container) return;
    createUserMenu(container);
  }

  function init() {
    restoreFromToken();

    document.querySelectorAll('[data-auth-trigger="login"]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showLoginModal({ onLogin: function () { window.location.reload(); } });
      });
    });

    document.addEventListener('auth:changed', function () {
      document.querySelectorAll('.user-menu').forEach(function (menu) {
        createUserMenu(menu);
      });
    });
  }

  /* ── expose public API ── */

  window.Auth = {
    getCurrentUser: getCurrentUser,
    login: login,
    logout: logout,
    userKey: userKey,
    renderUserMenu: renderUserMenu,
    showLoginModal: showLoginModal,
    hideLoginModal: hideLoginModal,
    requireAuth: requireAuth,
    init: init,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: 语法检查**

```bash
node --check js/auth.js && echo "syntax ok"
```

预期：`syntax ok`

---

### Task 9: 验证 api.js 兼容性

**Covers:** S3

**Files:**
- Verify: `js/api.js:15-17`（configKey）, `js/api.js:284-286`（historyKeyPrefix）

- [ ] **Step 1: 确认 configKey 和 historyKeyPrefix 签名不变**

检查 `js/api.js` 中的 `configKey()` 函数（第 15-17 行）和 `historyKeyPrefix()` 函数（第 284-286 行）：

```js
function configKey() {
  return window.Auth ? window.Auth.userKey('config') : 'chaos_builder_config';
}

function historyKeyPrefix() {
  return window.Auth ? window.Auth.userKey('history:') : 'chaos_builder_history:';
}
```

这两个函数使用 `Auth.userKey(suffix)`，新 auth.js 保持了 `userKey()` 签名兼容：用户登录后返回 `'chaos_builder_u_' + user.id + ':' + suffix`。但注意 `user.id` 现在是后端 integer（如 `1`），旧版是字符串（如 `'u_lr4x2k_a1b2c3'`）。这会导致 localStorage key 不兼容——旧的用户数据（配置、历史）在新 auth 下不可见。

**这是预期行为**：后端用户 ID 是新的整数体系，旧 localStorage 数据无法迁移。

结论：**无需修改 api.js**。保持现有逻辑。

- [ ] **Step 2: 确认无需修改**

```bash
echo "api.js 无需修改 — configKey() 和 historyKeyPrefix() 通过 Auth.userKey() 保持兼容"
```

---

### Task 10: 端到端验证

**Covers:** S2, S3

- [ ] **Step 1: 启动后端**

```bash
cd chaosbuilder-server && node server.js &
sleep 2
```

- [ ] **Step 2: 测试注册**

```bash
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"123456"}' | python3 -m json.tool
```

预期：返回 `{ "token": "...", "user": { "id": 1, "username": "testuser" } }`

- [ ] **Step 3: 测试重复注册**

```bash
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"123456"}'
```

预期：返回 `{"error":"用户名已存在"}`，HTTP 409

- [ ] **Step 4: 测试登录**

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"123456"}' | python3 -m json.tool
```

预期：返回 `{ "token": "...", "user": { "id": 1, "username": "testuser" } }`

- [ ] **Step 5: 测试错误密码**

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"wrong"}'
```

预期：返回 `{"error":"用户名或密码错误"}`，HTTP 401

- [ ] **Step 6: 测试 /me（需提取 token）**

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"username":"testuser","password":"123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s http://localhost:3001/api/auth/me -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

预期：返回 `{ "user": { "id": 1, "username": "testuser" } }`

- [ ] **Step 7: 测试修改密码**

```bash
curl -s -X POST http://localhost:3001/api/auth/change-password \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"oldPassword":"123456","newPassword":"654321"}' | python3 -m json.tool
```

预期：返回 `{ "message": "密码修改成功" }`

- [ ] **Step 8: 验证新密码可用**

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"654321"}'
```

预期：返回 token（HTTP 200）

- [ ] **Step 9: 无 token 访问 /me**

```bash
curl -s http://localhost:3001/api/auth/me
```

预期：返回 `{"error":"缺少认证令牌"}`，HTTP 401

- [ ] **Step 10: 清理**

```bash
kill $(lsof -ti:3001) 2>/dev/null || true
rm -f chaosbuilder-server/chaosbuilder.db
```
