#!/usr/bin/env bash
# 部署宝宝记录云同步 Worker（需要先 `npx wrangler login`）。可重复运行。
# 用法：bash /workspace/baby-app/sync/deploy.sh
# 注意：账号第一次部署时 wrangler 会交互式询问 workers.dev 子域名，请在终端里运行（非交互环境会失败）。
set -euo pipefail
export PATH="$HOME/.local/node22/bin:$PATH"   # wrangler 4 需要 Node 22+
cd "$(dirname "$0")/worker"
[ -d node_modules/wrangler ] || npm i -D wrangler@4
if ! npx wrangler whoami 2>&1 | grep -qi "logged in"; then
  echo "❌ wrangler 未登录：先运行  cd $(pwd) && npx wrangler login"; exit 1
fi
DB=baby-record-sync
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  out=$(npx wrangler d1 create "$DB" 2>&1 || true); echo "$out"
  id=$(echo "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
  if [ -z "$id" ]; then   # 已经建过：从列表里找
    id=$(npx wrangler d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s).find(d=>d.name==='$DB');console.log(x?x.uuid:'')})")
  fi
  [ -n "$id" ] || { echo "❌ 没拿到 D1 database_id"; exit 1; }
  sed -i "s/00000000-0000-0000-0000-000000000000/$id/" wrangler.toml
  echo "✅ D1 database_id = $id（已写入 wrangler.toml）"
fi
CI=1 npx wrangler d1 migrations apply "$DB" --remote
npx wrangler deploy 2>&1 | tee /tmp/baby-sync-deploy.log
url=$(grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' /tmp/baby-sync-deploy.log | head -1 || true)
if [ -n "$url" ]; then
  echo "健康检查：$(curl -s "$url/v1/health")"
  node ../add-item.js init --url "$url"
  echo "✅ Worker 地址：$url"
  echo "下一步：把 site/config.js 的 syncApi 设为 '$url'，推送 v1.4.0；手机在「设置 → 云同步」里粘贴密钥。"
fi
