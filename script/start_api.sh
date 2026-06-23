#!/bin/bash
# Start the ChaosBuilder image API server (port 8766)
# 这是 page/API_GUIDE.md 描述的 OpenAI 兼容代理服务,
# 接收前端 {apiBaseUrl}/v1/images/{generations,edits} 请求,
# 转发到 PPIO gpt-image-2 上游。
cd "$(dirname "$0")/.."

# 依赖自检:没装就提示用户装
if ! python3 -c "import flask, flask_cors, requests" >/dev/null 2>&1; then
  echo "[start_api] 缺少依赖,自动执行 pip3 install -r requirements.txt ..."
  pip3 install -r requirements.txt || {
    echo "[start_api] 安装失败,请手动:pip3 install -r requirements.txt"
    exit 1
  }
fi

# .env 存在就自动加载(由 api_server.py 内的 python-dotenv 完成)
if [ -f .env ]; then
  echo "[start_api] 检测到 .env,已加载其中 PPIO_API_KEY 等变量"
else
  echo "[start_api] 提示:项目根没有 .env,服务器将仅依赖 Authorization 头传入 Key"
fi

echo "[start_api] ChaosBuilder image API starting on http://localhost:8766"
echo "[start_api] 健康检查: curl http://localhost:8766/health"
echo "[start_api] 按 Ctrl+C 停止"
echo ""

exec python3 api_server.py