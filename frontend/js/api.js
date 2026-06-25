/**
 * Chaos_Builder API client
 * Reads backend config from localStorage (set in settings.html) and
 * provides helpers for text-to-image, image-to-image, and multi-image edits.
 *
 * Multi-provider: each provider adapts the request to its own protocol.
 *   ppio  — OpenAI-compatible, two endpoints (generations + edits multipart)
 *   agnes — Unified /v1/images/generations with extra_body.image / response_format
 *
 * Selected via config.provider (default: 'ppio').
 * Optional header: Authorization: Bearer <apiKey>.
 */

function configKey() {
  return window.Auth ? window.Auth.userKey('config') : 'chaos_builder_config';
}

const DEFAULT_CONFIG = {
  provider: 'agnes',
  // 顶层保留作为兑底/向后兼容老格式 localStorage
  apiBaseUrl: 'https://api.ppio.com',
  apiKey: '',
  model: 'gpt-image-2',
  defaultSize: '1024x1024',
  defaultQuality: 'hd',
  defaultOrientation: 'square',
  // 各供应商独立的 API 配置
  ppio:     { apiBaseUrl: 'https://api.ppio.com/openai',                       apiKey: '', model: 'gpt-image-2' },
  agnes:    { apiBaseUrl: 'https://apihub.agnes-ai.com',              apiKey: '', model: 'agnes-image-2.1-flash' },
  openai:   { apiBaseUrl: 'https://api.openai.com/v1',                apiKey: '', model: 'gpt-image-1' },
  anthropic:{ apiBaseUrl: 'https://api.anthropic.com/v1',            apiKey: '', model: 'claude-3-5-sonnet' },
  seedream: { apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',  apiKey: '', model: 'doubao-seedream-3-0-t2i-250415' },
  banana:   { apiBaseUrl: 'http://localhost:8000',                    apiKey: '', model: 'workflow-default' },
  comfy:    { apiBaseUrl: 'http://127.0.0.1:8000',                    apiKey: '', model: 'sdxl-base' },
  sd:       { apiBaseUrl: 'http://127.0.0.1:7860',                    apiKey: '', model: 'sdxl_base' },
};

// Provider adapters — each one knows its own URL, default model, and how to
// turn a normalized (prompt + options) request into an actual HTTP request.
// ────────── 工厂:OpenAI Images 兼容协议 ──────────
// 几乎所有现代生图服务都支持 OpenAI Images API(/v1/images/generations + /v1/images/edits)
// 工厂生成统一 adapter,差异化在 baseURL / model / apiKeyHint
function openaiCompatibleProvider(meta) {
  return {
    label: meta.label,
    apiBaseUrl: meta.apiBaseUrl,
    defaultModel: meta.defaultModel,
    apiKeyHint: meta.apiKeyHint,
    buildGenerationRequest({ config, prompt, payload }) {
      return {
        url: buildUrl(config, '/v1/images/generations'),
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildHeaders(config)),
        body: JSON.stringify(Object.assign({}, payload, { prompt })),
      };
    },
    buildEditRequest({ config, imageFiles, prompt, payload, options, hasMask }) {
      const form = new FormData();
      imageFiles.forEach(function (f) { form.append('image', f); });
      form.append('prompt', prompt);
      form.append('size', payload.size);
      if (payload.quality) form.append('quality', payload.quality);
      form.append('response_format', 'url');
      if (hasMask && options && options.mask) form.append('mask', options.mask);
      return {
        url: buildUrl(config, '/v1/images/edits'),
        method: 'POST',
        headers: buildHeaders(config),
        body: form,
      };
    },
  };
}

const PROVIDERS = {
  agnes: {
    label: 'Agnes Image (apihub)',
    apiBaseUrl: 'https://apihub.agnes-ai.com',
    defaultModel: 'agnes-image-2.1-flash',
    apiKeyHint: 'Agnes API Key (必填)',
    buildGenerationRequest({ config, prompt, payload }) {
      const body = {
        model: payload.model,
        prompt,
        size: payload.size,
        extra_body: { response_format: 'url' },
      };
      return {
        url: buildUrl(config, '/v1/images/generations'),
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildHeaders(config)),
        body: JSON.stringify(body),
      };
    },
    async buildEditRequest({ config, imageFiles, prompt, payload }) {
      const imageArray = await Promise.all(imageFiles.map(fileToDataURI));
      const body = {
        model: payload.model,
        prompt,
        size: payload.size,
        extra_body: { image: imageArray, response_format: 'url' },
      };
      return {
        url: buildUrl(config, '/v1/images/generations'),
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildHeaders(config)),
        body: JSON.stringify(body),
      };
    },
  },
};

