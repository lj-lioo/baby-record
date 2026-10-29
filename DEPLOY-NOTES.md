## v1.13.3（相册上传进度：先出缩略图再传原图）
- 体验：选完图后立刻把本地缩略图插进时间轴（角标「上传中」），顶部进度条保持到原图上传结束（「已处理 1/3，上传中…」「上传中 2/3」）；失败明确 toast，可点「补传原图」。
- `photos.js`：`addPhotoFromFile` / `addVideoFromFile` 先 upsert `remoteReady=false` 再加密上传；`isUploading` 本机角标；`retryUpload` 带进度且失败抛错。
- `album.js`：进度条贯穿整批上传；补传按钮显示「补传中…」/失败文案。
- 版本：config / sw / settings → 1.13.3。

## v1.13.2（修：从相册选图后什么都不出现）
- 根因：file input 在相册页 DOM 里；iOS 从照片选择器返回触发 visibilitychange/同步 → render() 重建相册 DOM，旧 input 被替换，change 处理丢失，静默无反应。服务端（Tunnel/CORS/PUT/GET）curl 验证正常。
- 修：三个 file input 改为挂在 body 常驻；选完先 toast「正在处理」；HEIC/空 MIME 按扩展名识别；createImageBitmap 失败回落 <img> 解码并给出明确报错。
## v1.13.1（国内同步域名 + 照片 HTTPS 默认）
- **背景**：域名 `jiayouzhaozhao.cn` 落在 Cloudflare 账号 4678aa04…（Google/Nbacba…）；旧 Worker+D1 在另一账号 aa62ab9c…（163）。自定义域名必须与 Worker 同账号，故在域名账号重建 Worker/D1 并迁数据。
- **同步**：Worker `baby-record-sync`（新账号）+ D1 `b72d832b-751d-46cd-ab37-8c1d762112a3`；从旧 D1 迁入 169 条 records（两空间）。Workers 自定义域名 `sync.jiayouzhaozhao.cn`（自动 AAAA 100::）。`curl https://sync.jiayouzhaozhao.cn/v1/health` → 200。
- **App**：`site/config.js` syncApi → `https://sync.jiayouzhaozhao.cn`；默认 photoApi → `https://photo.jiayouzhaozhao.cn`（`photos.js` / 设置页回落）；版本 config/sw/settings → 1.13.1。亲友身份（v1.13.0）保留未回退。
- **盒子**：`~/.config/baby-record/sync.env` 仅改 BABY_SYNC_URL（密钥未动）。
- **照片 Tunnel**：MCP 无 Tunnel 写权限，**未**创建 cloudflared；步骤见 `docs/photo-tunnel.md`。DNS/connector 需用户在域名账号补齐；补齐前公网 photo HTTPS 不可用。
- **旧 Worker**：`*.baby-record-e1lwbaby-record-e1lw.workers.dev` 仍存活（旧账号），可作备份；App 已切新域名。
- **日后 wrangler**：需 `wrangler login` 到域名所在账号（4678aa04…），`wrangler.toml` database_id/routes 已指向新库与 sync 域名。

## v1.13.0（亲友身份 + 邀请链接一期）
- 六种本机身份：爸爸/妈妈（管理员）· 爷爷/奶奶/姥姥/姥爷（亲友浏览+相册上传下载）。
- 设置「亲友团」：管理员可切换身份、生成 `#/join?role=…&exp=…&sig=…` 邀请（约7天；**不含同步密钥**）；老人设置页只看身份说明。
- UI 拦截：老人不能新建/编辑/删除事项、改计划、设闹钟、改宝宝资料/密钥/照片服务；相册仍可上传与「下载原片」。
- 新模块 `site/js/roles.js`；首装引导选身份；版本 config/sw/settings → 1.13.0。
- 文档 `docs/family-roles.md` 与上述六角色对齐。测试 `test/roles-ui.mjs`。

