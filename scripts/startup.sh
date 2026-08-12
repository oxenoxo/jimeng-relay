#!/bin/bash
set -u
# 即梦中转站登录自启动：后端 + 隧道 + GitHub 最新域名同步
# 该脚本需要常驻运行；放进 macOS 登录项后，电脑登录期间会自动守护隧道

DIR="/Users/oxohuang/WorkBuddy/2026-08-10-20-13-18/jimeng-relay"
FETCHER_DIR="/Users/oxohuang/WorkBuddy/2026-08-10-20-13-18/jimeng-relay-domain"
NODE="/Users/oxohuang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
NPX="/Users/oxohuang/.workbuddy/binaries/node/versions/22.22.2/bin/npx"
TOKEN="2bd762d34e8988f51424f3cedc7604a2"
PORT="3456"
LOG="/tmp/jimeng-tunnel.log"
URL_FILE="$HOME/jimeng-url.txt"
if [[ -f "$DIR/.env" ]]; then
  set -a
  source "$DIR/.env"
  set +a
fi
TOKEN="${JIMENG_TOKEN:-$TOKEN}"
PORT="${PORT:-3456}"
ACCESS_PASSWORD="${JIMENG_ACCESS_PASSWORD:-}"

BACKEND_PID=""
TUNNEL_PID=""
cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM HUP EXIT

pkill -f "node $DIR/app.js" 2>/dev/null || true
pkill -f "tunnelmole $PORT" 2>/dev/null || true
sleep 1

cd "$DIR" || exit 1
env JIMENG_TOKEN="$TOKEN" JIMENG_ACCESS_PASSWORD="$ACCESS_PASSWORD" PORT="$PORT" NODE_PATH="$DIR/node_modules" "$NODE" "$DIR/app.js" > /tmp/jimeng-backend.log 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 15); do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
done

echo "即梦中转站后端已启动，开始守护隧道"
echo "最新域名获取器：https://oxenoxo.github.io/jimeng-relay-domain/"

auto_restart=0
while true; do
  : > "$LOG"
  cd /tmp || exit 1
  "$NPX" -y tunnelmole "$PORT" > "$LOG" 2>&1 &
  TUNNEL_PID=$!
  URL=""
  for i in $(seq 1 45); do
    sleep 1
    URL="$(grep -o 'https://[a-z0-9-]*\.tunnelmole\.net' "$LOG" | head -1 || true)"
    [ -n "$URL" ] && break
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
  done

  if [ -n "$URL" ]; then
    printf '%s\n' "$URL" > "$URL_FILE"
    if [ -x "$FETCHER_DIR/sync-domain.sh" ]; then
      "$FETCHER_DIR/sync-domain.sh" "$URL" > /tmp/jimeng-domain-sync.log 2>&1 || true
    fi
    echo "当前公网地址：$URL"
  else
    echo "隧道启动失败，5 秒后重试；日志：$LOG"
  fi

  wait "$TUNNEL_PID" 2>/dev/null || true
  auto_restart=$((auto_restart + 1))
  echo "隧道已断开，第 ${auto_restart} 次重连"
  sleep 5
done
