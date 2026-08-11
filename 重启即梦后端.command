#!/bin/zsh
# 双击此文件即可重启即梦后端
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/Users/oxohuang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PORT="3456"
LOG="/tmp/jimeng-backend.log"

cd "$DIR" || exit 1

# 从项目 .env 读取 PORT/JIMENG_TOKEN，不把凭据写进启动器
if [[ -f "$DIR/.env" ]]; then
  set -a
  source "$DIR/.env"
  set +a
fi
PORT="${PORT:-3456}"

clear
echo "=========================================="
echo "       即梦中转站 · 后端快速重启"
echo "=========================================="
echo ""
echo "[1/3] 停止旧后端..."

# 只匹配当前项目的 app.js，避免误杀其他 Node 服务
OLD_PIDS=($(pgrep -f "$DIR/app.js" 2>/dev/null || true))
if (( ${#OLD_PIDS[@]} > 0 )); then
  kill "${OLD_PIDS[@]}" 2>/dev/null || true
  sleep 1
  echo "      已停止旧进程: ${OLD_PIDS[*]}"
else
  echo "      没有发现旧后端进程"
fi

echo "[2/3] 启动后端..."
if [[ ! -x "$NODE" ]]; then
  echo "      找不到 Node: $NODE"
  echo ""
  read -r "REPLY?按回车退出..."
  exit 1
fi

export NODE_PATH="$DIR/node_modules"
"$NODE" "$DIR/app.js" > "$LOG" 2>&1 &
BACKEND_PID=$!

echo "      PID: $BACKEND_PID"
echo "      日志: $LOG"

echo "[3/3] 等待健康检查..."
READY=0
for i in {1..15}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

echo ""
if (( READY == 1 )); then
  echo "✅ 后端已启动"
  echo "   本地地址: http://localhost:${PORT}"
  echo "   API 地址: http://localhost:${PORT}/api"
  echo ""
  echo "隧道不会被此启动器关闭；如果公网地址失效，请打开 startup.sh 重新启动隧道守护。"
else
  echo "❌ 后端启动失败，请查看日志："
  echo "   $LOG"
fi

echo ""
echo "此窗口保持打开，可查看实时日志。关闭窗口不会自动停止后端。"
echo "按 Ctrl+C 只会关闭日志查看，不会停止后端。"
echo ""
tail -f "$LOG"
