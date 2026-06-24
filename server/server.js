require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./auth');
const historyRoutes = require('./routes/history');
const presetsRoutes = require('./routes/presets');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const { apiLimiter } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3001;

// 登录/注册速率限制：每分钟最多 10 次
const authLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // 不强制升级 HTTP 到 HTTPS(我们服务器只有 HTTP,没 HTTPS 终结)
      // 没这个指令,浏览器看到 http 资源会去尝试 https,服务器没 https 会失败
      'upgrade-insecure-requests': null,
      // 允许 inline 样式的 dom(我们用 style 属性)
      'style-src': ["'self'", "'unsafe-inline'"],
      // 允许 data: 图片(captcha SVG 走 innerHTML 不走 img-src,但保留灵活)
      'img-src': ["'self'", 'data:'],
    }
  },
  // 不强制 HSTS(无 HTTPS,加了反而让浏览器持续升级)
  strictTransportSecurity: false,
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/history', apiLimiter, historyRoutes);
app.use('/api/presets', apiLimiter, presetsRoutes);
app.use('/api/settings', apiLimiter, settingsRoutes);
app.use('/api/admin', adminRoutes); // 一键更新端点(不限流)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`ChaosBuilder server running on http://localhost:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    const { getDb } = require('./db');
    try { getDb().close(); } catch (e) {}
    console.log('Server closed.');
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
