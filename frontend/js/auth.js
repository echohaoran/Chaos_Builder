/* CHAOS_AUTH_VERSION: v3-2026-06-17-fix-catch-display */
/**
 * Chaos_Builder user authentication layer.
 * Uses backend JWT authentication (server at port 3001).
 * Falls back to local-only mode if server is unavailable.
 */

const AUTH_TOKEN_KEY = 'chaos_builder_token';
const AUTH_CURRENT_USER_KEY = 'chaos_builder_current_user';
const USERNAME_MAX_LENGTH = 32;

function getAuthServerUrl() {
  if (window.ChaosAPI && window.ChaosAPI.AUTH_SERVER_URL) return window.ChaosAPI.AUTH_SERVER_URL;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  return window.location.origin;
}

function getToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch (e) { return null; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (e) {}
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(AUTH_CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setCurrentUser(user) {
  try {
    if (user) localStorage.setItem(AUTH_CURRENT_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_CURRENT_USER_KEY);
  } catch (e) {}
}

function sanitizeUsername(name) {
  return (name || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, USERNAME_MAX_LENGTH);
}

function validateUsername(name) {
  const value = sanitizeUsername(name);
  if (!value) return { valid: false, error: 'authErrorEmptyUsername' };
  if (value.length > USERNAME_MAX_LENGTH) return { valid: false, error: 'authErrorUsernameTooLong' };
  return { valid: true, value: value };
}

async function fetchCaptcha() {
  // 验证码已移除,返回空占位
  return { id: '', svg: '' };
}

async function apiRegister(username, password) {
  const res = await fetch(getAuthServerUrl() + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await res.text();
  if (!res.ok) {
    try { var d = JSON.parse(text); throw new Error(d.error || 'Registration failed'); }
    catch (e) { if (e instanceof SyntaxError) throw new Error('后端服务异常 (HTTP ' + res.status + ')，请确认后端已重启'); throw e; }
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('后端返回异常数据'); }
}

async function apiLogin(username, password) {
  const res = await fetch(getAuthServerUrl() + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await res.text();
  if (!res.ok) {
    try { var d = JSON.parse(text); throw new Error(d.error || 'Login failed'); }
    catch (e) { if (e instanceof SyntaxError) throw new Error('后端服务异常 (HTTP ' + res.status + ')，请确认后端已重启'); throw e; }
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('后端返回异常数据'); }
}

async function apiGetMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(getAuthServerUrl() + '/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { setToken(null); setCurrentUser(null); return null; }
    const data = await res.json();
    return data.user;
  } catch (e) { return getCurrentUser(); }
}

async function login(username, password) {
  const data = await apiLogin(username, password);
  setToken(data.token);
  setCurrentUser(data.user);
  // 登录成功后从服务器拉历史/设置/预设,让数据跟随账户
  if (window.ChaosAPI && typeof window.ChaosAPI.syncFromServer === 'function') {
    window.ChaosAPI.syncFromServer().catch(function (e) { console.warn('sync after login:', e); });
  }
  return data.user;
}

async function register(username, password) {
  const data = await apiRegister(username, password);
  setToken(data.token);
  setCurrentUser(data.user);
  if (window.ChaosAPI && typeof window.ChaosAPI.syncFromServer === 'function') {
    window.ChaosAPI.syncFromServer().catch(function (e) { console.warn('sync after register:', e); });
  }
  return data.user;
}

async function registerEmail(username, password, email, code) {
  const data = await apiRegisterEmail(username, password, email, code);
  setToken(data.token);
  setCurrentUser(data.user);
  if (window.ChaosAPI && typeof window.ChaosAPI.syncFromServer === 'function') {
    window.ChaosAPI.syncFromServer().catch(function (e) { console.warn('sync after email register:', e); });
  }
  return data.user;
}

// ─── Email registration ─────────────────────────────────
async function apiSendCode(email) {
  const res = await fetch(getAuthServerUrl() + '/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const text = await res.text();
  if (!res.ok) {
    try { var d = JSON.parse(text); throw new Error(d.error || 'Failed to send code'); }
    catch (e) { if (e instanceof SyntaxError) throw new Error('后端服务异常 (HTTP ' + res.status + ')，请确认后端已重启'); throw e; }
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('后端返回异常数据'); }
}

async function apiRegisterEmail(username, password, email, code) {
  const res = await fetch(getAuthServerUrl() + '/api/auth/register-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email, code })
  });
  const text = await res.text();
  if (!res.ok) {
    try { var d = JSON.parse(text); throw new Error(d.error || 'Registration failed'); }
    catch (e) { if (e instanceof SyntaxError) throw new Error('后端服务异常 (HTTP ' + res.status + ')，请确认后端已重启'); throw e; }
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('后端返回异常数据'); }
}

function logout() {
  setToken(null);
  setCurrentUser(null);
}

function userKey(suffix) {
  const user = getCurrentUser();
  if (!user) return 'chaos_builder_guest:' + suffix;
  return 'chaos_builder_u_' + user.id + ':' + suffix;
}

const LOGIN_REQUIRED = true;

function requireAuth() {
  if (!LOGIN_REQUIRED) return;
  const path = window.location.pathname || '';
  const file = path.split('/').pop() || 'index.html';
  const publicPages = ['index.html', 'landing.html'];
  if (publicPages.indexOf(file) !== -1) return;
  if (!getCurrentUser()) {
    window.location.href = 'index.html';
  }
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function translate(key, fallback) {
  if (window.I18N && window.I18N.t) return window.I18N.t(key, fallback);
  return fallback || key;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function dispatchChanged(reason) {
  document.dispatchEvent(new CustomEvent('auth:changed', {
    detail: { user: getCurrentUser(), reason: reason || 'change' }
  }));
}

/* ────────────────────────────────
 * Login modal
 * ──────────────────────────────── */

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
    const focusables = getFocusableElements(overlay);
    if (!focusables.length) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
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
  let error = form.querySelector('.auth-form-error');
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
  const error = form.querySelector('.auth-form-error');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
}

function createLoginModal() {
  let overlay = document.getElementById('chaos-login-modal');
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
      '<div class="auth-tabs" style="display:flex;gap:0;margin-bottom:var(--space-5);border-bottom:1px solid var(--border);">' +
        '<button type="button" class="auth-tab active" data-tab="login" style="flex:1;padding:var(--space-2) var(--space-4);border:none;background:transparent;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--accent);border-bottom:2px solid var(--accent);transition:all 0.15s;">账号密码</button>' +
        '<button type="button" class="auth-tab" data-tab="email" style="flex:1;padding:var(--space-2) var(--space-4);border:none;background:transparent;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--muted);border-bottom:2px solid transparent;transition:all 0.15s;">邮箱注册</button>' +
      '</div>' +
      '<h2 id="auth-modal-heading" class="auth-modal-title" data-i18n="authLoginTitle">登录</h2>' +
      '<form class="auth-form" id="auth-login-form" novalidate>' +
        '<div class="field">' +
          '<label for="auth-username" data-i18n="authUsernameLabel">用户名</label>' +
          '<input type="text" id="auth-username" name="username" autocomplete="username" maxlength="' + USERNAME_MAX_LENGTH + '" placeholder="输入用户名" />' +
        '</div>' +
        '<div class="field">' +
          '<label for="auth-password" data-i18n="authPasswordLabel">密码</label>' +
          '<input type="password" id="auth-password" name="password" autocomplete="current-password" minlength="6" placeholder="输入密码（至少6位）" />' +
        '</div>' +
        '<div class="field" id="email-field" style="display:none;">' +
          '<label for="auth-email">邮箱</label>' +
          '<div style="display:flex;gap:var(--space-2);">' +
            '<input type="email" id="auth-email" name="email" placeholder="your@email.com" style="flex:1;padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-sm);background:var(--bg);color:var(--text);" />' +
            '<button type="button" class="btn btn-secondary btn-sm" id="send-code-btn" style="white-space:nowrap;">发送验证码</button>' +
          '</div>' +
        '</div>' +
        '<div class="field" id="code-field" style="display:none;">' +
          '<label for="auth-code">验证码</label>' +
          '<input type="text" id="auth-code" name="code" maxlength="6" placeholder="输入6位验证码" style="width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-sm);background:var(--bg);color:var(--text);" />' +
        '</div>' +
        '<button type="submit" class="btn btn-primary" id="auth-submit-btn" data-i18n="authLoginBtn">登录 / 注册</button>' +
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

  // Tab switching
  var tabs = overlay.querySelectorAll('.auth-tab');
  var emailField = document.getElementById('email-field');
  var codeField = document.getElementById('code-field');
  var submitBtn = document.getElementById('auth-submit-btn');
  var titleEl = overlay.querySelector('.auth-modal-title');
  tabs.forEach(function(t) {
    t.addEventListener('click', function() {
      var isEmail = t.dataset.tab === 'email';
      tabs.forEach(function(x) {
        x.style.color = x === t ? 'var(--accent)' : 'var(--muted)';
        x.style.borderBottomColor = x === t ? 'var(--accent)' : 'transparent';
      });
      emailField.style.display = isEmail ? '' : 'none';
      codeField.style.display = isEmail ? '' : 'none';
      titleEl.textContent = isEmail ? '邮箱注册' : '登录';
      submitBtn.textContent = isEmail ? '注册' : '登录 / 注册';
    });
  });

  // Send verification code
  var sendCodeBtn = document.getElementById('send-code-btn');
  var codeTimer = null;
  sendCodeBtn.addEventListener('click', async function() {
    var email = document.getElementById('auth-email').value.trim();
    if (!email || !email.includes('@')) { showFormError(form, '请输入有效的邮箱地址'); return; }
    sendCodeBtn.disabled = true;
    sendCodeBtn.textContent = '发送中…';
    try {
      await apiSendCode(email);
      var countdown = 60;
      sendCodeBtn.textContent = countdown + 's';
      codeTimer = setInterval(function() {
        countdown--;
        if (countdown <= 0) { clearInterval(codeTimer); sendCodeBtn.disabled = false; sendCodeBtn.textContent = '重新发送'; }
        else { sendCodeBtn.textContent = countdown + 's'; }
      }, 1000);
    } catch (err) {
      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = '发送验证码';
      showFormError(form, err.message || '发送失败');
    }
  });

  var form = document.getElementById('auth-login-form');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFormError(form);
    var input = document.getElementById('auth-username');
    var passwordInput = document.getElementById('auth-password');
    var rawName = input.value;
    var password = passwordInput.value;
    var validation = validateUsername(rawName);
    if (!validation.valid) { showFormError(form, validation.error); input.focus(); return; }
    if (!password || password.length < 6) { showFormError(form, '密码至少需要6个字符'); passwordInput.focus(); return; }

    var isEmailMode = document.getElementById('email-field').style.display !== 'none';
    if (isEmailMode) {
      var email = document.getElementById('auth-email').value.trim();
      var code = document.getElementById('auth-code').value.trim();
      if (!email || !email.includes('@')) { showFormError(form, '请输入有效的邮箱地址'); return; }
      if (!code || code.length !== 6) { showFormError(form, '请输入6位验证码'); return; }
      setButtonLoading(submitBtn, true);
      try {
        var user = await registerEmail(validation.value, password, email, code);
        setButtonLoading(submitBtn, false);
        hideLoginModal();
        if (typeof overlay._onLogin === 'function') overlay._onLogin(user);
        dispatchChanged('login');
      } catch (err) {
        setButtonLoading(submitBtn, false);
        showFormError(form, err.message || '注册失败');
      }
      return;
    }

    setButtonLoading(submitBtn, true);
    try {
      let user;
      try {
        user = await login(validation.value, password);
      } catch (loginErr) {
        if (loginErr.message && loginErr.message.includes('Invalid username or password')) {
          try {
            user = await register(validation.value, password);
          } catch (regErr) {
            if (regErr.message && regErr.message.includes('already taken')) {
              throw new Error(translate('authErrorWrongPassword', '密码错误'));
            }
            throw regErr;
          }
        } else {
          throw loginErr;
        }
      }
      setButtonLoading(submitBtn, false);
      hideLoginModal();
      if (typeof overlay._onLogin === 'function') overlay._onLogin(user);
      dispatchChanged('login');
    } catch (err) {
      setButtonLoading(submitBtn, false);
      showFormError(form, err.message || '登录失败，请重试');
    }
  });

  trapFocus(overlay);

  if (window.I18N) window.I18N.apply();
  return overlay;
}


function showLoginModal(options) {
  options = options || {};
  const overlay = createLoginModal();
  overlay._previousActiveElement = document.activeElement;
  overlay._onLogin = options.onLogin || null;

  const input = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  if (input) {
    input.value = '';
    clearFormError(document.getElementById('auth-login-form'));
  }
  if (passwordInput) passwordInput.value = '';

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  if (input) setTimeout(function () { input.focus(); }, 50);
  if (window.I18N) window.I18N.apply();
}

function hideLoginModal() {
  const overlay = document.getElementById('chaos-login-modal');
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  const previous = overlay._previousActiveElement;
  if (previous && typeof previous.focus === 'function') {
    setTimeout(function () { previous.focus(); }, 0);
  }
}

/* ────────────────────────────────
 * User menu
 * ──────────────────────────────── */

function createUserMenu(container) {
  container.innerHTML = '';
  container.className = 'user-menu';

  const user = getCurrentUser();
  const buttonId = 'user-menu-trigger-' + generateId();
  const dropdownId = 'user-dropdown-' + generateId();

  const button = document.createElement('button');
  button.type = 'button';
  button.id = buttonId;
  button.className = 'user-menu-trigger';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', dropdownId);

  if (user) {
    button.innerHTML =
      '<span class="user-avatar">' + escapeHtml(getInitials(user.username)) + '</span>' +
      '<span class="user-name">' + escapeHtml(user.username) + '</span>' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  } else {
    button.innerHTML =
      '<span class="user-avatar user-avatar--guest">?</span>' +
      '<span class="user-name" data-i18n="authLogin">登录</span>' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  }

  const dropdown = document.createElement('div');
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
    const willOpen = !dropdown.classList.contains('active');
    if (willOpen) openMenu();
    else closeMenu();
  }

  function openMenu() {
    dropdown.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
    const items = getMenuItems();
    if (items[0]) items[0].focus();
  }

  function closeMenu(returnFocus) {
    dropdown.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus !== false) button.focus();
  }

  function focusItem(direction) {
    const items = getMenuItems();
    if (!items.length) return;
    const activeIndex = items.indexOf(document.activeElement);
    let nextIndex;
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem('next');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem('prev');
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem('first');
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem('last');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      focusItem(e.shiftKey ? 'prev' : 'next');
    }
  });

  dropdown.querySelectorAll('[data-auth-action]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      const action = el.getAttribute('data-auth-action');
      if (action === 'login' || action === 'switch') {
        closeMenu(false);
        showLoginModal({
          onLogin: function () {
            renderUserMenu(container);
          }
        });
      } else if (action === 'logout') {
        logout();
        dispatchChanged('logout');
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
  const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!container) return;
  createUserMenu(container);
}

function init() {
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

  if (getToken()) {
    apiGetMe().then(function (user) {
      if (user) setCurrentUser(user);
      else dispatchChanged('logout');
    });
  }
}

window.Auth = {
  getCurrentUser: getCurrentUser,
  getToken: getToken,
  login: login,
  register: register,
  registerEmail: registerEmail,
  sendCode: apiSendCode,
  registerEmail: apiRegisterEmail,
  logout: logout,
  switchUser: showLoginModal,
  requireAuth: requireAuth,
  userKey: userKey,
  renderUserMenu: renderUserMenu,
  showLoginModal: showLoginModal,
  hideLoginModal: hideLoginModal,
  apiGetMe: apiGetMe,
  init: init,
  isAdmin: function() {
    var user = getCurrentUser();
    return user && user.role === 'admin';
  },
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
