#!/usr/bin/env python3
"""
ChaosBuilder API Server
=======================
OpenAI 兼容的图片生成代理,跑在 8766 端口,转发到 PPIO gpt-image-2 上游。

提供端点:
  POST /v1/images/generations   文生图(PPIO 文档: /v3/gpt-image-2-text-to-image)
  POST /v1/images/edits         图生图 + 局部 inpaint(PPIO 文档: /v3/gpt-image-2-edit,带 mask 即为 inpaint)

PPIO 上游协议(直连 https://api.ppio.com):
  - Auth: Authorization: Bearer <PPIO_API_KEY>
  - Content-Type: application/json
  - 文生图 body: {prompt, n, size, quality(low/medium/high), background?, output_format?, moderation?, output_compression?}
  - 图生图 body: {prompt, image(URL/base64), mask?(PNG with alpha), size, quality, output_format?}
  - 响应:      {images: [url1, url2, ...]}  ← 直接 URL 数组(非 OpenAI 风格)

特性:
  - prompt 完全自由,无任何注入/过滤
  - Authorization: Bearer <key> 透传;未传则使用环境变量里的服务器默认 Key
  - quality: "standard" → "medium","hd" → "high"
  - 上游端点全部走环境变量配置,PPIO 路径调整只改 env 不动代码
"""

import os
import time
import base64
import logging
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()  # 读取项目根目录 .env(若存在)
except ImportError:
    # 没装 python-dotenv 时降级:只能依赖真实环境变量
    pass

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS


# ─────────────────────────── 配置 ───────────────────────────
PPIO_BASE = os.getenv("PPIO_BASE", "https://api.ppio.com").rstrip("/")
# PPIO GPT Image 2 文档(2026-04-24):
#   文生图: POST /v3/gpt-image-2-text-to-image
#   图生图: POST /v3/gpt-image-2-edit(body 带 mask 字段即作 inpaint 用,无独立 inpaint 路径)
PPIO_T2I_PATH = os.getenv("PPIO_T2I_PATH", "/v3/gpt-image-2-text-to-image")
PPIO_EDIT_PATH = os.getenv("PPIO_EDIT_PATH", "/v3/gpt-image-2-edit")
DEFAULT_API_KEY = os.getenv("PPIO_API_KEY", "").strip()
HOST = os.getenv("API_HOST", "0.0.0.0")
PORT = int(os.getenv("API_PORT", "8766"))
UPSTREAM_TIMEOUT = int(os.getenv("UPSTREAM_TIMEOUT", "120"))

# OpenAI 小尺寸自动升级到 1024
SIZE_UPGRADE = {
    "256x256": "1024x1024",
    "512x512": "1024x1024",
}

# OpenAI 风格尺寸列表,文档宣称支持
SUPPORTED_SIZES_HINT = [
    "1024x1024", "1024x1536", "1536x1024", "2048x2048",
    "2048x1152", "1152x2048", "2048x1536", "1536x2048",
    "2048x1360", "1360x2048", "2048x1024", "1024x2048",
    "2048x880",  "880x2048",  "2048x688",  "688x2048",
    "3840x2160", "2160x3840",
]


# ─────────────────────────── 日志 ───────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("chaosbuilder-api")


# ─────────────────────────── Flask ───────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB,图生图上传用


# ─────────────────────────── 工具函数 ───────────────────────────

def get_api_key() -> Optional[str]:
    """优先使用请求头里的 Key,否则用环境变量里的服务器默认 Key。"""
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        key = auth[7:].strip()
        if key:
            return key
    return DEFAULT_API_KEY or None


def quality_to_ppio(q: str) -> str:
    return {"hd": "high", "standard": "medium"}.get((q or "").lower(), "high")


def normalize_size(size: Optional[str]) -> str:
    if not size:
        return "1024x1024"
    s = size.replace("*", "x").lower().strip()
    return SIZE_UPGRADE.get(s, s)


def file_to_data_url(file_storage, mime_hint: str = "image/png") -> str:
    """Flask FileStorage → data URL(PPIO 接受 URL 或 base64)。"""
    raw = file_storage.read()
    b64 = base64.b64encode(raw).decode("ascii")
    # 简单识别 MIME
    mime = mime_hint
    if raw.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif raw.startswith(b"\x89PNG"):
        mime = "image/png"
    elif raw.startswith(b"GIF"):
        mime = "image/gif"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        mime = "image/webp"
    return f"data:{mime};base64,{b64}"