function getProvider(config) {
  const key = (config && config.provider) || DEFAULT_CONFIG.provider;
  // 先查内置 PROVIDERS,再查用户自定义
  if (PROVIDERS[key]) return PROVIDERS[key];
  const custom = loadCustomProviders();
  if (custom[key]) return custom[key];
  return PROVIDERS[DEFAULT_CONFIG.provider];
}

// ── 用户自定义供应商 ──
var CUSTOM_PROVIDERS_KEY = 'chaos_builder_custom_providers';

function loadCustomProviders() {
  try {
    var raw = localStorage.getItem(CUSTOM_PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

var HIDDEN_PROVIDERS_KEY = 'chaos_builder_hidden_providers';

function loadHiddenProviders() {
  try {
    var raw = localStorage.getItem(HIDDEN_PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveHiddenProviders(list) {
  localStorage.setItem(HIDDEN_PROVIDERS_KEY, JSON.stringify(list));
  emitConfigChange(getConfig());
}

function hideProvider(id) {
  var list = loadHiddenProviders();
  if (list.indexOf(id) === -1) list.push(id);
  saveHiddenProviders(list);
}

function unhideProvider(id) {
  var list = loadHiddenProviders();
  var idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1);
  saveHiddenProviders(list);
}

function saveCustomProviders(providers) {
  localStorage.setItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(providers));
  // 触发 config 变更以刷新 UI
  emitConfigChange(getConfig());
}

function addCustomProvider(id, meta) {
  var custom = loadCustomProviders();
  var provider = openaiCompatibleProvider({
    label: meta.label || id,
    apiBaseUrl: meta.apiBaseUrl || '',
    defaultModel: meta.model || '',
    apiKeyHint: meta.apiKeyHint || 'API Key',
  });
  // 保留添加时的信息,供切换供应商时自动填充表单
  provider._savedMeta = {
    apiKey: meta.apiKey || '',
    apiBaseUrl: meta.apiBaseUrl || '',
    model: meta.model || '',
  };
  custom[id] = provider;
  saveCustomProviders(custom);
}

function removeCustomProvider(id) {
  var custom = loadCustomProviders();
  delete custom[id];
  saveCustomProviders(custom);
}

function fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

const AUTH_SERVER_URL = (function() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  return window.location.origin;
})();

const SIZE_OPTIONS = [
  { value: '1024x1024', orientation: 'square', label: '1024 × 1024' },
  { value: '2048x2048', orientation: 'square', label: '2048 × 2048' },
  { value: '1536x1024', orientation: 'landscape', label: '1536 × 1024' },
  { value: '2048x1536', orientation: 'landscape', label: '2048 × 1536' },
  { value: '2048x1152', orientation: 'landscape', label: '2048 × 1152' },
  { value: '1024x1536', orientation: 'portrait', label: '1024 × 1536' },
  { value: '1536x2048', orientation: 'portrait', label: '1536 × 2048' },
  { value: '1152x2048', orientation: 'portrait', label: '1152 × 2048' },
];

function getSizesByOrientation(orientation) {
  return SIZE_OPTIONS.filter((opt) => opt.orientation === orientation);
}

function getDefaultSizeForOrientation(orientation) {
  const map = {
    square: '1024x1024',
    landscape: '1536x1024',
    portrait: '1024x1536',
  };
  return map[orientation] || map.square;
}

function flipOrientation(size) {
  const [w, h] = size.split('x').map(Number);
  if (w === h) return size;
  return `${h}x${w}`;
}

function getOrientationFromSize(size) {
  const [w, h] = size.split('x').map(Number);
  if (w === h) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

function getConfig() {
  try {
    const saved = localStorage.getItem(configKey());
    return Object.assign({}, DEFAULT_CONFIG, saved ? JSON.parse(saved) : {});
  } catch (e) {
    console.warn('Failed to read Chaos_Builder config:', e);
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig(config) {
  const cur = getConfig();
  const next = Object.assign({}, cur, config);
  // 表单字段(apiBaseUrl/apiKey/model)分流到 next[next.provider] 子对象
  if ('apiBaseUrl' in config || 'apiKey' in config || 'model' in config) {
    const slotKey = next.provider || DEFAULT_CONFIG.provider;
    next[slotKey] = Object.assign({}, cur[slotKey] || {}, next[slotKey] || {});
    if ('apiBaseUrl' in config) next[slotKey].apiBaseUrl = config.apiBaseUrl;
    if ('apiKey' in config) next[slotKey].apiKey = config.apiKey;
    if ('model' in config) next[slotKey].model = config.model;
  }
  localStorage.setItem(configKey(), JSON.stringify(next));
  emitConfigChange(next);
  // 已登录时,异步推送到服务器,让设置跟随账户
  const token = getAuthToken();
  if (token && typeof saveServerSettings === 'function') {
    saveServerSettings(next).catch(function (e) {
      console.warn('Failed to sync settings to server:', e);
    });
  }
  return next;
}

function resetConfig() {
  localStorage.removeItem(configKey());
  emitConfigChange(getConfig());
}

// ────────── provider / config 变更广播 ──────────
// 其他页面订阅后可以实时刷新 "当前供应商" 指示等 UI。
const _configListeners = [];
function onConfigChange(fn) {
  _configListeners.push(fn);
  return function unsubscribe() {
    const i = _configListeners.indexOf(fn);
    if (i >= 0) _configListeners.splice(i, 1);
  };
}
function emitConfigChange(config) {
  _configListeners.forEach(function (fn) {
    try { fn(config); } catch (e) { console.warn('config listener error:', e); }
  });
}

// 取当前供应商的可读信息(用于页面顶部指示条)
function getCurrentProviderInfo() {
  const cfg = getConfig();
  const meta = PROVIDERS[cfg.provider] || PROVIDERS[DEFAULT_CONFIG.provider];
  const slot = providerConfig(cfg);
  return {
    key: cfg.provider || DEFAULT_CONFIG.provider,
    label: meta.label,
    model: slot.model,
    apiBaseUrl: slot.apiBaseUrl,
  };
}

// ────────── 跨设备同步:登录后从服务器拉取历史/设置/预设到 localStorage ──────────
async function syncFromServer() {
  const token = getAuthToken();
  if (!token) return { ok: false, reason: 'no-token' };

  // 1. settings → localStorage(服务器值覆盖本地,但保留本地未在服务器里的字段)
  try {
    const serverSettings = await fetchServerSettings();
    if (serverSettings && typeof serverSettings === 'object') {
      const current = getConfig();
      saveConfig(Object.assign({}, current, serverSettings));
    }
  } catch (e) { console.warn('syncFromServer settings:', e); }

  // 2. history → localStorage(按 mode 分桶)
  try {
    const serverHistory = await fetchServerHistory({ limit: 200 });
    if (serverHistory && Array.isArray(serverHistory.items)) {
      const buckets = { 'text': [], 'image': [], 'multi': [], 'preset': [] };
      serverHistory.items.forEach(function (item) {
        const mode = (item.mode && buckets.hasOwnProperty(item.mode)) ? item.mode : 'text';
        const url = (item.image_urls && item.image_urls[0]) || '';
        buckets[mode].push({
          id: item.id,
          url: url,
          prompt: item.prompt,
          model: item.model,
          size: item.size,
          quality: item.quality,
          n: item.n,
          createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
        });
      });
      Object.keys(buckets).forEach(function (mode) {
        if (buckets[mode].length) {
          try { localStorage.setItem(historyKey(mode), JSON.stringify(buckets[mode].slice(0, MAX_HISTORY))); } catch (e) {}
        }
      });
    }
  } catch (e) { console.warn('syncFromServer history:', e); }

  // 3. presets → localStorage
  try {
    const serverPresets = await fetchServerPresets();
    if (serverPresets && Array.isArray(serverPresets.items)) {
      try { localStorage.setItem('chaos_builder_presets', JSON.stringify(serverPresets.items)); } catch (e) {}
    }
  } catch (e) { console.warn('syncFromServer presets:', e); }

  // 通知所有订阅者重新渲染
  emitConfigChange(getConfig());
  emitDataChange();
  return { ok: true };
}

const _dataChangeListeners = [];
function onDataChange(fn) {
  _dataChangeListeners.push(fn);
  return function unsubscribe() {
    const i = _dataChangeListeners.indexOf(fn);
    if (i >= 0) _dataChangeListeners.splice(i, 1);
  };
}
function emitDataChange() {
  _dataChangeListeners.forEach(function (fn) {
    try { fn(); } catch (e) { console.warn('data-change listener error:', e); }
  });
}

function buildUrl(config, path) {
  const base = (providerConfig(config).apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl).replace(/\/$/, '');
  return `${base}${path}`;
}

function buildHeaders(config) {
  const headers = {};
  const key = providerConfig(config).apiKey;
  if (key && key.trim()) {
    headers['Authorization'] = `Bearer ${key.trim()}`;
  }
  return headers;
}

// 读取当前供应商的独立 API 配置(未配置时 fallback 到顶层 / PROVIDER 默认)
function providerConfig(config) {
  const cfg = config || {};
  const key = cfg.provider || DEFAULT_CONFIG.provider;
  const slot = cfg[key] || {};
  const meta = PROVIDERS[key] || PROVIDERS[DEFAULT_CONFIG.provider];
  return {
    apiBaseUrl: slot.apiBaseUrl || cfg.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl,
    apiKey: slot.apiKey !== undefined ? slot.apiKey : (cfg.apiKey || ''),
    model: slot.model || cfg.model || (meta && meta.defaultModel) || DEFAULT_CONFIG.model,
  };
}

function normalizePayload(config, options) {
  let size = options.size || config.defaultSize || DEFAULT_CONFIG.defaultSize;
  if (options.orientation && options.orientation !== 'square') {
    const target = getOrientationFromSize(size) === options.orientation ? size : flipOrientation(size);
    if (SIZE_OPTIONS.some((opt) => opt.value === target)) {
      size = target;
    }
  }
  return {
    model: options.model || providerConfig(config).model,
    n: Math.max(1, Math.min(10, Number(options.n) || 1)),
    size,
    quality: options.quality || config.defaultQuality || DEFAULT_CONFIG.defaultQuality,
    response_format: 'url',
  };
}

// PPIO 专用:把通用 payload 映射成 PPIO 文档要求的 body
//   - quality: 'standard' → 'medium', 'hd' → 'high'(PPIO 用 low/medium/high)
//   - 去掉 response_format(PPIO 不支持,只输出 url)
//   - model 保留(用于 PPIO 路由,但 PPIO v3 端点忽略 model 字段)
function ppioNormalizeBody(prompt, payload, isEdit) {
  const qualityMap = { low: 'low', medium: 'medium', high: 'high', standard: 'medium', hd: 'high' };
  const quality = qualityMap[payload.quality] || 'high';
  const body = {
    prompt: prompt,
    n: payload.n || 1,
  };
  if (payload.size) body.size = payload.size;
  body.quality = quality;
  // PPIO 支持 background / output_format,可按需开启
  // body.background = 'auto';
  // body.output_format = 'png';
  return body;
}

async function parseResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const err = new Error(`服务器返回了非 JSON 响应:${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const message = data && (data.error?.message || data.message || data.detail)
      ? (data.error?.message || data.message || data.detail)
      : `请求失败(HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  // PPIO 协议适配:返回 {images: [url1, ...]} → 统一成 {data: [{url}, ...]}
  // 上层(resultToImageUrl / 错误弹窗)依赖 OpenAI 风格的 data 数组
  if (data && Array.isArray(data.images) && !Array.isArray(data.data)) {
    return { data: data.images.map(function (u) { return { url: u }; }) };
  }
  return data;
}

// ────────── 错误分类 + 弹窗 ──────────
const ERR_CODES = {
  network:    { severity: 'warn' },
  timeout:    { severity: 'warn' },
  auth:       { severity: 'error' },
  quota:      { severity: 'error' },
  rate_limit: { severity: 'warn' },
  server:     { severity: 'error' },
  bad_request:{ severity: 'error' },
  unknown:    { severity: 'error' },
};

function classifyError(err) {
  if (!err) return new Error('未知错误');
  if (err.code && ERR_CODES[err.code]) return err;  // 已是 ImageGenError

  // 1. 超时(浏览器 fetch 默认无超时,这里靠上层 AbortController,常见于 AbortError)
  if (err.name === 'AbortError') {
    return makeGenError('timeout', '请求超时', '网络连接超时,检查网络状况后重试。');
  }

  // 2. 网络层错误(无法连接到服务器)
  const msg = String(err.message || '');
  if (/Failed to fetch|NetworkError|network failed|Load failed/i.test(msg)) {
    return makeGenError('network', '无法连接 API 服务器', [
      '可能原因:',
      '1. API 地址不正确(在设置页检查 URL)',
      '2. API 服务未启动(后端 8766 进程是否在跑)',
      '3. 网络连接问题(防火墙/代理/VPN)',
    ].join('\n'));
  }

  // 3. HTTP 状态码分类
  const status = err.status;
  if (status === 401 || status === 403) {
    return makeGenError('auth', 'API Key 无效或已过期', '在 设置 页检查 API Key 是否正确,或重新生成 Key。');
  }
  if (status === 402 || /balance|quota|insufficient|credit|payment|billing/i.test(msg)) {
    return makeGenError('quota', 'API 余额不足', [
      '供应商账户已欠费或余额耗尽。',
      '请前往供应商后台充值后再试。',
    ].join('\n'));
  }
  if (status === 429) {
    return makeGenError('rate_limit', '请求过于频繁', '触发了供应商的速率限制,稍候 5-10 秒再试。');
  }
  if (status >= 500 && status < 600) {
    return makeGenError('server', 'API 服务器内部错误', '供应商服务端出错,稍后重试,或联系供应商。');
  }
  if (status === 400) {
    return makeGenError('bad_request', '请求参数错误', '提示词或参数不合法,检查后重试。\n详情:' + msg);
  }

  // 4. 兜底
  return makeGenError('unknown', err.message || '生图失败', '查看浏览器控制台(F12 → Console)获取详细错误。');
}

function makeGenError(code, title, hint) {
  const err = new Error(title);
  err.code = code;
  err.title = title;
  err.hint = hint;
  return err;
}

// 弹窗显示错误(全局,任何页面都能调)
function showErrorModal(err) {
  const classified = classifyError(err);
  const t = function (k, fb) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : fb; };
  const tpl = {
    network: {
      icon: '⚠',
      title: classified.title,
      detail: t('errNetworkDetail', '无法连接到上游 API 服务器。请检查网络、API 地址是否正确,以及 API 服务是否在运行。'),
      hint: classified.hint,
    },
    timeout: {
      icon: '⏱',
      title: classified.title,
      detail: t('errTimeoutDetail', '请求等待响应超时。'),
      hint: classified.hint,
    },
    auth: {
      icon: '🔑',
      title: classified.title,
      detail: t('errAuthDetail', '供应商拒绝了 API Key,可能已过期、复制时丢失了字符,或 Key 没有对应模型的权限。'),
      hint: classified.hint,
    },
    quota: {
      icon: '💳',
      title: classified.title,
      detail: t('errQuotaDetail', '账户余额 / 配额已用完,无法继续生成。'),
      hint: classified.hint,
    },
    rate_limit: {
      icon: '⏸',
      title: classified.title,
      detail: t('errRateLimitDetail', '短时间内发送了太多请求。'),
      hint: classified.hint,
    },
    server: {
      icon: '🛠',
      title: classified.title,
      detail: t('errServerDetail', '供应商服务端出错(5xx)。这不是你的问题。'),
      hint: classified.hint,
    },
    bad_request: {
      icon: '✕',
      title: classified.title,
      detail: classified.hint || t('errBadRequestDetail', '请求参数不合法。'),
      hint: t('errBadRequestHint', '修改提示词或参数后重试。'),
    },
    unknown: {
      icon: '✕',
      title: classified.title || t('statusError', '生图失败'),
      detail: t('errUnknownDetail', '未识别的错误类型。'),
      hint: classified.hint,
    },
  };
  const m = tpl[classified.code] || tpl.unknown;

  // 移除已存在的
  const existing = document.getElementById('chaos-error-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'error-modal-overlay';
  overlay.id = 'chaos-error-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML =
    '<div class="error-modal" data-code="' + classified.code + '">' +
      '<div class="error-modal-icon">' + m.icon + '</div>' +
      '<h3 class="error-modal-title">' + escapeHtml(m.title) + '</h3>' +
      '<p class="error-modal-detail">' + escapeHtml(m.detail).replace(/\n/g, '<br>') + '</p>' +
      '<p class="error-modal-hint">' + escapeHtml(m.hint || '').replace(/\n/g, '<br>') + '</p>' +
      (classified.message ? '<details class="error-modal-raw"><summary>' + escapeHtml(t('errRawDetails', '技术详情')) + '</summary><pre>' + escapeHtml(classified.message) + '</pre></details>' : '') +
      '<div class="error-modal-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="close">' + escapeHtml(t('actionClose', '关闭')) + '</button>' +
        '<a class="btn btn-primary" data-action="settings" href="settings.html">' + escapeHtml(t('errorGoSettings', '前往设置')) + '</a>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.body.style.overflow = ''; }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  document.body.style.overflow = 'hidden';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Test whether the configured backend is reachable.
 * Returns { ok, status, error? } without consuming image generation quota.
 */
async function testConnection(config) {
  const cfg = config || getConfig();
  try {
    const res = await fetch(buildUrl(cfg, '/v1'), {
      method: 'GET',
      headers: buildHeaders(cfg),
    });
    return { ok: res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Text-to-image generation.
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<Object>} API response { created, data: [{url}|{b64_json}] }
 */
async function generateImage(prompt, options = {}) {
  const config = getConfig();
  const provider = getProvider(config);
  const payload = normalizePayload(config, options);

  try {
    const req = provider.buildGenerationRequest({ config, prompt, options, payload });
    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, 300000);
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal });
    clearTimeout(timeout);
    return await parseResponse(res);
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * Image-to-image edit (single reference image).
 * Uses multipart/form-data to match the OpenAI image edits endpoint.
 * @param {File} imageFile
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function editImage(imageFile, prompt, options = {}) {
  // 单参考图的图生图 = 多图生图 [file],统一走 provider 路由(PPIO multipart / Agnes JSON+extra_body)
  return multiImageEdit([imageFile], prompt, options);
}

/**
 * Multi-image-to-image generation.
 * Sends all uploaded images to the edits endpoint; the backend may use them
 * as reference frames. Falls back gracefully if the server only accepts one.
 * @param {File[]} imageFiles
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function multiImageEdit(imageFiles, prompt, options = {}) {
  const config = getConfig();
  const provider = getProvider(config);
  const payload = normalizePayload(config, options);
  const key = config.provider || DEFAULT_CONFIG.provider;

  try {
    const req = await provider.buildEditRequest({
      config,
      imageFiles,
      prompt,
      options,
      payload,
      hasMask: !!options.mask,
    });

    // 使用后端代理转发请求（解决 CORS 问题）
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 300000);
    var proxyUrl = AUTH_SERVER_URL + '/api/proxy/generate';
    var imageData = [];
    for (var i = 0; i < imageFiles.length; i++) {
      imageData.push(await fileToDataURI(imageFiles[i]));
    }
    var body = {
      provider: key,
      prompt: prompt,
      size: payload.size,
      quality: payload.quality,
      model: payload.model,
      apiKey: providerConfig(config).apiKey,
      imageData: imageData,
    };
    var res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (getAuthToken() || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    var data = await res.json();
    if (!res.ok) {
      var errMsg = data && (data.error || data.message || res.statusText);
      throw new Error(errMsg || ('HTTP ' + res.status));
    }
    // 将代理响应转换为标准格式 { data: [{ url }] }
    if (data && Array.isArray(data.images)) {
      return { data: data.images.map(function(u) { return { url: u }; }) };
    }
    if (data && data.data) return data;
    return { data: [{ url: String(data) }] };
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * Convert an API data item to a displayable image URL.
 * Handles both `url` and `b64_json` response formats.
 */
function resultToImageUrl(item) {
  if (!item) return null;
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return null;
}

/**
 * Copy a string (image URL or base64 data URL) to the clipboard.
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Download an image by URL. Uses a blob fetch when possible so the browser
 * saves the file with a sensible name.
 */
async function downloadImage(url, filename) {
  function safeName() {
    return (filename || 'chaosbuilder-generated.png').replace(/\.png$/i, '') + '.png';
  }

  try {
    // dataURL:同源,canvas 不会 taint,可以安全合成白底
    if (/^data:image\//.test(url)) {
      const outBlob = await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function (b) {
              if (b) resolve(b);
              else reject(new Error('canvas.toBlob failed'));
            }, 'image/png');
          } catch (e) { reject(e); }
        };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = url;
      });
      const objectUrl = URL.createObjectURL(outBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = safeName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 5000);
      return;
    }

    // HTTP URL:跨域图会 taint canvas,跳过 canvas,直接 fetch + <a download>
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = safeName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 5000);
  } catch (e) {
    // 兜底:重新 fetch(不强制 cors),再 <a download>
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob();
      const ou = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = ou;
      a.download = safeName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(ou); }, 5000);
    } catch (e2) {
      // 最后一招:打开预览页,让服务器 Content-Disposition 触发下载
      window.open(url, '_blank');
    }
  }
}
const MAX_HISTORY = 24;

