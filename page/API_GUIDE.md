# API 调用指南

本项目的 `api_server.py` 提供 **OpenAI 兼容**的图片生成 API,prompt 完全由调用方控制。

支持两种上游:
- **PPIO gpt-image-2**(`https://api.ppio.com`)
- **Agnes Image 2.0/2.1 Flash**(`https://apihub.agnes-ai.com`)

> **直接调用上游**:如果不跑 `api_server.py`,前端可直接调上游 API,协议差异由 `frontend/js/api.js` 的 `PROVIDERS` 字典处理。

---

## 一、启动代理

```bash
# 依赖
pip3 install -r requirements.txt

# 启动
./start_api.sh          # 或:python3 api_server.py
# 监听 0.0.0.0:8766
```

环境变量(`.env` 或 shell):

| 变量 | 默认 | 说明 |
|---|---|---|
| `PPIO_API_KEY` | *(空)* | 服务器默认 Key,留空则强制 Authorization 透传 |
| `PPIO_BASE` | `https://api.ppio.com` | 上游基址 |
| `PPIO_T2I_PATH` | `/v3/gpt-image-2-text-to-image` | 文生图路径 |
| `PPIO_I2I_PATH` | `/v3/gpt-image-2-image-to-image` | 图生图路径(推测) |
| `PPIO_INPAINT_PATH` | `/v3/gpt-image-2-inpainting` | inpaint 路径(推测) |
| `API_HOST` | `0.0.0.0` | 监听地址 |
| `API_PORT` | `8766` | 监听端口 |
| `UPSTREAM_TIMEOUT` | `120` | 上游超时(秒) |

---

## 二、通用协议(OpenAI 兼容)

`api_server.py` 暴露 **OpenAI Images API 标准端点**,不区分上游:

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/v1/images/generations` | 文生图 |
| POST | `/v1/images/edits` | 图生图 / inpaint(multipart/form-data) |
| GET | `/v1` | 服务自检 |
| GET | `/health` | 健康检查 |

所有请求都会自动从 `Authorization: Bearer <key>` 读 Key,优先级:
1. 客户端请求头传入的 Key(推荐,自带余额)
2. 环境变量 `PPIO_API_KEY`(服务端默认)

**关键**:`api_server.py` **不**区分供应商 — 它只代理 PPIO。Agnes 直连走前端 `PROVIDERS.agnes` 协议。

---

## 三、文生图(`/v1/images/generations`)

### PPIO 协议(走 `api_server.py`)

```bash
curl -X POST http://<服务器IP>:8766/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk_your_own_key_here" \
  -d '{
    "prompt": "一只橘猫坐在窗台上看夕阳",
    "model": "gpt-image-2",
    "n": 1,
    "size": "1024x1024",
    "quality": "hd",
    "response_format": "url"
  }'
```

`api_server.py` 内部字段映射:
- `quality: "hd"` → `quality: "high"`
- `quality: "standard"` → `quality: "medium"`
- 加 `moderation: "low"`、`output_format: "png"`、`output_compression: 100`、`background: "opaque"`

### Agnes 协议(直连上游)

```bash
curl -X POST https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer agnes_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.1-flash",
    "prompt": "A luminous floating city above a misty canyon at sunrise, cinematic realism",
    "size": "1024x768",
    "extra_body": {
      "response_format": "url"
    }
  }'
```

**Agnes 协议要点**:
- `response_format` 必须放在 `extra_body` 里,顶层会返回 400
- 图生图通过 `extra_body.image` 数组传(URL 或 Data URI),不需要 `tags`
- 不收 `quality` 字段

### 响应(两种供应商统一)

```json
{
  "created": 1700000000,
  "data": [{"url": "https://..."}]
}
```

`response_format: b64_json` 时 `data[0].b64_json` 包含 base64。

---

## 四、图生图(`/v1/images/edits`,multipart)

### PPIO 协议(走 `api_server.py`)

```bash
curl -X POST http://<服务器IP>:8766/v1/images/edits \
  -H "Authorization: Bearer sk_your_own_key_here" \
  -F "image=@photo.png" \
  -F "prompt=将背景替换为星空" \
  -F "size=1024x1024" \
  -F "quality=hd" \
  -F "response_format=url"
```

`api_server.py` 内部把 multipart 转成 PPIO 原生 JSON(把 `image` 文件转 base64 Data URI,加 `output_format: "png"` 等)。

### Agnes 协议(直连)

```bash
# 用 jq 把文件转 base64
B64=$(base64 -i photo.png | tr -d '\n')

curl -X POST https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer agnes_your_key_here" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"agnes-image-2.1-flash\",
    \"prompt\": \"Make the object matte black while preserving the original composition\",
    \"size\": \"1024x768\",
    \"extra_body\": {
      \"image\": [\"data:image/png;base64,$B64\"],
      \"response_format\": \"url\"
    }
  }"