def extract_ppio_images(ppio_data) -> list:
    """兼容多种 PPIO 响应格式,统一抽出图片 URL / b64_json 列表。
    支持:
      - PPIO 风格:   {"images": ["url1", "url2", ...]}                  ← 主格式
      - PPIO 风格:   {"images": [{"url": "..."}, {"b64_json": "..."}]}  ← 罕见
      - OpenAI 风格: {"data": [{"url": "..."}, {"b64_json": "..."}]}    ← 兼容
    """
    items = []
    if not isinstance(ppio_data, dict):
        return items
    if isinstance(ppio_data.get("images"), list):
        for x in ppio_data["images"]:
            if isinstance(x, str):
                items.append({"url": x})
            elif isinstance(x, dict):
                if "url" in x:        items.append({"url": x["url"]})
                elif "b64_json" in x: items.append({"b64_json": x["b64_json"]})
    if not items and isinstance(ppio_data.get("data"), list):
        for x in ppio_data["data"]:
            if isinstance(x, dict):
                if "url" in x:        items.append({"url": x["url"]})
                elif "b64_json" in x: items.append({"b64_json": x["b64_json"]})
    return items


def to_openai_response(ppio_data: dict, requested_format: str) -> dict:
    """PPIO 响应 → OpenAI 兼容格式。"""
    raw_items = extract_ppio_images(ppio_data)
    out_items = []
    want_b64 = (requested_format == "b64_json")
    for item in raw_items:
        if want_b64:
            if "b64_json" in item:
                out_items.append({"b64_json": item["b64_json"]})
            elif "url" in item and item["url"].startswith("data:"):
                # data URL → b64
                _, payload = item["url"].split(",", 1)
                out_items.append({"b64_json": payload})
            elif "url" in item:
                # 无法转 b64 时降级返回 url
                out_items.append({"url": item["url"]})
        else:
            if "url" in item:
                out_items.append({"url": item["url"]})
            elif "b64_json" in item:
                out_items.append({
                    "b64_json": item["b64_json"],
                    "url": f"data:image/png;base64,{item['b64_json']}",
                })
    return {
        "created": int(time.time()),
        "data": out_items,
    }


def error_response(status_code: int, message: str):
    return jsonify({"error": {"message": message, "code": status_code}}), status_code


def forward_to_ppio(url: str, payload: dict, api_key: str):
    """调 PPIO 上游,统一错误处理。"""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=UPSTREAM_TIMEOUT)
    except requests.RequestException as exc:
        logger.exception("Upstream request failed: %s", url)
        return error_response(502, f"Upstream request failed: {exc}")

    if resp.status_code >= 400:
        snippet = resp.text[:500]
        logger.warning("Upstream %s -> %s: %s", url, resp.status_code, snippet)
        # PPIO 错误结构可能与 OpenAI 不同,直接透传
        try:
            return jsonify(resp.json()), resp.status_code
        except ValueError:
            return error_response(resp.status_code, snippet)

    try:
        return jsonify(resp.json()), resp.status_code
    except ValueError:
        return error_response(502, "Upstream returned non-JSON response")


# ─────────────────────────── 端点 ───────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": int(time.time()),
        "default_key_configured": bool(DEFAULT_API_KEY),
        "upstream_base": PPIO_BASE,
    })


@app.route("/v1", methods=["GET"])
@app.route("/v1/", methods=["GET"])
def v1_root():
    return jsonify({
        "service": "ChaosBuilder API",
        "version": "1.0.0",
        "upstream": PPIO_BASE,
        "endpoints": [
            "POST /v1/images/generations  -> PPIO /v3/gpt-image-2-text-to-image",
            "POST /v1/images/edits        -> PPIO /v3/gpt-image-2-edit (带 mask 即 inpaint)",
        ],
    })


@app.route("/v1/images/generations", methods=["POST", "OPTIONS"])
def generations():
    if request.method == "OPTIONS":
        return ("", 204)

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return error_response(400, "Request body must be a JSON object")

    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return error_response(400, "prompt is required")

    api_key = get_api_key()
    if not api_key:
        return error_response(
            500,
            "No API key available: set PPIO_API_KEY env or pass Authorization header",
        )

    n = max(1, min(int(body.get("n", 1)), 10))
    size = normalize_size(body.get("size"))
    quality = quality_to_ppio(body.get("quality", "hd"))
    resp_format = (body.get("response_format") or "url").lower()

    # PPIO 文生图 body(按文档:prompt/n/size/quality/background/output_format/moderation/output_compression)
    # 注:response_format 不是 PPIO 字段(PPIO 默认返回 url),省略
    ppio_payload = {
        "prompt": prompt,
        "n": n,
        "size": size,
        "quality": quality,
        "output_format": "png",
        "background": "opaque",
        "moderation": "low",
    }

    return _generations_response(api_key, ppio_payload, resp_format)