function historyKeyPrefix() {
  return window.Auth ? window.Auth.userKey('history:') : 'chaos_builder_history:';
}

function historyKey(type) {
  return historyKeyPrefix() + type;
}

function getHistory(type) {
  try {
    const raw = localStorage.getItem(historyKey(type));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('Failed to read history:', e);
    return [];
  }
}

function saveHistory(type, imageUrl, meta) {
  if (!imageUrl) return null;
  const list = getHistory(type);
  const entry = Object.assign({}, meta || {}, {
    url: imageUrl,
    createdAt: Date.now(),
  });
  const isSameAsLatest = list[0] && list[0].url === imageUrl;
  if (isSameAsLatest) {
    list[0] = entry;
  } else {
    list.unshift(entry);
  }
  try {
    localStorage.setItem(historyKey(type), JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch (e) {
    console.warn('Failed to save history:', e);
  }
  return entry;
}

function deleteHistory(type, entry) {
  if (!entry) return;
  const list = getHistory(type);
  const filtered = list.filter(function (e) {
    return !(e.url === entry.url && e.createdAt === entry.createdAt);
  });
  try {
    localStorage.setItem(historyKey(type), JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to delete history from local storage:', e);
  }
  if (entry.id) deleteServerHistory(entry.id);
}

function clearHistory(type) {
  try {
    const prefix = historyKeyPrefix();
    if (type) {
      localStorage.removeItem(historyKey(type));
    } else {
      Object.keys(localStorage).forEach(function (key) {
        if (key.startsWith(prefix)) localStorage.removeItem(key);
      });
    }
  } catch (e) {
    console.warn('Failed to clear history:', e);
  }
}

function createLightbox() {
  let overlay = document.getElementById('chaos-lightbox');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'chaos-lightbox';
  overlay.className = 'lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('tabindex', '-1');
  const closeLabel = window.I18N ? window.I18N.t('actionClose') : 'Close';
  const downloadLabel = window.I18N ? window.I18N.t('actionDownload') : 'Download';
  overlay.innerHTML =
    '<button type="button" class="lightbox-close" aria-label="' + closeLabel + '">×</button>' +
    '<img src="" alt="" class="lightbox-image" />' +
    '<button type="button" class="lightbox-download" aria-label="' + downloadLabel + '" title="' + downloadLabel + '">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
    '</button>';
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('.lightbox-close');
  const downloadBtn = overlay.querySelector('.lightbox-download');
  const img = overlay.querySelector('.lightbox-image');

  function close() {
    overlay.classList.remove('active');
    img.src = '';
    overlay.removeAttribute('data-url');
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('active')) close();
  });
  downloadBtn.addEventListener('click', function () {
    const url = overlay.getAttribute('data-url');
    if (url) downloadImage(url, 'chaosbuilder-' + Date.now() + '.png');
  });

  overlay._close = close;
  return overlay;
}

function openLightbox(url) {
  if (!url) return;
  const overlay = createLightbox();
  const img = overlay.querySelector('.lightbox-image');
  overlay.setAttribute('data-url', url);
  img.src = url;
  img.onload = function () {
    overlay.classList.add('active');
  };
}

function makeImageCard(url, opts) {
  opts = opts || {};
  const wrapper = document.createElement('div');
  wrapper.className = opts.className || 'result-item';

  const img = document.createElement('img');
  img.src = url;
  img.alt = opts.alt || '';
  if (opts.loading) img.loading = opts.loading;
  if (opts.title) img.title = opts.title;
  img.addEventListener('click', function () { openLightbox(url); });
  wrapper.appendChild(img);

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'image-download-btn';
  const downloadLabel = window.I18N ? window.I18N.t('actionDownload') : 'Download';
  downloadBtn.setAttribute('aria-label', downloadLabel);
  downloadBtn.title = downloadLabel;
  downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  downloadBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    downloadImage(url, opts.filename || 'chaosbuilder-' + Date.now() + '.png');
  });
  wrapper.appendChild(downloadBtn);

  if (opts.onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'image-delete-btn';
    const deleteLabel = window.I18N ? window.I18N.t('actionDelete') : 'Delete';
    deleteBtn.setAttribute('aria-label', deleteLabel);
    deleteBtn.title = deleteLabel;
    deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg><span>' + deleteLabel + '</span>';
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (window.confirm(opts.deleteConfirm || (window.I18N ? window.I18N.t('confirmDeleteHistory') : 'Delete this item?'))) {
        opts.onDelete();
      }
    });
    wrapper.appendChild(deleteBtn);
  }

  if (opts.actions) {
    const actions = document.createElement('div');
    actions.className = 'result-actions';
    opts.actions.forEach(function (action) {
      actions.appendChild(action);
    });
    wrapper.appendChild(actions);
  }

  return wrapper;
}

