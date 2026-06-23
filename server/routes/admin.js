// server/routes/admin.js
// WebUI 一键更新端点
// POST /api/admin/check   - 检查是否有更新
// POST /api/admin/update  - 触发更新(后台执行,返回 pid + log path)
// GET  /api/admin/update/stream - SSE 实时推送更新日志
//
// 安全: 简单 admin token 鉴权,通过 ADMIN_TOKEN 环境变量启用
//       自托管场景下未设置 token 时不鉴权(假定可信网络)

const express = require('express');
const router = express.Router();
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UPDATE_SCRIPT = path.resolve(__dirname, '..', '..', 'script', 'update.sh');
const LOG_FILE = path.join(os.tmpdir(), 'chaos-update.log');
// 项目目录:优先环境变量,其次推断(本地开发用 __dirname/../..)
const PROJECT_DIR = process.env.CHAOS_PROJECT_DIR || path.resolve(__dirname, '../..');
const DEFAULT_REMOTE = process.env.CHAOS_UPDATE_REMOTE || 'origin';
const DEFAULT_BRANCH = process.env.CHAOS_UPDATE_BRANCH || 'main';

function checkAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return next(); // 未设 token 不鉴权(自托管场景)
  const provided = req.headers['x-admin-token'] || req.query.token;
  if (provided !== expected) {
    return res.status(403).json({ error: 'forbidden', message: 'invalid admin token' });
  }
  next();
}

function getShortHash(commit) {
  return commit ? commit.substring(0, 7) : 'unknown';
}

// 检查是否有更新
router.get('/check', checkAuth, (req, res) => {
  try {
    const current = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    // 远程 HEAD 容错:可能没 fetch;尝试 fetch 一次
    try {
      execSync(`git fetch ${DEFAULT_REMOTE} ${DEFAULT_BRANCH}`, {
        cwd: PROJECT_DIR,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe'
      });
    } catch (fetchErr) {
      // fetch 失败不阻塞,fall back 到本地 ref
      console.warn('[admin/check] fetch failed:', fetchErr.message);
    }
    let remote;
    try {
      remote = execSync(`git rev-parse ${DEFAULT_REMOTE}/${DEFAULT_BRANCH}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    } catch (e) {
      return res.json({
        current,
        remote: null,
        hasUpdate: false,
        currentShort: getShortHash(current),
        remoteShort: null,
        message: 'no remote ref found, run git fetch first'
      });
    }
    res.json({
      current,
      remote,
      hasUpdate: current !== remote,
      currentShort: getShortHash(current),
      remoteShort: getShortHash(remote)
    });
  } catch (e) {
    res.status(500).json({ error: 'check failed', message: e.message });
  }
});

// 触发更新(后台进程)
router.post('/update', checkAuth, (req, res) => {
  // 清理旧日志
  try { fs.unlinkSync(LOG_FILE); } catch (e) { /* ignore */ }

  // 启动后台脚本
  const proc = spawn('bash', [
    UPDATE_SCRIPT,
    PROJECT_DIR,
    LOG_FILE,
    DEFAULT_REMOTE,
    DEFAULT_BRANCH
  ], {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: 'ignore'
  });
  proc.unref(); // 父进程退出不影响子进程

  res.json({
    status: 'started',
    pid: proc.pid,
    logFile: LOG_FILE,
    message: 'update started in background, stream logs via /api/admin/update/stream'
  });
});

// SSE 流式日志
router.get('/update/stream', checkAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx buffering(虽然 nginx 不代理此端点)
  res.flushHeaders();

  // 写一条初始消息
  res.write(`data: ${JSON.stringify({ type: 'start', logFile: LOG_FILE, timestamp: Date.now() })}\n\n`);

  // 检查日志文件是否存在
  if (!fs.existsSync(LOG_FILE)) {
    res.write(`data: ${JSON.stringify({ type: 'log', line: '(no log file yet, update not started?)' })}\n\n`);
  }

  // tail -F(实时跟踪)
  const tail = spawn('tail', ['-F', '-n', '+1', LOG_FILE], { stdio: ['ignore', 'pipe', 'pipe'] });
  let finished = false;

  const sendLine = (line) => {
    if (!line.trim()) return;
    try { res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`); } catch (e) {}
    if (line.includes('UPDATE_DONE') || line.includes('ALREADY_UP_TO_DATE')) {
      finished = true;
      try { res.write(`data: ${JSON.stringify({ type: 'done', line })}\n\n`); } catch (e) {}
      setTimeout(() => {
        try { tail.kill(); res.end(); } catch (e) {}
      }, 1500);
    }
  };

  tail.stdout.on('data', chunk => {
    chunk.toString().split('\n').forEach(sendLine);
  });
  tail.stderr.on('data', chunk => {
    chunk.toString().split('\n').forEach(line => {
      if (line.trim()) {
        try { res.write(`data: ${JSON.stringify({ type: 'error', line })}\n\n`); } catch (e) {}
      }
    });
  });
  tail.on('exit', () => {
    if (!finished) {
      try { res.write(`data: ${JSON.stringify({ type: 'log', line: '(tail process exited, log stream ended)' })}\n\n`); } catch (e) {}
    }
    try { res.end(); } catch (e) {}
  });

  // 客户端断开
  req.on('close', () => {
    try { tail.kill(); } catch (e) {}
  });
});

module.exports = router;
