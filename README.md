# 宝宝记录 · baby-record

一个给 iPhone 用的宝宝日程 PWA（纯静态，默认数据只存在手机本地，无登录；可选端到端加密的云同步）。

**在线使用：** https://lj-lioo.github.io/baby-record/ （用 Safari 打开 → 分享 → 添加到主屏幕）

## 功能
- 月历：疫苗 / 体检 / 其他重要事项，疫苗日有 💉 标记
- 首页顶部醒目的「近期提醒」卡片（今天 / 明天 / 还有N天 / 已过N天），可标记已完成
- 每个事项可设置多个提醒：前一天 20:00、当天 08:00、提前1天/2小时/1小时/30分钟、准时、自定义时间
- **⏰ 设为闹钟提醒**：通过 iOS 快捷指令「宝宝闹钟」在「提醒事项」的「宝宝」列表中为每个提醒时间创建 **紧急** 提醒（iOS 26.2+，到点像闹钟一样全屏响铃）
- **💉 一键生成疫苗计划**：输入宝宝生日，按《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》生成到 6 周岁的免费疫苗日程，另附 2026 年版新纳入的 13 岁女孩双价HPV（可选，默认不勾选）（已过的剂次可选作为历史记录；按剂次 scheduleId 去重，重复生成不会重复添加）
- **🩺 一键生成体检计划**：按《国家基本公共卫生服务规范（第三版）》0～6岁儿童健康管理服务规范生成儿保体检日程：新生儿家庭访视、满月（28～30天，备注注明42天体检的做法）、3/6/8/12/18/24/30/36月龄、4/5/6岁各一次；备注写明常规检查内容（血常规、听力/视力/屈光筛查等），v1.5.0 审核补充：孤独症初筛（预警征象，11次）、髋关节检查、0～36月龄中医药健康管理（6次）、出牙/龋齿检查、涂氟说明；可选「新生儿疾病筛查（足跟血）结果查询」和「新生儿听力复筛」（仅初筛未通过时）；按 scheduleId（chk:）去重
- **💰 自费疫苗（可选，v1.5.0）**：设置 → 一键生成日程 →「💰自费疫苗(可选)」，新类别「自费疫苗」（蓝色 #1F8FE5，日历圆点/图例/编辑器/提醒/快捷指令/ICS 都支持）。默认方案：RSV单抗（尼塞韦单抗，与乙肝第2剂同一天，满1月龄）、13价肺炎 2/4/6/12月龄、五联 2/3/4/18月龄、五价轮状 2/3/4月龄、EV71 7/8月龄、流感 首季2剂、水痘 1岁/4岁；备选（默认不勾选）：Hib、流脑结合、甲肝灭活、乙脑灭活。备注写明预防什么、剂次、替代关系和「是否接种、品牌和时间以接种门诊建议为准」；按 scheduleId（paid:）去重。旧版本 App 收到的自费疫苗事项会暂时显示为「其他」，升级后按 scheduleId 自动改回
- **📋 本月全部事项 + 🪟 接种窗口 + 📆 计划日（v1.6.0）**：日历下方列出当前月份的全部事项，按计划日期分组（标题如「10月17日 周六 · 还有18天」），点某天跳到该组，本月顶部红色列出之前没完成的事项。
  每个计划事项带窗口：`earliest`（最早）/ `latest`（最迟，可空）/ `windowNote`；`date`/`time` 仍是**计划日期/时间**（提醒、闹钟、ICS 都按它，默认 = 生成器推荐日）。
  卡片显示「最早 … · 计划 …」「接种窗口：… – …（最迟）· 未到窗口 / 窗口中（还剩N天）/ 已过最迟 / 已完成」；「📆 改计划日」不能早于最早日，晚于最迟会提醒；
  日历：● 实心点 = 计划日，○ 空心点 = 最早日，点「🪟 窗口」或日期后显示该事项的窗口（淡色底、虚线圈 = 最早、实心 = 计划、「止」= 最迟）。
  旧版本（≤1.5.0）同步来的/本机旧事项没有窗口字段时，按 scheduleId + 宝宝生日从生成器推算（js/windows.js，不改 updatedAt）
- 📅 导出 .ics 到苹果日历（多个 VALARM，按所选提醒时间）
- App 打开时到点弹出全屏提醒页（铃声、知道了、稍后提醒10分钟）
- 可选：Web Push 推送（需要 `server/` 推送服务在线）
- **☁️ 云同步（可选，v1.4.0）**：设置 → 云同步，多台设备 / 盒子命令行共用一个同步密钥；数据在设备上 AES-GCM 加密后存到 Cloudflare Worker + D1（免费计划），服务端只见密文；开启时本机已有事项会上传合并、不会清空；配对链接 `#pair=<密钥>` 只在本地读取并立即从地址栏移除
- 设置页导出 / 导入 JSON 备份

## 结构
```
site/            静态网站（直接部署到 GitHub Pages）
  index.html  manifest.json  sw.js  config.js(推送服务地址)
  css/app.css
  js/store.js       数据层（localStorage，可扩展：生长记录、喂养记录…）
  js/reminders.js   提醒规则（App 内闹钟 / 推送 / ics / 快捷指令共用）
  js/shortcuts.js   快捷指令 URL 与传入文本格式
  js/vaccines.js    国家免疫规划疫苗程序与日期推算（纯函数）
  js/checkups.js    0～6岁儿童健康管理体检时间表与日期推算（纯函数）
  js/paidvax.js     自费疫苗方案（纯函数、无 import，命令行用 data: URL 加载）
  js/windows.js     接种/体检窗口：旧事项补窗口、状态（未到窗口/窗口中/已过最迟/已完成）
  js/ics.js         RFC 5545 .ics 生成
  js/push.js        Web Push 客户端
  js/sync-core.js   云同步：密钥派生、加密、请求（浏览器与盒子命令行共用）
  js/sync.js        云同步：本地变更跟踪、合并、配对链接
  js/views/*.js     页面：home / editor / actions / alarm / settings / help / vaxplan / planned（改计划日）
  icons/src/*.svg   图标源文件（build-icons.sh 生成 PNG）
sync/            云同步：worker/（Cloudflare Worker + D1 迁移 + 协议测试）、add-item.js（盒子命令行）、deploy.sh
server/          可选的推送服务（Node + web-push，JSON 文件存储）
test/            Playwright 端到端测试、ics 校验、疫苗/体检计划测试（node test/vaccines.test.mjs；node test/vaccine-ui.mjs；node test/checkups.test.mjs；node test/checkup-ui.mjs；node test/paidvax.test.mjs；node test/paidvax-ui.mjs；node test/windows.test.mjs；node test/window-ui.mjs；node test/refresh-windows.local.mjs（本地 Worker）；SYNC_BASE=… node test/sync-ui.mjs；node test/sw-upgrade.mjs）
```

## 快捷指令传入格式
每行一个提醒：`yyyy-MM-dd HH:mm|标题|备注`，例如
```
2026-09-30 20:00|【宝宝】明天 10:00 打乙肝疫苗第2针|💉疫苗 · 10月1日 10:00 · 前一天 20:00提醒 · 备注：带疫苗本
```

## 部署
推送到 `main` 后，GitHub Actions 会把 `site/` 发布到 `gh-pages` 分支。
