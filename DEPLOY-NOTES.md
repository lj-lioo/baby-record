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
- 非 site 文件（sync/add-item.js、sync/README.md、README.md、本文件、.gitignore、test/ 下 v1.5.0/v1.6.0 的测试）本次推送到仓库（v1.6.0 part 3a–3d）；不推 test/results*.json、backup.json、out-*、截图。

## v1.7.0（2026-09-29 23:33 CST 线上 35 个文件逐字节一致）自费疫苗「待定」目录 + 按系列加入计划 + 顺延
- 需求：自费疫苗默认不排进日程（用户还没决定打不打五联等）；决定后「➕ 加入计划」，按说明书间隔自动排好全部剂次。
- 提交顺序（每一步线上都可用）：
  959d7cc 23:26:01（paidvax.js 只新增导出 SERIES/seriesPlan/reflowSeries/replacementHints…，新模块 views/paidcat.js 暂无引用）
  → 21cd29e 23:27:29（store.upsertEvents/deleteEvents、app.css 追加 v1.7.0 样式）
  → b422500 23:28:34（home.js：月列表下方「💰 自费疫苗（待定）」折叠卡片、免费剂次「可不打此剂」提示、系列剂次「已完成」可填实际接种日）
  → d1cf41e 23:29:21（planned.js、editor.js：改日期后「后续剂次一起顺延」）
  → 5c67135 23:30:36（vaxplan.js 去掉自费一键生成，旧设置按钮 openPaidPlan 打开待定目录；help.js 新增 #h-paid）
  → daf1bf4 23:32:00（settings.js「💰 自费疫苗（待定）」按钮 + APP_BUILD、config.js、sw.js 版本 1.7.0，sw ASSETS 加 paidcat.js）。
  中间状态在本地测过：:8093（线上 v1.6.0 + 第 1 批）旧 v1.6.0 测试 vaccine-ui 22、checkup-ui 15、paidvax-ui 32、window-ui 54、e2e 29；
  :8094（+ 视图）smoke 6/6（旧设置按钮打开新目录、加入/顺延可用、无 JS 错误）+ vaccine-ui 22、checkup-ui 15、e2e 29。
- 数据模型不变：系列剂次仍是普通事项，scheduleId `paid:<疫苗>-<n>`（RSV 为 `paid:rsv`，与 v1.5/1.6 相同），带 earliest/latest/windowNote。
  计划日＝max(推荐月龄日, 上一剂计划日＋推荐间隔)；最早＝max(最小月龄日, 上一剂＋最短间隔)；最迟＝min(按年龄最迟, 上一剂＋最长间隔)。
  顺延只改未完成的后续剂次（已完成的只作为下一剂起点）；顺延的剂次若设过闹钟，签名变化 → 自动显示「需重设闹钟」。
  「保持原计划」也会按实际上一剂日期更新后续剂次的最早/最迟。移出计划 = 删除未完成剂次（云同步删除标记），回到待定。