## v1.12.15（相册「第X天」次要字号，去掉「N 项」）
- 分组标题主文仍是「昨天 / 10月27日」；「第X天」改成 muted small（与原先计数同级）。
- 去掉分组后「· N 项」计数。
- 版本：config / sw / settings → 1.12.15；测试 album-day-ui；截图 69。

## v1.12.14（相册时间轴「第X天」+ 亲友权限方案）
- 相册分组标题：相对日/日期 +「第X天」（出生当天＝第1天），例「昨天 第42天」「10月27日 第41天」。
- `photos.js`：`dayNumberOnDate` / `fmtAlbumDayTitle`；`album.js` 分组 h2 使用。
- 亲友团身份+权限：仅方案文档 `docs/family-roles.md`，本版不写完整权限代码。
- 版本：config / sw / settings → 1.12.14；测试 `test/album-day-ui.mjs`（屏蔽 SW）；截图 67/68。

## v1.12.13（照片服务：说清 HTTPS→HTTP 混合内容限制）
- 根因：App 在 `https://lj-lioo.github.io`，`fetch(http://192.168.x.x:8789/health)` 被浏览器当混合内容拦截；Safari 顶栏打开同一 URL 正常。CORS、`/health` 路径无误；photo-server 已允许 GitHub Pages Origin。
- 改动：`pingPhotoServer` 预判并提示；设置页文案；album 错误文案；photo-server README 纠正「填局域网 http 即可」。
- 可行方案：域名 + Cloudflare Tunnel 给照片服务 HTTPS 地址；不能靠「App 改挂局域网 http」（crypto.subtle 需要安全上下文）。
- 版本：config / sw / settings APP_BUILD → 1.12.13。

## v1.12.4（日程卡片精简 + 近期提醒详情面板 + 待完成/已完成分组）
- home.js itemCard：💡替代提示 / ℹ️窗口说明 / 📝备注 折叠进「显示详情 ▾ / 收起 ▴」（ui.details）；点🪟窗口聚焦时窗口说明仍直接显示。
- 近期提醒点击 → openEventDetail 底部面板（完整信息，⏰设为闹钟提醒 / ✅已完成 / 关闭；无改日期）；ui.js openSheet 支持顶部下拉关闭。
- 事项列表「待完成（N）」默认展开可折叠（点日历日期自动展开），「已完成（N）」默认折叠。
- 测试 home-compact-ui（16 项，SW 屏蔽）、window-ui 60/60、paidvax-ui 66/66；截图 55/56。commits 2104f98、f4a2b71。

## v1.12.3（用药频次排序 + K1 药丸进度 + 益生菌合并 + 生长标签顺序）
- 在用按频次：每日→未知→每周→每月（growth.js medFreqRank，可用 freq 字段覆盖），同频次按开始日先后。
- 药品 series 字段关联日历 scheduleId「series:N」；medDoses 统计总数/已完成，药丸蓝=已用、灰=未用，「已用 X/共 N 次」；K1（口服）series=vitk。
- 云端：益生菌合并为 10月5日起一天两袋（id …jucfay），删除 3 条碎片（tombstone）；备份 /tmp/meds-backup-1123.json。新增 CLI meds-delete。
- 生长页标签：身高/体重/头围/记录列表，默认身高曲线。测试 meds-pills-ui（SW 屏蔽），截图 54。
- commits 29198b8、571969a、a402d6a。

## v1.12.1（生长/用药同步漏拉修复）
- 根因：云端其实已有 33 条 gr: + 7 条 md:；手机若在认识这些前缀之前就把 sync cursor 推过去，之后再也不会重拉，生长页一直空。
- 修复：版本升级时把 cursor 归零（保留 acked，已有记录不会重复覆盖错）；并重推 40 条抬高 updatedAt，让仍停在旧 cursor 的设备点「立即同步」也能收到。
- 操作：关 App 再开到 v1.12.1 → 设置看云同步；若失败开 VPN 后点「立即同步」。


