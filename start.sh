#!/bin/bash
# Start both frontend and backend simultaneously
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ───── 启动前清理:杀掉占用 3001 / 8080 / 8766 的孤儿进程 ─────
cleanup_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :$port -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "[start.sh] 端口 $port 被占用,清理 PID: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
    sleep 0.5
  fi
}

for port in 3001 8080 8766; do
  cleanup_port "$port"
done

echo "Starting ChaosBuilder..."
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Start backend
cd "$SCRIPT_DIR/server" && node server.js &
SERVER_PID=$!

# Start frontend
cd "$SCRIPT_DIR/frontend" && python3 -m http.server 8080 &
FRONTEND_PID=$!

# Trap Ctrl+C / SIGTERM:同时杀掉我们启的两个进程以及它们的子进程组
shutdown() {
  echo ""
  echo "Stopping services..."
  # 先 kill 整棵进程组,避免 trap 不生效时 Python/Node fork 的子进程成孤儿
  kill -TERM -$$ 2>/dev/null
  kill $SERVER_PID $FRONTEND_PID 2>/dev/null
  wait $SERVER_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap shutdown INT TERM

wait