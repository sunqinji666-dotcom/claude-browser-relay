#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:?Usage: bash scripts/deploy-shared-instance.sh user@host instance-name port [token]}"
INSTANCE_NAME="${2:?Usage: bash scripts/deploy-shared-instance.sh user@host instance-name port [token]}"
PORT="${3:?Usage: bash scripts/deploy-shared-instance.sh user@host instance-name port [token]}"
TOKEN="${4:-}"

if [[ ! "$INSTANCE_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Instance name 只能包含字母、数字、下划线和中划线"
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="claude-browser-relay-${INSTANCE_NAME}"
PM2_NAME="claude-browser-relay-${INSTANCE_NAME}"
PUBLIC_HOST="${REMOTE#*@}"
PUBLIC_HOST="${PUBLIC_HOST%%:*}"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(node -e "console.log(require('crypto').randomUUID())")"
fi

echo "部署独立 relay 实例"
echo "Remote: $REMOTE"
echo "Remote dir: ~/$REMOTE_DIR"
echo "PM2 name: $PM2_NAME"
echo "Port: $PORT"
echo "Public host: $PUBLIC_HOST"

TEMP_DIR="$(mktemp -d)"
mkdir -p "$TEMP_DIR/$REMOTE_DIR"
cp "$PROJECT_ROOT/server/package.json" "$PROJECT_ROOT/server/package-lock.json" "$PROJECT_ROOT/server/index.mjs" "$TEMP_DIR/$REMOTE_DIR/"

scp -r "$TEMP_DIR/$REMOTE_DIR" "$REMOTE:~/"

ssh "$REMOTE" "bash -s" << ENDSSH
set -euo pipefail
cd ~/$REMOTE_DIR
npm install --production
printf '%s\n' '$TOKEN' > .token
pm2 stop '$PM2_NAME' 2>/dev/null || true
pm2 delete '$PM2_NAME' 2>/dev/null || true
RELAY_PORT='$PORT' RELAY_TOKEN='$TOKEN' pm2 start index.mjs --name '$PM2_NAME' --interpreter node
pm2 save
echo ''
echo '部署完成'
echo 'PM2: $PM2_NAME'
echo 'Server URL: ws://$PUBLIC_HOST:$PORT'
echo 'Token: $TOKEN'
ENDSSH

rm -rf "$TEMP_DIR"

echo ""
echo "给朋友的信息："
echo "Server URL: ws://$PUBLIC_HOST:$PORT"
echo "Token: $TOKEN"
echo ""
echo "注意：还需要在腾讯云安全组放行 $PORT/TCP"