// --- Backend data sync helpers ---

function getAuthToken() {
  try { return localStorage.getItem('chaos_builder_token'); } catch (e) { return null; }
}

function authHeaders() {
  const token = getAuthToken();
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function syncSaveHistory(type, imageUrl, meta) {
  const entry = saveHistory(type, imageUrl, meta);
  const token = getAuthToken();
  if (!token) return entry;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/history', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        prompt: meta && meta.prompt || '',
        model: meta && meta.model || 'gpt-image-2',
        size: meta && meta.size || '',
        quality: meta && meta.quality || '',
        n: meta && meta.n || 1,
        image_urls: [imageUrl],
        mode: type || 'text-to-image'
      })
    });
    if (res.ok && entry) {
      const result = await res.json();
      if (result && result.id) {
        // 把服务器 id 持久化到 localStorage entry,后续才能 delete
        const list = getHistory(type);
        const idx = list.findIndex(function (e) {
          return e.url === entry.url && e.createdAt === entry.createdAt && !e.id;
        });
        if (idx >= 0) {
          list[idx].id = result.id;
          try { localStorage.setItem(historyKey(type), JSON.stringify(list)); } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.warn('Failed to sync history to server:', e);
  }
  return entry;
}

async function fetchServerHistory({ limit, offset } = {}) {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (offset) params.set('offset', offset);
    const res = await fetch(AUTH_SERVER_URL + '/api/history?' + params.toString(), { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function deleteServerHistory(id) {
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch(AUTH_SERVER_URL + '/api/history/' + id, { method: 'DELETE', headers: authHeaders() });
  } catch (e) { console.warn('Failed to delete server history:', e); }
}

async function clearServerHistory() {
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch(AUTH_SERVER_URL + '/api/history', { method: 'DELETE', headers: authHeaders() });
  } catch (e) { console.warn('Failed to clear server history:', e); }
}

async function fetchServerPresets() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/presets', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function createServerPreset(data) {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/presets', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(data)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function updateServerPreset(id, data) {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/presets/' + id, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) { return false; }
}

async function deleteServerPreset(id) {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/presets/' + id, {
      method: 'DELETE', headers: authHeaders()
    });
    return res.ok;
  } catch (e) { return false; }
}

