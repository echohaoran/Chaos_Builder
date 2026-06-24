# VibeCoding 开发日志

## 项目说明
ChaosBuilder — AI 图像生成工具，支持文生图、图生图、文案生成等功能。

## 日志

### 2026-06-24

#### [修复] 设置页面: 后端已禁用用户可登录但无法调用任何 API
- **文件**: `server/middleware.js`
- **改动**: authMiddleware 中增加禁用用户检查，被禁用用户返回 403
- **提交**: `fix: 恢复缺失的 server/email.js 邮件服务模块`

#### [修复] 设置页面: 管理员看不到其他用户
- **文件**: `frontend/html/settings.html`
- **改动**: loadUsers() 中 API URL 改为使用 AUTH_SERVER_URL
- **提交**: `修复用户管理显示`

#### [功能] 设置页面: 用户管理功能增强
- **文件**: `server/db.js`, `server/routes/settings.js`, `frontend/html/settings.html`
- **改动**: 添加 api_calls/disabled 字段、用户禁用/启用/删除 API、前端操作按钮
- **提交**: `增加用户使用次数统计...`

#### [UI] 设置页面: 重新设计
- **文件**: `frontend/html/settings.html`
- **改动**: 卡片顶部彩条设计、供应商徽章增强、表单改善、斑马条纹用户列表
- **提交**: `feat: 重新设计设置页面卡片排版`

#### [功能] 所有用户可访问设置页面
- **文件**: `frontend/html/settings.html`, 所有页面
- **改动**: 移除管理员重定向，图片模型配置对所有用户开放
- **提交**: `feat: 所有用户可访问设置页面配置自己的模型`

#### [修复] 生成历史功能失效
- **文件**: `frontend/html/generate.html`
- **改动**: getHistory() 改为使用 ChaosAPI.getHistory() 合并所有模式
- **提交**: `fix: 修复生成历史功能`

#### [功能] 生成历史添加删除功能
- **文件**: `frontend/html/generate.html`, `frontend/js/i18n.js`
- **改动**: 单张删除、多选模式、批量删除
- **提交**: `feat: 生成历史支持单个删除和多选删除`

#### [功能] 生成历史仅保留72小时
- **文件**: `frontend/html/generate.html`, `frontend/js/i18n.js`
- **改动**: 添加 cleanOldHistory() 自动清理过期记录，标题后显示提示标签
- **提交**: `feat: 生成历史仅保留72小时`

#### [功能] 删除多图生图页面
- **文件**: `frontend/html/multi-image.html` (已删除)
- **改动**: 删除独立的 multi-image 文件

#### [功能] 图生图上传限制改为5张
- **文件**: `frontend/html/image-to-image.html`, `frontend/js/i18n.js`
- **改动**: MAX_FILES=5，支持 multiple 上传，使用 multiImageEdit API

#### [功能] 文案生成页面删除上传素材功能
- **文件**: `frontend/html/copy.html`
- **改动**: 移除文件上传区域、相关 CSS 和 JS

#### [功能] 图片生成页面改进
- **文件**: `frontend/html/generate.html`
- **改动**: 
  - 移除多图生图 tab
  - 生成数量选项扩展为 1-5
  - 结果展示改为轮播模式，左右箭头翻页
  - 标签切换时通过 sessionStorage 保存/恢复状态
  - 图生图模式支持多文件上传（最多5张）
  - Provider 指示器增加重试机制
- **提交**: `feat: 移除多图生图tab，数量选项1-5，结果翻页箭头，标签切换保留状态`

#### [UI] Landing 页面重设计
- **文件**: `frontend/html/landing.html`, `frontend/js/i18n.js`
- **改动**: 替换 Features/Workflow/CTA 为 Showcase + How It Works + CTA
- **提交**: `feat: 重设计 landing 页面中间部分`

#### [UI] 浏览器标签页 Logo
- **文件**: 所有 HTML 页面
- **改动**: 添加 logo透明.png 作为 favicon

#### [修复] 项目文件丢失恢复
- **文件**: 全项目
- **改动**: 从 git stash 中恢复被误删的文件

#### [修复] Gitea WORK_PATH 配置错误
- **文件**: `/etc/gitea/app.ini` (服务器端)
- **改动**: 删除冲突的 WORK_PATH 配置

#### [修复] 预设封面图上传限制
- **文件**: `frontend/html/preset-styles.html`
- **改动**: 取消图片压缩，保留原始分辨率；IndexedDB 存储突破 5MB localStorage 限制

#### [功能] 预设风格页面改进
- **文件**: `frontend/html/preset-styles.html`, `frontend/html/generate.html`
- **改动**: 预设统一从 localStorage 读取，支持 IndexedDB 封面图，删除巴洛克浮雕预设