def _generations_response(api_key: str, ppio_payload: dict, resp_format: str):
    upstream = f"{PPIO_BASE}{PPIO_T2I_PATH}"
    logger.info("text-to-image -> %s size=%s n=%s", upstream, ppio_payload["size"], ppio_payload["n"])

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(upstream, json=ppio_payload, headers=headers, timeout=UPSTREAM_TIMEOUT)
    except requests.RequestException as exc:
        logger.exception("Upstream request failed")
        return error_response(502, f"Upstream request failed: {exc}")

    if resp.status_code >= 400:
        snippet = resp.text[:500]
        logger.warning("Upstream %s -> %s: %s", upstream, resp.status_code, snippet)
        try:
            return jsonify(resp.json()), resp.status_code
        except ValueError:
            return error_response(resp.status_code, snippet)

    try:
        ppio_data = resp.json()
    except ValueError:
        return error_response(502, "Upstream returned non-JSON response")

    return jsonify(to_openai_response(ppio_data, resp_format))


@app.route("/v1/images/edits", methods=["POST", "OPTIONS"])
def edits():
    if request.method == "OPTIONS":
        return ("", 204)

    api_key = get_api_key()
    if not api_key:
        return error_response(
            500,
            "No API key available: set PPIO_API_KEY env or pass Authorization header",
        )

    if "image" not in request.files:
        return error_response(400, "image file is required (multipart field 'image')")

    prompt = request.form.get("prompt")
    if not prompt or not prompt.strip():
        return error_response(400, "prompt is required (multipart field 'prompt')")

    image_data_url = file_to_data_url(request.files["image"])

    has_mask = "mask" in request.files
    mask_data_url = None
    if has_mask:
        mask_data_url = file_to_data_url(request.files["mask"])

    size = normalize_size(request.form.get("size"))
    quality = quality_to_ppio(request.form.get("quality", "hd"))
    resp_format = (request.form.get("response_format") or "url").lower()

    # PPIO 图生图 body(按文档:image 必须;mask 可选 - 带 alpha 通道的 PNG,完全透明区域表示编辑位置)
    # 同一个端点 /v3/gpt-image-2-edit,带 mask 即为 inpaint,无 mask 即为普通图生图
    upstream = f"{PPIO_BASE}{PPIO_EDIT_PATH}"
    ppio_payload = {
        "prompt": prompt,
        "image": image_data_url,
        "size": size,
        "quality": quality,
        "output_format": "png",
    }
    if has_mask:
        ppio_payload["mask"] = mask_data_url

    logger.info(
        "%s -> %s size=%s%s",
        "inpainting" if has_mask else "image-to-image",
        upstream, size,
        " mask=yes" if has_mask else "",
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(upstream, json=ppio_payload, headers=headers, timeout=UPSTREAM_TIMEOUT)
    except requests.RequestException as exc:
        logger.exception("Upstream request failed")
        return error_response(502, f"Upstream request failed: {exc}")

    if resp.status_code >= 400:
        snippet = resp.text[:500]
        logger.warning("Upstream %s -> %s: %s", upstream, resp.status_code, snippet)
        try:
            return jsonify(resp.json()), resp.status_code
        except ValueError:
            return error_response(resp.status_code, snippet)

    try:
        ppio_data = resp.json()
    except ValueError:
        return error_response(502, "Upstream returned non-JSON response")

    return jsonify(to_openai_response(ppio_data, resp_format))


# ─────────────────────────── 入口 ───────────────────────────

def _print_banner():
    logger.info("=" * 60)
    logger.info("ChaosBuilder API Server")
    logger.info("  listen       : %s:%s", HOST, PORT)
    logger.info("  PPIO upstream: %s", PPIO_BASE)
    logger.info("  text2image   : %s", PPIO_T2I_PATH)
    logger.info("  image2image  : %s (带 mask 即 inpaint)", PPIO_EDIT_PATH)
    logger.info("  default key  : %s", "configured" if DEFAULT_API_KEY else "NOT configured (only via Authorization header)")
    logger.info("=" * 60)


if __name__ == "__main__":
    _print_banner()
    # threaded=True 让 Flask 同时处理并发请求(生图是慢任务,不能串行)
    app.run(host=HOST, port=PORT, debug=False, threaded=True)