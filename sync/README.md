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

## 一键计划写入云端（v1.5.0）

`node add-item.js plan paid|vaccine|checkup [--dry-run] [--birthday YYYY-MM-DD] [--include-optional]`（`plan-paid` 同 `plan paid`）：
用 App 同一个生成器（`site/js/paidvax.js` 通过 data: URL 加载；疫苗/体检从 `site/js` 导入）生成事项，09:00、提醒前一天20:00+当天08:00，
scheduleId 与 App 完全一致；跳过已过的、云端已有同 scheduleId 的和备选/可选项。生日默认取云端宝宝资料。

`add` 也支持 `--category paidvax` 和 `--schedule-id paid:xxx`（同 scheduleId 已在云端则不重复添加）。

### 刷新已有计划事项的备注
`node add-item.js refresh-notes checkup|vaccine|paid [--dry-run]`：生成器的备注更新后（如体检补充了孤独症初筛、髋关节等），
按 scheduleId 原地更新云端已有事项的备注。只改 note 和 updatedAt，id、日期、时间、提醒、已完成、已设闹钟都保留；
备注被手动改过（不是生成器格式）的会跳过；不会新增事项。备注不参与闹钟签名，所以「已设闹钟」不会变成「需重设」。

### 补充接种窗口（v1.6.0）
`node add-item.js refresh-windows [all|vaccine|paid|checkup] [--dry-run] [--birthday YYYY-MM-DD]`：给云端已有的计划事项补上/更新
`earliest`（最早）、`latest`（最迟，可空）、`windowNote`（说明），按 scheduleId 匹配生成器。只改这三个字段和 updatedAt
（= max(现在, 原 updatedAt+1)），计划日期/时间、备注、提醒、已完成、已设闹钟都不动；不新增事项；重复运行是幂等的（已是最新的跳过）。
`date`/`time` 仍是计划日期/时间，所以闹钟签名不变，不会误标「需重设闹钟」。`plan` 新写入的事项直接带窗口；`add` 可加 `--earliest/--latest`。
v1.5.0 及更早的 App 不认识这三个字段（编辑后会丢掉），v1.6.0 会按 scheduleId + 生日重新推算显示，不影响使用。
测试：`node test/refresh-windows.local.mjs`（本地 Worker，临时密钥）。
