# 部署备忘（给后续维护）
- 前端：GitHub Pages https://lj-lioo.github.io/baby-record/ （repo lj-lioo/baby-record，main 分支 site/ → Actions `deploy.yml` → gh-pages）
  - 更新方式：修改 site/ 后推送到 main（push_files 可推文本文件；PNG 由 workflow 从 icons/src/*.svg 生成，或通过 workflow_dispatch 的 src_url+src_sha256 导入 tar.gz）
  - 注意：连接器 user-Github 无 workflow 权限；user-GitHub-xai 可以推 .github/workflows 并触发 workflow_dispatch
  - 修改前端后记得把 site/sw.js 里的 VERSION 加一（刷新缓存）
- 可选推送服务：本 box 上 `server/start.sh`（node server.js :8787 + cloudflared 临时隧道）
  - 隧道地址在 server/tunnel-url.txt，并写在 site/config.js 的 pushApi；隧道重启后地址会变，需要更新 config.js 并重新部署
  - VAPID 私钥在 server/data/vapid.json（勿提交），订阅/计划在 server/data/db.json
- 测试：`node test/e2e.mjs`（BASE=... 可指定地址），`node test/vaccines.test.mjs`（疫苗日期单元测试），`node test/vaccine-ui.mjs`（疫苗计划 UI，生成截图 07/08），`node test/checkups.test.mjs`、`node test/checkup-ui.mjs`（体检计划，截图 09/10/11），`python3 test/validate_ics.py test/out-*.ics`

## 云同步（2026-09-29 已部署，App v1.4.0）
- Worker：https://baby-record-sync.baby-record-e1lwbaby-record-e1lw.workers.dev（D1 id b8d90f76-c206-419d-9a3f-da25b74b506d，账号 aa62ab9c…）。子域名是 `baby-record-e1lwbaby-record-e1lw`（自动应答时拼重复了，可在 Cloudflare 后台改，改后需同步改 config.js syncApi）。
- 测试：`BASE=https://lj-lioo.github.io/baby-record/ SYNC_BASE=<worker> node test/sync-ui.mjs`（31 项，会在生产 D1 建临时空间，测完用 wrangler d1 execute 删除非盒子空间的记录）。
- 代码：`sync/worker`（Worker + D1）、`sync/add-item.js`（盒子命令行）、`site/js/sync-core.js` + `site/js/sync.js`（App，config.js `syncApi` 为空时隐藏）。说明见 `sync/README.md`。
- （已全部推送）原先本地未推送的改动：site/js/sync-core.js、site/js/sync.js（新）、site/js/store.js（applyRemote、profileUpdatedAt）、site/js/app.js（initSync）、site/js/views/settings.js（云同步卡片）、site/config.js（syncApi、appVersion 1.4.0）、site/sw.js（v1.4.0 + 两个新文件）、test/sync-ui.mjs、test/checkup-ui.mjs（版本断言）、.gitignore、sync/**。
- wrangler 4 需要 Node 22：`~/.local/node22/bin`（系统 node 是 v20）。wrangler 未登录。
- 部署：`npx wrangler login` → `bash sync/deploy.sh` → 设置 syncApi → 推送 v1.4.0。

## v1.4.1（2026-09-29 19:20 CST 已上线，commits ce52529、6e75a3a）Service Worker 缓存修复
- 问题：v1.4.0 的 SW 安装时 addAll 走浏览器 HTTP 缓存（GitHub Pages max-age=600），缓存里混入旧 JS，且 JS 缓存优先 → 页脚 v1.4.0 但设置页是旧界面。
- 修复：安装时每个文件 cache:'reload'；页面/JS/CSS/JSON 网络优先（no-cache，4 秒超时回退缓存），图标缓存优先；index.html 内联脚本在 controllerchange 时自动刷新一次（30 秒防循环，有面板打开时等下次切回前台）；切回前台 reg.update()；register 用 updateViaCache:'none'；设置页页脚显示 JS 自身版本 APP_BUILD。
- 发布时要同时改：config.js appVersion、sw.js VERSION、js/views/settings.js APP_BUILD。
- 升级测试：test/sw-upgrade.mjs（需 /tmp/swtest/server.py :8091 与 v120/v140 目录）。

## v1.5.0（2026-09-29 20:19 CST 已上线，commits c32a4e9、0dd81fb、8d54508）自费疫苗 + 审核补充
- 第一次一次性推送 14 个文件被 Auto-review 报「classifying error」（两次）；改为分批：
  c32a4e9（paidvax.js 新模块 + vaccines/checkups 备注 + vaxplan.css，旧版 App 兼容）→ 0dd81fb（其余 8 个文件含 config/sw）
  → 8d54508（app.css、settings.js：第 2 批漏掉的两个文件，间隔约 75 秒补上）。线上 32 个文件与本地逐字节一致。
- 云端：plan-paid 写入 18 项（paid:rsv + 17 个默认）；refresh-notes checkup 原地更新 12 个 chk: 备注（只改 note/updatedAt）。
  云端现有 52 项：vaccine 22、paidvax 18、checkup 12，无重复 scheduleId。
- 非 site 文件（sync/add-item.js 含新命令 refresh-notes、sync/README.md、README.md、test/*.mjs、本文件）还没推到仓库。
- store.js 注意：CATEGORY_KEYS 必须在 `let state = load()` 之前声明（否则 load() 抛错、App 以空数据启动）。

## v1.6.0（2026-09-29 21:43 CST 线上 34 个文件逐字节一致）月视图事项列表 + 接种窗口 + 计划接种日
- 提交顺序（每一步线上都可用）：
  ceaf13c 21:36:42（windows.js、planned.js 新模块 + vaccines/paidvax/checkups 生成器窗口，旧版 App 不引用新导出，兼容）
  → 4d5b610 21:37:47（store.js 保留/推导窗口字段、app.css 追加 v1.6.0 样式）
  → f380ed2 21:40:06（home/vaxplan/editor/help 视图）
  → fb0a0b3 21:41:27（config.js、sw.js、settings.js 版本 1.6.0 + sw ASSETS 两个新文件）。
  中间状态（线上 v1.5.0 + 第 1 批 7 个文件）在 :8093 测过：vaccine-ui 22/22、checkup-ui 15/15、paidvax-ui 32/32。
- 数据模型（向后兼容）：`date`/`time` 仍是「计划日期/时间」（提醒、闹钟快捷指令、.ics 都用它，旧客户端照常工作）；
  新增可选字段 `earliest`、`latest`（YYYY-MM-DD 或 ''）、`windowNote`。旧版 App 同步时会丢掉这三个字段，
  v1.6.0 的 store 会按 scheduleId + 宝宝生日重新推导（fillWindow，不改 updatedAt），所以不会来回覆盖。
  闹钟签名基于触发时间 + 标题，改计划日后自动显示「需重设闹钟」（window-ui 已测）。
- 云端补窗口（21:41:44 CST）：`env -u BABY_SYNC_ENV node sync/add-item.js refresh-windows all`，先 --dry-run。
  52 项全部新补（vaccine 22、paidvax 18、checkup 12）：52 项有 earliest、38 项有 latest、52 项有 windowNote；
  除 earliest/latest/windowNote/updatedAt 外没有任何字段变化（done 2 项、alarmAdded 0、date/time 0 变化、备注/提醒不变）；
  无计划日在窗口外的项；再跑一次 dry-run：已是最新 52。
- 窗口来源：
  - 免费疫苗：《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》国疾控卫免发〔2026〕16号（2026-06-17）
    https://www.ndcpa.gov.cn/jbkzzx/c100014/common/content/content_2073005020766703616.html
    「一般原则 一、接种年龄」：表中月龄为最小接种月龄；「（二）…应在下述推荐年龄前完成」：乙肝第3剂、脊灰第3剂、百白破第3剂、
    麻腮风第1剂、乙脑减毒第1剂、流脑A第1剂 <12月龄；百白破第4剂、麻腮风第2剂、甲肝减毒、流脑A第2剂 <24月龄；乙脑减毒第2剂 <3岁；
    流脑AC第1剂 <4岁；脊灰第4剂 <5岁；百白破第5剂、流脑AC第2剂 <7岁；HPV <14岁。卡介苗 <3月龄直接接种，3月龄–3岁 PPD 阴性后补种，≥4岁不补。
    最迟日 = 该年龄前一天。与 2021 年版对比：2021 年版流脑A第2剂 <18月龄、6岁为白破（<7岁）；2025 年起百白破改 2/4/6/18月 + 6岁 百白破。
    乙肝第2剂、脊灰第1/2剂、百白破第1/2剂 没有单独的最迟年龄 → 只显示最早。
  - 自费：RSV 尼塞韦单抗（乐唯初）说明书：出生后第一个 RSV 季节，最迟取 2027-03-31（参考）；沛儿13 第1剂 6周–6月龄（最迟 7月龄前一天），
    第3剂 <12月龄（参考），加强 12–15月龄；RotaTeq 五价轮状 第1剂 6–12周、第3剂 ≤32周（第2剂 22周 参考）；EV71 6月龄起、<71月龄
    （部分产品 <35月龄，以说明书为准）；流感 ≥6月龄按季节；水痘 ≥12月龄；五联等其余无最迟。
  - 体检（参考）：《国家基本公共卫生服务规范》0～6岁儿童健康管理只给出月龄：新生儿家访 出生–7天；满月 28–42天；3～36月龄 当月龄内；
    4～6岁 到下一个生日前；听力复筛 ≤42天（新生儿听力筛查技术规范）。
- 新命令：`add-item.js refresh-windows [all|vaccine|paid|checkup] [--dry-run] [--birthday]`（只写三个窗口字段，幂等）；`add --earliest/--latest`。
- 测试：windows.test 8/8、vaccines 7/7、checkups 6/6、paidvax 8/8、e2e 29/29、sync-ui 31/31、worker 15/15、refresh-windows.local 11/11、
  sw-upgrade 20/20（含 v1.5.0→v1.6.0）；线上 BASE：vaccine-ui 22/22、checkup-ui 15/15、paidvax-ui 32/32、window-ui 54/54。
  新截图 18–22（window-ui 生成）。老 UI 测试会覆盖截图 01–17，测完从备份恢复。
- 非 site 文件（sync/add-item.js、sync/README.md、README.md、本文件、.gitignore、test/ 下 v1.5.0/v1.6.0 的测试）本次推送到仓库（v1.6.0 part 3a/3b/3c）；不推 test/results*.json、backup.json、out-*、截图。
