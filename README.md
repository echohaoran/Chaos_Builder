# ChaosBuilder · 混沌艺术

![LOGO](https://image.echohaoran.top/ChaosBuilder/logo%E9%80%8F%E6%98%8E.png)

> **名为制造混乱,实则制造艺术。**
> 一个开源、可自托管的多供应商 AI 图像生成 Web 应用。前端纯 HTML/CSS/JS,后端 Express + SQLite,图片代理(可选)走 PPIO gpt-image-2 或 Agnes Image,**历史 / 设置 / 预设跟随账户跨设备同步**。

![status](https://img.shields.io/badge/status-1.0.0-blue)
![license](https://img.shields.io/badge/license-Apache_2.0-green)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![python](https://img.shields.io/badge/python-%3E%3D3.10-blue)

---

## ✨ 核心特性

### 🖼️ 生图
- **三种生图模式**:文生图、图生图(单参考图)、多图合成(2-4 张)
- **横屏 / 竖屏 / 正方形 一键切换**:自动筛出对应方向的尺寸
- **多供应商路由**:同一前端,支持 PPIO gpt-image-2 和 Agnes Image(2.0/2.1 Flash),各自适配私有协议
- **供应商独立配置**:每个供应商的 URL/Key/Model 分别保存,切换不重填
- **实时进度监控条**:四阶段(准备 / 提交 / 生成中 / 接收)+ 实时秒表
- **失败分类弹窗**:网络断开、余额不足、Key 错误、超时等分别提示 + 给操作建议

### 👤 账户与同步
- **本地账户系统**:bcrypt + JWT(7 天),含动态图形验证码(防机器人注册)
- **跨设备同步**:登录后服务器端 history / settings / presets 自动拉到本地;所有写操作(生图、删除、改设置)自动推服务器
- **单条删除**:历史缩略图带"🗑 删除"按钮,可单独清,本地和服务器同时清理

### 🎨 预设与历史
- **预设风格库**:海报 / 插画 / 产品主图等场景模板,封面图 + 描述 + 可公开/私有
- **生成历史**:每条记录带 prompt / model / size / quality,可重看、可单条删除、可下载原图

### 🌍 体验
- **中英双语 UI**:界面、提示、设置、文案全覆盖
- **零前端构建**:纯 HTML / CSS / JS,改完浏览器刷新即生效
- **响应式设计**:桌面三栏 / 平板两栏 / 移动单栏,断点 991 / 768
- **统一设计系统**:字号 / 颜色 / 间距 / 圆角全部走 `:root` design tokens

### 📦 部署
- **Docker 一键部署**:Compose 已编排前端 nginx + 后端 Express
- **本地裸跑**:三个 `start_*.sh` 脚本,各自启动一个进程

---

## 🏗️ 架构

```
┌──────────────────────────┐
│      Browser (任意端)      │
│   localStorage 缓存       │
│   JWT in localStorage     │
└────────────┬─────────────┘
             │ HTTPS
             ▼
┌──────────────────────────────────────────────────────────────┐
│  ┌────────────────────┐    ┌──────────────────────────────┐  │
│  │  frontend (nginx)   │    │  api_server.py  (可选)         │  │
│  │  :5418 (容器) / :8080 │    │  :8766                         │  │
│  │  静态站点            │    │  OpenAI 兼容 → PPIO 透传       │  │
│  └──────────┬─────────┘    └──────────┬───────────────────┘  │
│             │ /api/*                  │ /v1/images/*        │
│             ▼                          ▼                     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  server.js (Express, :3001)                           │    │
│  │  /api/auth  /api/history  /api/presets  /api/settings │    │
│  │  /api/auth/captcha(动态图形验证码)                   │    │
│  └──────────┬───────────────────────────────────────────┘    │
│             │                                                  │
│             ▼                                                  │
│  ┌────────────────────┐                                       │
│  │  SQLite            │                                       │
│  │  users / history   │                                       │
│  │  presets / settings│                                      │
│  └────────────────────┘                                       │
└──────────────────────────────────────────────────────────────┘
```

| 进程 / 服务 | 端口 | 角色 | 可选? |
|---|---|---|---|
| `frontend` (nginx) | 5418 (容器) / 8080 (dev) | 静态文件 + 反代 `/api/*` | 必须 |
| `server` (Express) | 3001 | 用户 / 历史 / 预设 / 设置 / 验证码 | 必须 |
| `api_server.py` (Flask) | 8766 | OpenAI 兼容 → PPIO 上游 | 可选(可直连 PPIO / Agnes) |

前端调用生图时,根据设置页选中的 provider 直接调对应 URL(PPIO 走 8766 代理,Agnes 走 `apihub.agnes-ai.com`)。

---

## 📁 项目结构

```
ChaosBuilder/
├── README.md                       # 本文件
├── LICENSE                         # Apache 2.0 许可
├── .env.example                    # 环境变量模板
├── .gitignore
├── .dockerignore
│
├── api_server.py                   # 可选:PPIO OpenAI 兼容代理(:8766)
├── requirements.txt                # api_server.py Python 依赖
│
├── page/                           # 文档与设计规格
│   ├── API_GUIDE.md                # api_server.py 协议契约 + 跨供应商
│   └── compose/                    # 设计 / 实施计划(历史快照)
│       ├── plans/
│       └── specs/
│
├── docker/                         # Docker 部署相关文件
│   ├── docker-compose.yml          # frontend + server 两服务编排
│   ├── docker-compose.prod.yml     # 生产扩展配置(bind mount+docker.sock)
│   ├── Dockerfile.frontend         # 前端 nginx 镜像
│   └── nginx/
│       └── default.conf            # 前端容器 nginx 配置
│
├── script/                         # 本地部署与运维脚本
│   ├── start.sh                    # 本地一键启动(后端 + 前端)
│   ├── start_api.sh                # 启动 8766(PPIO 代理)
│   ├── start_frontend.sh           # 启动前端静态服务(:8080)
│   ├── start_server.sh             # 启动后端(:3001)
│   └── update.sh                   # git pull + docker compose rebuild
│
├── frontend/                       # 纯静态站点(无构建步骤)
│   ├── html/                       # HTML 页面
│   │   ├── index.html              # 登录 / 注册入口
│   │   ├── landing.html            # 品牌落地页
│   │   ├── text-to-image.html      # 文生图
│   │   ├── image-to-image.html     # 图生图
│   │   ├── multi-image.html        # 多图合成
│   │   ├── preset-styles.html      # 预设风格库
│   │   ├── preset-detail.html      # 预设详情
│   │   └── settings.html           # 设置(供应商切换 + API 配置)
│   ├── css/
│   │   └── design-system.css       # 自研设计系统 + 错误弹窗样式
│   ├── js/
│   │   ├── api.js                  # 多供应商 SDK + 同步层
│   │   ├── auth.js                 # JWT 客户端
│   │   └── i18n.js                 # 中英双语字典
│   └── assets/
│       ├── posters/                # 落地页海报样图
│       └── presets/                # 预设封面图
│
└── server/                         # Express 后端
    ├── Dockerfile                  # 后端镜像构建
    ├── package.json
    ├── server.js                   # 入口(含 graceful shutdown)
    ├── db.js                       # SQLite 初始化 + DAO(5表)
    ├── auth.js                     # /api/auth/* 路由(register/login/me/change-password)
    ├── middleware.js               # JWT 中间件 + apiLimiter
    ├── routes/
    │   ├── admin.js                # WebUI 一键更新(check/update/SSE)
    │   ├── history.js              # /api/history
    │   ├── presets.js              # /api/presets
    │   └── settings.js             # /api/settings
    ├── chaosbuilder.db             # SQLite 数据(自动生成,gitignored)
    ├── chaosbuilder.db-shm         # WAL,gitignored
    ├── chaosbuilder.db-wal         # WAL,gitignored
    └── .env                        # 后端配置(自动创建,gitignored)
```

---

## 🚀 快速开始

### 方式 A — Docker(推荐生产)

```bash
git clone https://github.com/echohaoran/Chaos_Builder.git
cd ChaosBuilder

cp .env.example .env
# 编辑 .env:JWT_SECRET 改成强随机串
# 编辑 PPIO_API_KEY 填入你的供应商 Key(如果走 8766 代理)

docker compose -f docker/docker-compose.yml up -d --build
```

打开 `http://localhost:5418/` → 用 index.html 登录入口注册 / 登录。

> ⚠️ `docker/docker-compose.yml` 当前**只编排 frontend + server**。`api_server.py` 是可选代理层,如果要部署,在 compose 里加一个 service(参见下方"扩展 Docker Compose")。

### 方式 B — 本地裸跑(开发)

```bash
# 1. 后端依赖
cd server && npm install && cd ..

# 2. API 代理依赖(可选,如果直连 PPIO/Agnes 可跳过)
pip3 install -r requirements.txt

# 3. 配置
cp .env.example .env
# PPIO_API_KEY=sk_xxx  (8766 代理需要,直连则不需要)

# 4. 启动三个进程(每个一行,各占一个终端)
./script/start_api.sh       # 可选:http://localhost:8766
./script/start_server.sh    # 必选:http://localhost:3001
./script/start_frontend.sh  # 必选:http://localhost:8080
```

打开 `http://localhost:8080/`,登录后即可使用。

---

## ⚙️ 配置

### 环境变量(`.env`)

| 变量 | 默认 | 说明 |
|---|---|---|
| `JWT_SECRET` | `change-this` | 用户系统 JWT 签名密钥,**生产必须改** |
| `CORS_ORIGIN` | `*` | 用户系统 CORS 白名单 |
| `PORT` | `3001` | 用户系统监听端口 |
| `PPIO_API_KEY` | *(空)* | `api_server.py` 默认 Key;留空则必须用 Authorization 头传 |
| `PPIO_BASE` | `https://api.ppio.com` | PPIO 上游基址 |
| `PPIO_T2I_PATH` | `/v3/gpt-image-2-text-to-image` | 文生图上游路径 |
| `PPIO_I2I_PATH` | `/v3/gpt-image-2-image-to-image` | 图生图上游路径(命名约定推测) |
| `PPIO_INPAINT_PATH` | `/v3/gpt-image-2-inpainting` | inpaint 上游路径(命名约定推测) |
| `API_HOST` | `0.0.0.0` | api_server 监听地址 |
| `API_PORT` | `8766` | api_server 监听端口 |
| `UPSTREAM_TIMEOUT` | `120` | 上游调用超时(秒) |

### 供应商独立配置(前端 UI)

进入 `设置` 页,每个供应商都有自己的 URL / Key / Model 槽,保存后**该供应商的设置持久化**,切换不重填。

| 供应商 | 默认 URL | 默认模型 | 鉴权 |
|---|---|---|---|
| **PPIO · gpt-image-2** | `http://45.40.243.178:8766/` | `gpt-image-2` | 透传或服务端默认 Key |
| **Agnes Image (apihub)** | `https://apihub.agnes-ai.com` | `agnes-image-2.1-flash` | Bearer Token(必填) |

Agnes 模式下,设置页会显示"获取 Agnes 免费生图 API"红色链接,点击直达 Agnes 后台申请 Key。

---

## 📡 API 协议

### 用户系统后端 `server/`(Express, `:3001`)

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/auth/captcha` | — | 获取动态图形验证码(SVG + id) |
| POST | `/api/auth/register` | — | 注册(需 captcha) |
| POST | `/api/auth/login` | — | 登录(需 captcha) |
| GET | `/api/auth/me` | Bearer | 当前用户信息 |
| POST | `/api/auth/change-password` | Bearer | 改密码 |
| GET / DELETE | `/api/history` | Bearer | 历史记录(列表/清空) |
| POST | `/api/history` | Bearer | 入库 |
| DELETE | `/api/history/:id` | Bearer | 单条删除 |
| GET / POST / PUT / DELETE | `/api/presets` | Bearer | 预设风格 CRUD |
| GET / PUT | `/api/settings` | Bearer | 用户偏好 |
| GET | `/api/health` | — | 健康检查 |

### 可选代理 `api_server.py`(Flask, `:8766`)

OpenAI 兼容接口,prompt 完全自由,字段自动映射到 PPIO 原生:

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/v1/images/generations` | 文生图 |
| POST | `/v1/images/edits` | 图生图 / inpaint(multipart) |
| GET | `/v1` | 服务自检 |
| GET | `/health` | 健康检查 |

完整协议示例见 [`page/API_GUIDE.md`](page/API_GUIDE.md)。

### 二次开发:加新供应商

`frontend/js/api.js` 的 `PROVIDERS` 字典是插件点:

```js
PROVIDERS.yourname = {
  label: '...',
  apiBaseUrl: '...',
  defaultModel: '...',
  apiKeyHint: '...',
  buildGenerationRequest({ config, prompt, options, payload }) { /* 构造请求 */ },
  buildEditRequest({ config, imageFiles, prompt, options, payload, hasMask }) { /* 构造请求 */ },
};
```

加一个供应商:
1. 在 `PROVIDERS` 加一项
2. `frontend/html/settings.html` 的 `<select id="provider">` 加 `<option>`
3. `frontend/js/i18n.js` 中英字典各加 label

协议差异由 `buildGenerationRequest` / `buildEditRequest` 隔离,主调用代码无需改动。

---

## 🔄 跨设备同步数据流

登录后(任意浏览器),所有数据自动跟随账户:

```
设备 A(Safari)                    服务器                  设备 B(Edge)
   │                              │                          │
   ├─ 生成图                        │                          │
   │  syncSaveHistory()  ──────►   │                          │
   │  localStorage    +  POST ───►  │                          │
   │                                 │                          │
   │  改设置                          │                          │
   │  saveConfig()     ──────────►   │                          │
   │  localStorage    +  PUT  ───►  │                          │
   │                                 │                          │
   │                                 │  ◄── GET /api/history  ─┤ 登录后
   │                                 │  ◄── GET /api/settings  ─┤ syncFromServer()
   │                                 │  ◄── GET /api/presets   ─┤ 拉数据
```

- **写操作** 全部双写:本地 + 服务器(已登录时)
- **读操作** 优先本地(快);localStorage 为空时自动从服务器拉
- **设置** `saveConfig` 隐式 `saveServerSettings`;**生图** `syncSaveHistory`;**删除** `deleteServerHistory(entry.id)`

---

## 🛠️ 开发约定

- **零前端构建步骤**:改 `frontend/` 任意文件,浏览器 Cmd+Shift+R 强刷即生效。
- **后端修改后需重启**:`./script/start_server.sh` 启动的是裸 `node`,改完手动重启。
- **SQLite WAL**:`chaosbuilder.db` + `.db-shm` + `.db-wal` 三件套,**别手动删 `-wal`**,会丢未 checkpoint 的事务。已 gitignored。
- **不要把 API Key commit 到仓库**:`frontend/js/api.js` 的 `DEFAULT_CONFIG.apiKey` 默认空字符串,`server/.env` 在 `.gitignore` 里。
- **依赖要锁版本**:`server/package.json` / `requirements.txt` 都已写死主要依赖。

---

## 📦 扩展 Docker Compose(把 8766 加进生产)

在 `docker/docker-compose.yml` 追加:

```yaml
   api:
     build:
       context: ..
       dockerfile: docker/Dockerfile.api   # 需新增,FROM python:3.11-alpine, COPY api_server.py /app/
     ports:
       - "8766:8766"
     environment:
       - PPIO_API_KEY=${PPIO_API_KEY}
       - API_PORT=8766
     restart: unless-stopped
```

同时建议:把前端 nginx 的 `proxy_pass` 增补 `location /v1/ { proxy_pass http://api:8766; }`,让前端在同源下调用,避免 CORS 警告。

---

## ⚠️ 已知限制

- **PPIO 图生图 / inpaint 上游路径是按命名约定推测的**(`/v3/gpt-image-2-image-to-image` 等)。如果真实路径不同,只改 `.env` 的 `PPIO_I2I_PATH` / `PPIO_INPAINT_PATH`,不动代码。
- **Agnes 协议**依赖其官方文档 `https://agnes-ai.com/doc/agnes-image-20-flash`,字段或模型 ID 变化时,改 `frontend/js/api.js` 的 `PROVIDERS.agnes`。
- **docker-compose 当前只编排 frontend + server**,8766 端口需手动编排(见上)。
- **未引入 CI / 测试套件**,主分支靠手动回归。
- **没有内置反向代理 TLS 终止**:Docker 部署默认 HTTP,生产环境建议前置 nginx / caddy / traefik。

---

## 🤝 贡献

欢迎 PR。改动前请:
1. 看 `page/compose/specs/` 下的设计文档
2. 前端保持"零构建"原则(不引入 npm/Vite/webpack)
3. 新增路由请同时更新 README 的 API 表
4. 后端改动加测试,前端改动至少手动回归浏览器

---

## 📄 License

```
Copyright 2026 ChaosBuilder Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

完整许可文本见 [LICENSE](LICENSE)。
第三方依赖:Node 生态见 `server/node_modules/*/LICENSE`,Python 生态见 `pip show <pkg> license`。

---

## 📮 联系 & 镜像

- **GitHub 主页**: <https://github.com/echohaoran/Chaos_Builder>
- **Gitee 镜像**: <https://gitee.com/echohaoran/chaos-builder>

```bash
# GitHub 主仓库
git clone git@github.com:echohaoran/Chaos_Builder.git

# Gitee 镜像(国内访问更快)
git clone git@gitee.com:echohaoran/chaos-builder.git

# 在本地仓库里同时配两个 remote(项目仓库已配好)
git remote -v
# origin  -> git@github.com:echohaoran/Chaos_Builder.git
# gitee   -> git@gitee.com:echohaoran/chaos-builder.git
```

### 双推设置(Gitee 自动 / GitHub 手动)

**项目仓库已经配好 Gitee post-commit hook**——每次 `git commit` 自动同步到 Gitee 镜像,无需手动:

```bash
# 每次 commit 后自动跑
git add . && git commit -m "..."
# → hook 自动执行 git push gitee HEAD --force
# 失败也不阻塞 commit(只 warn "[gitee] push failed")
```

GitHub 仍**手动推**(主仓库,你想什么时候推就推):

```bash
git push origin main --force   # 显式推 GitHub
git push                       # 也行(走默认 upstream)
```

为什么这样分:
- **Gitee(镜像)** 自动推,无需操心
- **GitHub(主)** 手动推,避免 hook 嵌套问题(pre-push hook 推 gitee 会无限递归)

`post-commit` hook 内容(项目里已存在 `.git/hooks/post-commit`):

```bash
#!/bin/bash
git push gitee HEAD --force 2>&1 | sed 's/^/[gitee] /' || echo "[gitee] push failed (commit still OK)"
exit 0
```

如果换了机器 clone,记得复制 hook:

```bash
cp page/hooks/post-commit .git/hooks/post-commit   # 或手动设
chmod +x .git/hooks/post-commit
```



---

# 操作界面

## 多图生图

![多图生图](https://image.echohaoran.top/ChaosBuilder/%E5%A4%9A%E5%9B%BE%E7%94%9F%E5%9B%BE%E6%A0%B7%E5%BC%A0.png)



## 图生图

![图生图](https://image.echohaoran.top/ChaosBuilder/%E5%9B%BE%E7%89%87%E7%94%9F%E5%9B%BE%E6%A0%B7%E5%BC%A0.png)



## 文生图

![文生图](https://image.echohaoran.top/ChaosBuilder/%E6%96%87%E7%94%9F%E5%9B%BE%E6%A0%B7%E5%BC%A0.png)

> "名为制造混乱,实则制造艺术。" — 混沌艺术