## v1.11.2（点一下说话 + 主屏幕名「家有朝朝」）
- 语音按钮改为点按制：点一下开始识别，再点一下结束；文案「🎙️ 点一下说话」/「🔴 正在听…再点一下结束」。
- 保留每次启动前 abort、15s 看门狗、结束后 1.5s 强制复位、连续失败 2 次降级键盘🎤、结果追加。
- PWA 主屏幕名：manifest name/short_name、index title、apple-mobile-web-app-title →「家有朝朝」；帮助页注明 iOS 需删旧图标再添加。
- 测试：voice.test / voice-hold-ui（5 次点开始→结束）/ voice-ui。

## v1.10.0（相册视频 + 省流量）
- 相册「从相册选择」accept image/*,video/*；新增「录视频」。视频 4MB/块分别 AES-GCM（AAD=id:n）→ photo-server `PUT /v1/video/:id/:n`；封面首帧+时长+大小走云同步元数据。
- 视频绝不自动下载：点开显示「播放（约 xxMB）」，点了才分块下载解密；本机 IndexedDB 缓存 `v:<id>`，上限 videoCacheMB(500) 先删最早，未上传的不删；videoMaxMB(200) 超限拒绝。
- photo-server 1.10.0：视频分块、Range、流式读；极空间需重建容器。测试 test/video-ui.mjs（需 /tmp/bv.webm，ffmpeg 生成）；截图 46–50。
- 未做客户端压缩（WebCodecs 需额外 mp4 封装库且 iOS 可靠性存疑）。

## v1.9.4（日历：被自费替代的免费疫苗针标打红叉）
- 已计划五联/流脑结合/甲肝灭活/乙脑灭活等时，对应免费剂次在月历紫针上叠小红叉（`.vbadge.replaced`）；移出计划后红叉消失。
- 列表卡片「可不打此剂」提示保留；图例第二行加「已被自费替代可不打」。
- 版本：config / sw / settings → 1.9.4；测试 `paidvax-ui` 增红叉断言；截图 45。

## v1.9.3（宝宝名字 + 已出生日龄）
- 左上角标题：可设宝宝名字/小名（未填仍显示「宝宝记录」）；副标题「已出生第N天/月龄」+ 今日日期；点标题可编辑。
- 日龄与生长记录 `ageOnDate` 一致：出生当天＝第1天。
- 设置页新增「宝宝资料」卡；名字+生日走现有 profile 云同步。
- 版本：config / sw / settings → 1.9.3；测试 `test/profile-ui.mjs`；截图 43/44。

## v1.9.2（日程：未完成置顶 + 已完成默认折叠）
- home.js `renderMonthList`：本月未完成按日分组在上；已完成整段「已完成 · N 项 ▸」默认收起，点开展开；点日历某日若仅有已完成则自动展开并滚到该日。
- 版本：config/sw/settings → 1.9.2；window-ui 增折叠断言；截图 42-done-fold-expanded.png。

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

## v1.7.1（2026-10-06 18:06 CST 线上 40 个文件逐字节一致）重设闹钟时自动删除旧的
- 问题：改计划日后「需重设闹钟」，再点「⏰ 设为闹钟提醒」，快捷指令「宝宝闹钟」又新建一套紧急提醒，旧的还在 → 重复响铃。
- 载荷（js/shortcuts.js，字段数不变，旧快捷指令照常工作）：每行 `yyyy-MM-dd HH:mm|【宝宝】…标题|类别 · 日期时间 · 提醒说明 · 备注：… · <宝宝#事项id>`。
  标记 `<宝宝#id>` 在备注（最后一个字段）末尾，同一事项每行相同；id 只含 0-9a-z（uid() 本来就是），非常规 id 用 `x`+djb2（base36）。
  快捷指令里用正则 `宝宝#[0-9a-z]+>` 取出（末尾 `>` 防止前缀误匹配）。测试闹钟带 `<宝宝#test>`。alarmSig 不变（不含备注）。
- 第二个快捷指令「宝宝闹钟删除」（= 设置里的名称 + 删除）：输入每行一个标记；匹配文本 → 重复每一项 → 查找提醒事项（列表 是 宝宝 且 备注 包含 重复项目，全部）
  → 如果 提醒事项 有任何值 → 移除提醒事项。没有标记的输入 = 0 次循环，什么都不删。「宝宝闹钟」最上面加「运行快捷指令 宝宝闹钟删除（输入 = 快捷指令输入）」。
  设置 → App → 快捷指令 → 高级 →「允许不确认直接删除」（不开也能用，每次弹确认）。步骤在 使用帮助 #h-replace（标「新增」），未在真机验证。
- 数据：事项新增 `alarmTagged`（v1.7.1 起点「打开快捷指令…」设的闹钟 = true；旧闹钟 false → 面板提示手动删除，不显示「删除旧闹钟」）。
- 界面：⏰ 面板（带标记时）按钮「打开快捷指令，替换为 N 个新闹钟提醒」+「🗑 删除旧闹钟」；删除事项 / 自费疫苗「移出计划」后，设过闹钟的弹「🗑 删除旧闹钟？」
  （带标记 → `shortcuts://run-shortcut?name=宝宝闹钟删除&input=text&text=<标记…>`；旧的 → 手动删除说明 + 标题列表）。改计划日面板说明按是否带标记区分。
- 提交：f7249e0 18:00:16（shortcuts.js、store.js）→ 01a14ab 18:01:19（actions.js、editor.js、planned.js）→ 9e1f8a9 18:02:13（paidcat.js）
  → caa5e11 18:03:48（help.js，「新增」样式内联在帮助页）→ d23cf84 18:05:04（settings.js、config.js、sw.js 版本 1.7.1）
  → 1c6496f 18:12:55（test/alarm-tag-ui.mjs 新、sync-ui.mjs、sw-upgrade.mjs）→ 9338048 18:13:53（window-ui.mjs）→ ae19ac2 18:14:47（paidvax-ui.mjs）→ d6afafa 18:15:18（README.md）→ 本文件。
- 测试（本地）：vaccines 7、checkups 6、paidvax 19、windows 8、vaccine-ui 22/22、checkup-ui 15/15、window-ui 54/54、sync-ui 31/31、paidvax-ui 61/61、
  alarm-tag-ui 37/37（新）、worker 15/15、refresh-windows.local 11/11、paid-cli.local 20/20、sw-upgrade 28/28（加 v1.7.0→v1.7.1）、
  e2e 20/22（2 项失败都是推送服务：server/ 没在运行、trycloudflare 隧道 dod-reno-routers-button 已失效，与本次改动无关）。
  线上 BASE：alarm-tag-ui 37/37、paidvax-ui 61/61、window-ui 54/54、vaccine-ui 22/22、checkup-ui 15/15、e2e 20/22（同上推送原因）。
  sync-ui：盒子环境变量里有 BABY_SYNC_KEY 时会覆盖测试用的临时配置，测试里已去掉（只用临时密钥）。
  新截图 27–31（alarm-tag-ui）：27-help-new-replace-alarm、28-help-new-delete-shortcut、29-help-new-run-shortcut-top、30-alarm-sheet-replace、31-delete-old-alarm-prompt。

## v1.7.2（2026-10-24 18:10 CST 线上 site 8 个关键文件逐字节一致）自费疫苗襄阳参考价 + 推荐指数
- 需求：自费疫苗目录与计划卡片缺少价格；用户在湖北襄阳。
- 价格来源（襄阳 vs 回退）：
  - **襄阳本地**：检索襄阳 / 襄阳市疾控 / 襄城区 / 樊城区「非免疫规划疫苗价格公示」——未见公开零售价目表（襄州区 2026 遴选仅有品类无单价）。
  - **回退**：湖北省「其他地市」挂网结算价（RSV 尼塞韦 50mg≈1878 / 100mg≈3186）+ 湖北门诊常见零售（五联≈625、13价国产≈623/进口≈723、五价轮状≈305、EV71≈213、水痘≈175、Hib≈114、流感儿童四价≈64–140、甲肝灭活≈126–170、乙脑灭活≈180–230、流脑 AC 结合≈110–178 / ACYW≈430–452）。
  - UI 标注：「襄阳参考价（湖北挂网/附近门诊常见价，以当地接种门诊为准）」；另收约 **20元/剂次** 接种服务费（鄂发改价调〔2022〕257号）。水痘在湖北仍自费（非江浙沪式免费）。
  - 始终同时展示 **每剂** 与 **全程总价**（如「每剂约 625 元 · 全程 4 剂约 2500 元」）。
- 推荐指数（非医疗建议，最终以门诊医生为准）：
  - ★★★★★ 强烈推荐：RSV尼塞韦、13价肺炎、五联、五价轮状、流感（满6月龄每季）
  - ★★★★☆ 推荐：EV71（湖北/中部手足口常见）、水痘
  - ★★★☆☆ 可考虑：流脑结合、甲肝灭活、乙脑灭活（免费程序升级替代）
  - ★★☆☆☆ 一般：单独 Hib（已打五联则不必）
- 实现：`site/js/paidvax.js` 新增 `PAID_PRICES` / `PAID_RECS` / `priceLine` / `recLine`（UI-only，备注仍禁止含「元/价格」）；`paidcat.js` 目录卡 ⭐推荐 + 💰参考价；`home.js` `.iprice`；`help.js`「怎么看推荐」；`app.css` `.pc-price` / `.pc-rec` / `.iprice`；版本 1.7.2（config.js / sw.js / settings.js APP_BUILD）。
- 测试（本地）：paidvax 20/20、paidvax-ui 63/63、sw-upgrade 32/32（加 v1.7.1→v1.7.2）。新截图 32–34：32-paid-catalog-prices、33-paid-item-price、34-help-paid-price。
- 提交：f398bfb（paidvax.js PAID_PRICES/PAID_RECS）→ 5fcafa7（paidcat.js、home.js、app.css）→ d6be88a（help.js）
  → 7a3f0c0（config.js、sw.js、settings.js 版本 1.7.2）→ 63bec0a（paidvax.test、paidvax-ui、sw-upgrade）→ ac34ef4（README）→ 本文件。

## v1.8.0（相册 + 极空间照片服务）
- 需求：App 加「相册」页；元数据（缩略图/说明/时间）走现有端到端云同步；原图 AES-GCM 加密后存极空间 Docker 小服务；暂不买域名（家里局域网 / 外出 VPN）。
- 新增：
  - `site/js/photos.js`（缩略图、IndexedDB 缓存、加密 PUT/GET）
  - `site/js/views/album.js`（时间轴相册 UI）
  - `site/js/sync-core.js`：`PHOTO_PREFIX` / `sealBytes` / `unsealBytes` / `keyFingerprint`
  - `site/js/store.js`：`photos[]`、`photoApi` 设置、`applyRemote` 支持相册
  - `site/js/sync.js`：同步 `ph:<id>` 元数据 + tombstone
  - `sync/photo-server/`：Node 服务 + Dockerfile + README（端口 8789，挂载 `/data`）
- 设置：「📷 照片服务」填 `http://192.168.x.x:8789`，可测试连接（本机设置，不同步）。
- 帮助：`#h-album`、`#h-nas`。
- 版本：config.js / sw.js / settings APP_BUILD → 1.8.0；sw ASSETS 加 photos.js、album.js。
- 测试：`node test/photos.test.mjs`（4）、`node sync/photo-server/test.mjs`（4）、`node test/album-ui.mjs`（9，截图 35–37）；回归 vaccines/paidvax/windows/checkups。
- 已知限制：无自定义域名时，云同步（workers.dev）与外出访问极空间都需要 VPN 或同网；家人权限与现网一致（同一同步密钥全能）。

## v1.9.1（相册选图：从相册 / 拍照分开）
- 问题：`file` input 带 `capture="environment"`，iPhone 上「＋ 上传」只会开相机，无法从相册多选。
- 改法：点「＋ 上传」弹出面板——「从相册选择」（`#filePhotoAlbum`，无 capture、可 multiple）与「拍照」（`#filePhotoCamera`，`capture="environment"`）；帮助文案同步；版本 1.9.1。
- 未改生长记录逻辑。测试：album-ui 13/13、growth-ui 12/12。

## v1.9.0（生长记录）
- 底部 Tab「📏 生长」：记录列表 + 身高/体重/头围曲线；右上角「添加」。
- 字段：date、height(cm)、weight(kg)、head(cm 可选)、note；日龄按 settings.babyBirthday（出生当天＝第1天）。
- 同步：`gr:` 前缀（sync-core `GROWTH_PREFIX`），type `growth`，删除 tombstone；与相册同一套端到端加密。
- **不做**参考图里的 AI 评语/「问问小伴」；列表仅「相对上次」增减 +「非医疗建议」。
- 曲线：纯 SVG，无外部 chart CDN。
- 版本：config / sw / settings APP_BUILD → 1.9.0；sw ASSETS 加 growth.js、views/growth.js。
- 测试：`node test/growth.test.mjs`（14）、`node test/growth-ui.mjs`（12，截图 38–41）。

## v1.11.0（一句话记事）
- 首页顶部「🎤 说一句话记事」→ 弹层大输入框（自动聚焦，主靠键盘听写）；支持 Web Speech 的浏览器额外显示「按住说话」（zh-CN，出错即隐藏）。
- `site/js/voice.js` 纯本地规则解析：日期/时间/中文数字/周X/下周X/X天后/月底/X号，已过取下一年（X号已过取下月），缺省今天；疫苗/体检/儿保/复查打分类；按 。！？；换行 拆多条。
- `site/js/views/voice.js` 确认卡（标题/日期/时间/类别可改、可删）→ `store.addEvents`（默认提醒，走云同步）；帮助 `#h-voice`。
- 测试：`node test/voice.test.mjs`（42）、`node test/voice-ui.mjs`（18，截图 52-voice-*）。提交 26f4bf0 → 71f116d。

## v1.12.0（用药记录 + 月子中心生长数据）
- 生长页曲线/列表下方新增「💊 用药记录」卡（md: 前缀同步，{name,dose,start,end,note}）；在用（无结束日或≥今天）排上，已停用/单次在下；可增删改、「今天停用」。
- 生长记录：身高/体重至少填一项即可保存（出生记录只有体重）；曲线点多于 12 个时只标首尾数值。
- add-item.js 新增 growth-list / growth-import CSV / meds-list / meds-import JSON（同日期 / 同药品+开始日更新不重复）。
- 云端写入：生长 33 条（09-17 出生 2.81kg … 10-23 4.32kg），用药 7 条。测试 test/meds-ui.mjs；截图 53。

## v1.12.2（修复同步 too_large）
- 根因：collectChanges 一次最多 500 条，但 ph: 带缩略图单条可达 ~32KB，几十张照片即超过 Worker 1MB 请求体上限 → 413 too_large，整轮失败，连带拉取也不执行。
- 前端 sync.js `takeBatch`：每批 ≤700KB 且 ≤300 条，循环最多 200 轮；单条 >32KB 先重压缩缩略图（240px/160px），仍超则跳过并提示「有 N 条数据太大未上传」。
- Worker：响应按约 2MB 字节分页（more=true），已 wrangler deploy（Node22：PATH=$HOME/.local/node22/bin）。
- 测试：test/sync-batch-ui.mjs（120 张缩略图共约 2MB + 33 gr + 7 md）。注意 Playwright 需 serviceWorkers:'block'，否则 SW 缓存的 config.js 绕过 route 打到生产。
- test/sync-ui.mjs 有 3 项与本次无关的旧失败（体检事项数断言 12 vs 实际 11），v1.12.1 同样失败。
