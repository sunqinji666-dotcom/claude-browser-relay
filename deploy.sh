#!/bin/bash
# Deploy Claude Browser Relay server to your cloud server
# Usage: bash deploy.sh user@host [port]

set -e

REMOTE="${1:?Usage: bash deploy.sh user@host [port]}"
PORT="${2:-25818}"

echo "=== Deploying Claude Browser Relay to $REMOTE on port $PORT ==="

# Package server files
TEMP_DIR=$(mktemp -d)
mkdir -p "$TEMP_DIR/claude-browser-relay"
cp server/package.json server/index.mjs "$TEMP_DIR/claude-browser-relay/"

# Upload
echo "Uploading..."
scp -r "$TEMP_DIR/claude-browser-relay" "$REMOTE:~/"

# Install and setup
ssh "$REMOTE" "bash -s" << ENDSSH
set -e
cd ~/claude-browser-relay
npm install --production 2>&1 | tail -1

# Generate token if not exists
if [ ! -f .token ]; then
  node -e "console.log(require('crypto').randomUUID())" > .token
fi
TOKEN=\$(cat .token)

# Stop existing if running
pm2 stop claude-browser-relay 2>/dev/null || true
pm2 delete claude-browser-relay 2>/dev/null || true

# Start with pm2 (auto-restart)
RELAY_PORT=$PORT RELAY_TOKEN=\$TOKEN pm2 start index.mjs --name claude-browser-relay --interpreter node
pm2 save

echo "======================================"
echo "Server started on port $PORT"
echo "Auth token: \$TOKEN"
echo "======================================"
echo ""
echo "On your local machine:"
echo "  Open Chrome extension popup"
echo "  Server URL: ws://YOUR_SERVER_IP:$PORT"
echo "  Token: \$TOKEN"
echo ""
echo "Or use the CLI:"
echo "  cd cli && npm install && node browserctl.mjs"
echo "  browser> connect ws://YOUR_SERVER_IP:$PORT \$TOKEN"
ENDSSH

rm -rf "$TEMP_DIR"
echo "=== Deploy complete ==="
