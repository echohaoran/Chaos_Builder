# ChaosBuilder 后端登录系统 — 设计规格

## [S1] 后端架构

```
chaosbuilder-server/
├── package.json          # 依赖：express, better-sqlite3, bcryptjs, jsonwebtoken, cors
├── server.js             # 入口：Express 启动 + 路由注册
├── db.js                 # SQLite 初始化（users 表）
├── auth.js               # 认证路由（/api/auth/*）
└── middleware.js          # JWT 验证中间件
```

- **端口**：`3001`（与图片 API `8766` 不冲突）
- **依赖**：`express`、`better-sqlite3`（同步 SQLite）、`bcryptjs`（密码哈希）、`jsonwebtoken`（JWT）、`cors`（允许前端跨域）
- **SQLite 表** `users`：`id INTEGER PK`, `username TEXT UNIQUE`, `password_hash TEXT`, `created_at TEXT`

## [S2] API 设计

| 方法 | 路径 | 认证 | 请求体 | 响应 |
|------|------|------|--------|------|
| `POST` | `/api/auth/register` | 无 | `{ username, password }` | `{ token, user: { id, username } }` |
| `POST` | `/api/auth/login` | 无 | `{ username, password }` | `{ token, user: { id, username } }` |
| `GET` | `/api/auth/me` | Bearer JWT | — | `{ user: { id, username } }` |
| `POST` | `/api/auth/change-password` | Bearer JWT | `{ oldPassword, newPassword }` | `{ message }` |

**JWT 配置**：有效期 7 天，payload 含 `{ userId, username }`
**错误响应格式**：`{ error: "message" }`，对应 HTTP 状态码 400/401/409
**密码规则**：最少 6 位，bcrypt 加盐 10 轮
**用户名规则**：1-32 字符，字母数字下划线

## [S3] 前端接入

- 只改 `js/auth.js`（完全重写），不改任何 HTML/CSS/DOM 结构
- 新增 `js/config.js`：集中管理 `AUTH_API_BASE = 'http://localhost:3001'`
- 令牌存储：`localStorage.setItem('chaos_builder_token', token)`
- 登录流程：POST `/api/auth/login` → 成功存 token → 跳转首页
- 注册行为：用户名+密码输入 → 先尝试登录 → 失败则自动注册（无单独注册页）
- i18n 新增少量注册/密码相关 key
