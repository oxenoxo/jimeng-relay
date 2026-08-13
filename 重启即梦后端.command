#!/bin/zsh
# 双击此文件即可重启即梦后端，并同步刷新公网隧道
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/Users/oxohuang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PORT="3456"
BACKEND_LOG="/tmp/jimeng-backend.log"
SUPERVISOR_LOG="/tmp/jimeng-startup.log"
URL_FILE="$HOME/jimeng-url.txt"

cd "$DIR" || exit 1

# 从项目 .env 读取 PORT/JIMENG_TOKEN/JIMENG_ACCESS_PASSWORD，不把凭据写进启动器
if [[ -f "$DIR/.env" ]]; then
  set -a
  source "$DIR/.env"
  set +a
fi
PORT="${PORT:-3456}"
OLD_URL="$(cat "$URL_FILE" 2>/dev/null || true)"

clear
echo "=========================================="
echo "       即梦中转站 · 后端与隧道重启"
echo "=========================================="
echo ""
echo "[1/4] 停止旧服务与旧隧道..."

# 只停止当前项目相关进程，不影响其他 Node 服务
OLD_SUPERVISORS=($(pgrep -f "$DIR/scripts/startup.sh" 2>/dev/null || true))
for PID in "${OLD_SUPERVISORS[@]}"; do
  [[ "$PID" != "$$" ]] && kill "$PID" 2>/dev/null || true
done
pkill -f "node $DIR/app.js" 2>/dev/null || true
pkill -f "tunnelmole $PORT" 2>/dev/null || true
sleep 2

echo "[2/4] 启动后端与隧道守护..."
if [[ ! -x "$NODE" ]]; then
  echo "      找不到 Node: $NODE"
  read -r "REPLY?按回车退出..."
  exit 1
fi

# startup.sh 会同时启动后端、创建新 Tunnelmole 地址、同步 GitHub latest.json
nohup "$DIR/scripts/startup.sh" > "$SUPERVISOR_LOG" 2>&1 </dev/null &
SUPERVISOR_PID=$!
echo "      守护 PID: $SUPERVISOR_PID"

echo "[3/4] 等待后端健康与新隧道地址..."
READY=0
NEW_URL=""
for i in {1..60}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    CANDIDATE="$(cat "$URL_FILE" 2>/dev/null || true)"
    if [[ -n "$CANDIDATE" && "$CANDIDATE" != "$OLD_URL" ]]; then
      if curl -fsS --connect-timeout 3 "$CANDIDATE/api/health" >/dev/null 2>&1; then
        NEW_URL="$CANDIDATE"
        READY=1
        break
      fi
    fi
  fi
  sleep 1
done

echo "[4/4] 更新线上入口..."
echo ""
if (( READY == 1 )); then
  echo "✅ 后端与隧道已重启"
  echo "   本地地址: http://localhost:${PORT}"
  echo "   当前公网: $NEW_URL"
  echo "   固定入口: https://oxenoxo.github.io/jimeng-relay-domain/"
  echo "   GitHub 同步: 已由隧道守护脚本完成"
else
  echo "⚠️ 后端可能已启动，但新隧道还未就绪"
  echo "   请查看日志: $SUPERVISOR_LOG"
  echo "   当前记录: $(cat "$URL_FILE" 2>/dev/null || echo '暂无')"
fi

echo ""
echo "此窗口保持打开，可查看重启日志。按 Ctrl+C 只关闭日志查看，不停止服务。"
echo ""
tail -f "$SUPERVISOR_LOG"