```

注意:**Agnes 用同一个端点 `/v1/images/generations`**,通过 `extra_body.image` 数组区分文生图 / 图生图。

---

## 五、Inpaint 修复

`api_server.py` 走 `/v1/images/edits` 加 `mask` 字段;Agnes 走 `/v1/images/generations` 加 `extra_body.mask`。

### PPIO(走 8766)

```bash
curl -X POST http://<服务器IP>:8766/v1/images/edits \
  -H "Authorization: Bearer sk_your_own_key_here" \
  -F "image=@photo.png" \
  -F "mask=@mask.png" \
  -F "prompt=把背景换成海滩" \
  -F "size=1024x1024" \
  -F "quality=hd" \
  -F "response_format=url"
```

### Agnes(直连)

`extra_body.mask` 同 `image` 一样是 base64 Data URI。

> **mask 格式**:透明区域(alpha=0)为要修复的部分,不透明区域(alpha=255)为保留部分。

---

## 六、参数速查

| 参数 | 类型 | 适用 | 说明 |
|---|---|---|---|
| `prompt` | string | 所有 | 图片描述,**完全自由**,无任何过滤 |
| `model` | string | 所有 | PPIO 写 `gpt-image-2`;Agnes 写 `agnes-image-2.1-flash` 或 `agnes-image-2.0-flash` |
| `n` | int | PPIO | 生成数量,1-10,默认 1 |
| `size` | string | 所有 | 像素尺寸,见下方支持列表 |
| `quality` | string | PPIO | `standard`(中等) / `hd`(高清) |
| `response_format` | string | 所有 | `url`(返回链接) / `b64_json`(base64);Agnes 必须在 `extra_body` 里 |
| `extra_body.image` | string[] | Agnes | 图生图输入,URL 或 `data:image/png;base64,...` |
| `extra_body.mask` | string | Agnes | inpaint 蒙版,Data URI |
| `Authorization` | header | 所有 | `Bearer <API_KEY>`,不传则用服务端默认 Key(PPIO 模式) |

### 支持的尺寸(两种供应商通用)

```
1024x1024, 1024x1536, 1536x1024, 2048x2048, 2048x1152, 1152x2048,
2048x1536, 1536x2048, 2048x1360, 1360x2048, 2048x1024, 1024x2048,
2048x880, 880x2048, 2048x688, 688x2048, 3840x2160, 2160x3840
```

> OpenAI 风格的小尺寸(256x256, 512x512)经 `api_server.py` 自动升级为 1024x1024。Agnes 直连不自动升级。

---

## 七、错误响应

`api_server.py` 在上游非 2xx 时**透传**上游的错误体。PPIO 典型:

```json
{
  "error": { "message": "insufficient balance", "code": "quota_exceeded" }
}
```

Agnes 典型:

```json
{
  "error": { "message": "Invalid API key", "type": "invalid_request_error" }
}
```

前端 `ChaosAPI.classifyError()` 根据 HTTP 状态码 + 消息关键词分类成 8 种用户可读错误(network / timeout / auth / quota / rate_limit / server / bad_request / unknown),并弹出错误弹窗。

---

## 八、Open WebUI / 其他第三方集成

| 配置项 | 值 |
|---|---|
| Base URL | `http://<服务器IP>:8766/v1` |
| API Key | 你自己的 PPIO Key(或任意非空字符串,服务端会忽略,用默认 Key) |
| Model | `gpt-image-2` |

> Agnes 的 `extra_body` 协议非标准 OpenAI,Open WebUI 可能不兼容;PPIO 走 8766 代理是 OpenAI 标准,完全兼容。

---

## 九、一键配置提示词(给 AI 助手用)

```
你可以调用图片生成 API 创建图片。

API 端点:POST http://<服务器IP>:8766/v1/images/generations
请求头:
  Content-Type: application/json
  Authorization: Bearer <你的PPIO_API_KEY>

请求体(JSON):
{
  "prompt": "<图片描述,无任何限制>",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "quality": "hd",
  "response_format": "url"
}

响应:
{
  "created": 1700000000,
  "data": [{"url": "https://..."}]
}

支持的尺寸:1024x1024, 1024x1536, 1536x1024, 2048x2048, 2048x1152, 1152x2048, 2048x1536, 1536x2048, 3840x2160, 2160x3840
quality:standard(中等) / hd(高清)
response_format:url / b64_json

图生图:POST /v1/images/edits,multipart/form-data,字段 image / mask / prompt / size / quality / response_format
```

---

## 十、与前端 WebUI 的区别

| | API 调用 | 前端 WebUI |
|---|---|---|
| **支持供应商** | 当前 `api_server.py` 只代理 PPIO;Agnes 需直连 | 同时支持 PPIO 和 Agnes,前端按 provider 路由 |
| **固定提示词** | **无**,prompt 完全自由 | **无**,prompt 同样由用户完全控制 |
| **API Key** | 支持自带 Key | 每个供应商独立保存,设置页切换 |
| **数据持久化** | 无 | 历史 / 设置 / 预设**跟随账户**自动同步到服务器 |
| **使用方式** | curl / 代码 / Open WebUI | 浏览器 `http://localhost:8080/` |
| **适合场景** | 自定义集成、批量、CI/CD | 个人创作,跨设备同步 |