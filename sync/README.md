# 宝宝记录 · 云同步

**已部署（2026-09-29）**：Worker `https://baby-record-sync.baby-record-e1lwbaby-record-e1lw.workers.dev`（健康检查 `/v1/health`），D1 `baby-record-sync`；App v1.4.0 已启用。盒子密钥在 `~/.config/baby-record/sync.env`。

## 设计
- **后端**：Cloudflare Worker + D1（免费计划，无需绑卡）。代码 `worker/src/index.js`，表结构 `worker/migrations/0001_init.sql`，配置 `worker/wrangler.toml`。
- **同步密钥**：`brs1_` + 32 字节随机数，只存在各设备本地（手机 localStorage、盒子 `~/.config/baby-record/sync.env`，权限 600）。
  - HKDF 派生 ① 访问令牌：服务器只保存 `sha256(令牌)` 作为空间 id；② AES-GCM-256 加密密钥：每条记录在本地加密（AAD = id|updatedAt）。
  - 服务器（和 Cloudflare 账号里的 D1）只能看到：记录 id、修改时间、是否删除、密文。
- **协议**：`POST /v1/sync`，`Authorization: Bearer <令牌>`，`{since, changes:[{id, updatedAt, deleted, data}]}` → `{cursor, more, accepted, conflicts, changes}`。
  - 每条记录「最后写入者胜」（updatedAt 大的覆盖）；删除 = tombstone；每个空间内递增 seq 作为增量游标；每页 500 条。
  - 记录 id：`ev:<事项id>`（事项），`profile`（宝宝姓名/生日）。
- **App**：`site/js/sync-core.js`（密钥/加密/请求，浏览器与 Node 共用）、`site/js/sync.js`（打开时、修改后 1.5s、切回前台、恢复联网、前台每 2 分钟同步）。两台设备各自一键生成的计划按 scheduleId 去重。`config.js` 的 `syncApi` 为空时完全不显示、不请求。
- **盒子命令行**：`add-item.js`（见文件头的用法）。

## 本地测试
```bash
export PATH=~/.local/node22/bin:$PATH          # wrangler 4 需要 Node 22
cd sync/worker && npx wrangler d1 migrations apply baby-record-sync --local
npx wrangler dev --port 8788 --ip 127.0.0.1     # 另开终端
node test/worker.test.mjs                       # 协议测试 15 项
cd ../.. && node test/sync-ui.mjs               # 两台手机 + 命令行 端到端 31 项（需 :8080 静态服务）
```

## 部署（需要用户登录 Cloudflare）
1. `cd /workspace/baby-app/sync/worker && PATH=~/.local/node22/bin:$PATH npx wrangler login`（在盒子浏览器里登录/注册 Cloudflare 并点 Allow）
2. `bash /workspace/baby-app/sync/deploy.sh`（建 D1、写 database_id、执行迁移、部署、`add-item.js init --url …`）
3. 把 `site/config.js` 的 `syncApi` 设为 Worker 地址，推送 App v1.4.0。
4. 只有手机时：手机上 设置 → ☁️ 云同步 →「没有密钥？在这台设备上生成新密钥」→「生成新密钥并开启」→「复制密钥」，把密钥通过安全输入交给盒子（环境变量 `BABY_SYNC_KEY`），
   盒子上新开 shell 运行 `node add-item.js use-key`（写入 `~/.config/baby-record/sync.env`，只显示指纹；旧配置备份为 `sync.env.bak`）。
5. 或者由盒子出密钥给手机（密钥不经过聊天）：`node add-item.js pair --qr ~/.config/baby-record/pair.png` 生成二维码（内容是 `https://lj-lioo.github.io/baby-record/#pair=<密钥>`），在盒子屏幕上打开；
   iPhone 相机扫码 → Safari 打开 → 「复制同步密钥」→ 回主屏幕打开 App → 设置 → ☁️ 云同步 →「从剪贴板粘贴」→「连接并同步」。扫完删除 PNG。

注：新账号第一次 `wrangler deploy` 会交互式询问 workers.dev 子域名（非交互环境会直接失败）；本次用 pty 自动回答完成。

⚠️ `*.workers.dev` 在中国大陆被屏蔽：手机不开 VPN 时需要给 Worker 绑定托管在 Cloudflare 上的自定义域名（wrangler.toml 里的 routes）。
