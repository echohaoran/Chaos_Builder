#!/bin/bash
# script/update.sh
# 后端调用,跑: git pull + docker compose rebuild frontend
# 不重启 server(避免杀当前连接),前端刷新页面即可
# 日志写到 LOG_FILE,前端 SSE 拉这个文件

set -e

PROJECT_DIR=${1:-/home/ubuntu/chaos-builder}
LOG_FILE=${2:-/tmp/chaos-update.log}
REMOTE=${3:-origin}
BRANCH=${4:-main}

# 写日志函数,实时输出
exec >> "$LOG_FILE" 2>&1

echo "=== ChaosBuilder update start at $(date) ==="
echo "project: $PROJECT_DIR"
echo "remote:  $REMOTE/$BRANCH"

cd "$PROJECT_DIR" || { echo "FATAL: cd failed"; exit 1; }

# 1) fetch
echo "--- fetch ---"
git fetch "$REMOTE" "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "$REMOTE/$BRANCH")
echo "local:  $LOCAL"
echo "remote: $REMOTE_HASH"

# 2) 是否已最新
if [ "$LOCAL" = "$REMOTE_HASH" ]; then
  echo "ALREADY_UP_TO_DATE"
  echo "=== done at $(date) ==="
  exit 0
fi

# 3) 强制重置到远端(避免冲突)
echo "--- reset --hard $REMOTE/$BRANCH ---"
git reset --hard "$REMOTE/$BRANCH"

# 4) rebuild frontend(nginx 容器) — compose 文件在 docker/ 目录下
echo "--- docker compose build frontend ---"
docker compose -f docker/docker-compose.yml build --no-cache frontend
echo "--- docker compose up -d frontend ---"
docker compose -f docker/docker-compose.yml up -d frontend

# 5) 检测 server 容器里的代码是否变了(改了 server/* 路径则要 restart)
# 简单方法:对比 reset 前后 server/ 是否有 diff
# 这里简化为:每次都 restart server,代价是一次 503,用户刷新即可
# 如果想稳:不 restart,需要重启 server 容器来 pick up
echo "--- docker compose restart server ---"
docker compose -f docker/docker-compose.yml restart server || echo "WARN: server restart failed (may need manual)"

echo "UPDATE_DONE"
echo "=== done at $(date) ==="