async function fetchServerSettings() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/settings', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function saveServerSettings(settings) {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/settings', {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(settings)
    });
    return res.ok;
  } catch (e) { return false; }
}

// Admin global settings
async function fetchAdminSettings() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/settings/admin', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function saveAdminSettings(settings) {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/settings/admin', {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(settings)
    });
    return res.ok;
  } catch (e) { return false; }
}

/**
 * Bind a progress monitor to a root element with this skeleton:
 *
 *   <div id="progress-monitor" hidden>
 *     <div class="progress-header">
 *       <div class="progress-steps">
 *         <div class="step" data-step="0"><span class="dot"></span><span>…</span></div>
 *         <div class="step" data-step="1"><span class="dot"></span><span>…</span></div>
 *         …
 *       </div>
 *       <span class="elapsed">0.0s</span>
 *     </div>
 *     <div class="progress-bar"><div class="bar-fill"></div></div>
 *     <div class="progress-text">…</div>
 *   </div>
 *
 * Returns: { reset(), setStep(idx, label), finish(success, label), destroy() }
 */
function createProgressMonitor(rootEl) {
  if (!rootEl) return null;
  const steps = Array.from(rootEl.querySelectorAll('.step'));
  const barFill = rootEl.querySelector('.bar-fill');
  const elapsedEl = rootEl.querySelector('.elapsed');
  const textEl = rootEl.querySelector('.progress-text');
  let timer = null;

  function reset() {
    steps.forEach((s, i) => {
      s.classList.remove('active', 'done');
      if (i === 0) s.classList.add('active');
    });
    if (barFill) barFill.style.width = '0%';
    rootEl.hidden = false;
    rootEl.classList.remove('error');
    const t0 = performance.now();
    if (elapsedEl) elapsedEl.textContent = '0.0s';
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (elapsedEl) elapsedEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);
    return t0;
  }

  function setStep(idx, label) {
    steps.forEach((s, i) => {
      s.classList.remove('active');
      if (i < idx) s.classList.add('done');
      else if (i === idx) s.classList.add('active');
    });
    if (barFill) barFill.style.width = Math.min(idx * 25, 100) + '%';
    if (label && textEl) textEl.textContent = label;
  }

  function finish(success, label) {
    if (timer) { clearInterval(timer); timer = null; }
    if (success) {
      setStep(steps.length, label);
      if (barFill) barFill.style.width = '100%';
      setTimeout(() => { rootEl.hidden = true; }, 900);
    } else {
      rootEl.classList.add('error');
      if (textEl) textEl.textContent = label || '失败';
    }
  }

  function destroy() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { reset, setStep, finish, destroy };
}

