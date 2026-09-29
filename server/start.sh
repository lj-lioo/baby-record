#!/bin/bash
# 启动推送服务 + Cloudflare 临时隧道（trycloudflare.com）。隧道地址写入 tunnel-url.txt
cd "$(dirname "$0")"
mkdir -p logs
if ! pgrep -f "^node server.js" >/dev/null; then
  PORT=8787 setsid nohup node server.js >> logs/server.log 2>&1 < /dev/null &
fi
if ! pgrep -f "^/home/box/bin/cloudflared tunnel" >/dev/null; then
  : > logs/tunnel.log
  setsid nohup /home/box/bin/cloudflared tunnel --url http://localhost:8787 --no-autoupdate >> logs/tunnel.log 2>&1 < /dev/null &
  for i in $(seq 1 30); do
    u=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1)
    [ -n "$u" ] && break; sleep 1
  done
  echo "$u" > tunnel-url.txt
fi
cat tunnel-url.txt