- 间隔表（宝宝 2026-09-17，从最早日开始）：
  | 疫苗 | 剂次 | 规则 | 例 |
  |---|---|---|---|
  | 五联 | 3+1 | 第1剂≥2月龄；第2/3剂最短28天、推荐+1个月；第4剂 max(18月龄, 第3剂+6个月) | 11-17、12-17（最早12-15）、2027-01-17、2028-03-17 |
  | 13价 | 3+1 | 第1剂≥6周（<7月龄）；第2/3剂最短28天、推荐+2个月，第3剂<12月龄（参考）；第4剂 max(12月龄, 第3剂+8周)，<16月龄 | 10-29、12-29、2027-02-28、2027-09-17 |
  | 五价轮状 | 3 | 第1剂6–12周；第2/3剂最短28天、推荐+1个月、最长+10周；第3剂≤32周 | 10-29、11-29、12-29 |
  | EV71 | 2 | ≥6月龄（<72月龄）；+1个月 | |
  | 流感（首次） | 2 | ≥6月龄，默认流感季 2027-09-20；+28天 | |
  | 水痘 | 2 | ≥12月龄；第2剂 max(4周岁, 第1剂+3个月)，最早第1剂+3个月 | |
  | Hib | 3+1 | 同五联（已计划五联时提示不要再打） | |
  | 流脑结合 | 1 | ≥3月龄，只排第1剂（各产品剂次不同） | |
  | 甲肝灭活 | 2 | 18月龄（<24月龄）；第2剂 max(24月龄, +6个月)（<36月龄） | |
  | 乙脑灭活 | 4 | 8月龄；+7天（最长+10天，<12月龄）；max(2周岁, +1个月)（<3岁）；max(6周岁, +3年)（<7岁） | |
  | RSV单抗 | 1 | 出生起，最迟 2027-03-31（参考） | |
  来源：沛儿13 说明书（首剂6周龄，间隔1～2个月/最少28天，12～15月龄加强）；潘太欣说明书（2、3、4 或 3、4、5 月龄 + 18 月龄，间隔≥28天，加强距第3剂≥6个月）；
  乐儿德 RotaTeq 说明书（6–12周起，间隔4–10周，≤32周）；EV71 灭活疫苗说明书；《中国流感疫苗预防接种技术指南》；《水痘疫苗预防接种专家共识》（中国疾控中心 2023：2剂，间隔≥3个月）；
  《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》（乙脑灭活 7–10天/1–12个月/≥3年、甲肝灭活、百白破≥28天）；尼塞韦单抗说明书。
- 替代提示：计划了五联 → 免费 百白破第1–4剂、脊灰第1–4剂卡片显示「💡 已计划五联，可不打此剂（以门诊为准）」，不自动删除；
  流脑结合 → 流脑A 第1–2剂；甲肝灭活 → 甲肝减毒；乙脑灭活 → 乙脑减毒第1–2剂。
- 云端迁移（23:32:25 CST，`env -u BABY_SYNC_ENV node sync/add-item.js prune-undecided`，先 --dry-run）：
  迁移前 52 项（vaccine 22、paidvax 18、checkup 12）；18 个自费项都不是已完成、没有设闹钟、日期/时间/标题/备注/提醒都是旧 `plan paid` 原样。
  保留 paid:rsv（用户选定，2026-10-17 09:00，最早 09-17、最迟 2027-03-31，updatedAt 1790689304257，前后 JSON 完全一致）；
  删除其余 17 个（pcv13-1..4、penta-1..4、rota5-1..3、ev71-1/2、flu-1/2、var-1/2），写入 17 个删除标记（updatedAt = max(现在, 原+1)），
  备份到本机 backups/paid-undecided-20260929.json（600 权限，不进仓库）。迁移后 35 项（vaccine 22、paidvax 1、checkup 12），非自费项完全不变。
  Worker 本来就支持删除标记（deleted: true，worker.test 覆盖），手机同步后这 17 项也会消失（v1.6.0 的 applyRemote 同样处理删除）。
- CLI：`plan paid` 只写 RSV（其余「待定」不写入）；新增 `paid-series <疫苗> --start YYYY-MM-DD [--time] [--dry-run]`、
  `paid-remove <疫苗> [--dry-run]`、`prune-undecided [--dry-run] [--backup file]`；`refresh-windows` 跳过系列管理的自费项。
- 测试（本地）：vaccines 7、checkups 6、paidvax 19、windows 8、e2e 29/29、vaccine-ui 22/22、checkup-ui 15/15、window-ui 54/54、sync-ui 31/31、
  paidvax-ui 60/60、worker 15/15、refresh-windows.local 11/11、paid-cli.local 20/20、sw-upgrade 24/24（含 v1.6.0→v1.7.0）。
  线上 BASE：paidvax-ui 60/60、window-ui 54/54、vaccine-ui 22/22、checkup-ui 15/15、e2e 29/29（sync-ui 线上需 https 的测试 Worker，未跑，避免在正式 Worker 留测试数据）。
  新截图 23–26（paidvax-ui 生成）：23-paid-catalog、24-paid-add-picker、25-month-list-penta、26-cascade-prompt。