// ─── Application Log ───
var LOG_KEY = 'chaos_builder_app_log';

function appLog(level, msg, data) {
  try {
    var list = loadAppLog();
    list.unshift({
      level: level || 'info',
      msg: String(msg || ''),
      data: data || null,
      time: Date.now(),
      ts: new Date().toISOString(),
    });
    // 保留最多 200 条
    if (list.length > 200) list.length = 200;
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch(e) {}
}

function loadAppLog() {
  try {
    var raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function clearAppLog() {
  localStorage.removeItem(LOG_KEY);
}

window.ChaosAPI = {
  DEFAULT_CONFIG,
  PROVIDERS,
  AUTH_SERVER_URL,
  SIZE_OPTIONS,
  getConfig,
  saveConfig,
  resetConfig,
  getProvider,
  testConnection,
  generateImage,
  editImage,
  multiImageEdit,
  resultToImageUrl,
  copyToClipboard,
  downloadImage,
  getHistory,
  saveHistory,
  syncSaveHistory,
  clearHistory,
  createLightbox,
  openLightbox,
  makeImageCard,
  getSizesByOrientation,
  getDefaultSizeForOrientation,
  flipOrientation,
  getOrientationFromSize,
  fetchServerHistory,
  deleteServerHistory,
  clearServerHistory,
  fetchServerPresets,
  createServerPreset,
  updateServerPreset,
  deleteServerPreset,
  fetchServerSettings,
  saveServerSettings,
  fetchAdminSettings,
  saveAdminSettings,
  createProgressMonitor,
  onConfigChange,
  getCurrentProviderInfo,
  deleteHistory,
  syncFromServer,
  onDataChange,
  classifyError,
  showErrorModal,
  loadCustomProviders,
  saveCustomProviders,
  addCustomProvider,
  removeCustomProvider,
  loadHiddenProviders,
  hideProvider,
  unhideProvider,
  PROVIDERS,
};
