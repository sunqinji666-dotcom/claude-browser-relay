#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="/tmp/claude-browser-relay-friend-package"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

rsync -a "$PROJECT_ROOT/" "$OUT_DIR/" \
  --exclude ".DS_Store" \
  --exclude "node_modules" \
  --exclude "cli/*.jpg" \
  --exclude "server/.token" \
  --exclude ".browser-relay.json"

echo "已生成朋友交付包：$OUT_DIR"
echo "可以把这个文件夹压缩后发给朋友。"

