# 宝宝记录 · baby-record

一个给 iPhone 用的宝宝日程 PWA（纯静态，数据只存在手机本地，无登录、无个人数据）。

**在线使用：** https://lj-lioo.github.io/baby-record/ （用 Safari 打开 → 分享 → 添加到主屏幕）

## 功能
- 月历：疫苗 / 体检 / 其他重要事项，疫苗日有 💉 标记
- 首页顶部醒目的「近期提醒」卡片（今天 / 明天 / 还有N天 / 已过N天），可标记已完成
- 每个事项可设置多个提醒：前一天 20:00、当天 08:00、提前1天/2小时/1小时/30分钟、准时、自定义时间
- **⏰ 设为闹钟提醒**：通过 iOS 快捷指令「宝宝闹钟」在「提醒事项」的「宝宝」列表中为每个提醒时间创建 **紧急** 提醒（iOS 26.4+，到点像闹钟一样全屏响铃）
- 📅 导出 .ics 到苹果日历（多个 VALARM，按所选提醒时间）
- App 打开时到点弹出全屏提醒页（铃声、知道了、稍后提醒10分钟）
- 可选：Web Push 推送（需要 `server/` 推送服务在线）
- 设置页导出 / 导入 JSON 备份

## 结构
```
site/            静态网站（直接部署到 GitHub Pages）
  index.html  manifest.json  sw.js  config.js(推送服务地址)
  css/app.css
  js/store.js       数据层（localStorage，可扩展：生长记录、喂养记录…）
  js/reminders.js   提醒规则（App 内闹钟 / 推送 / ics / 快捷指令共用）
  js/shortcuts.js   快捷指令 URL 与传入文本格式
  js/ics.js         RFC 5545 .ics 生成
  js/push.js        Web Push 客户端
  js/views/*.js     页面：home / editor / actions / alarm / settings / help
  icons/src/*.svg   图标源文件（build-icons.sh 生成 PNG）
server/          可选的推送服务（Node + web-push，JSON 文件存储）
test/            Playwright 端到端测试、ics 校验
```

## 快捷指令传入格式
每行一个提醒：`yyyy-MM-dd HH:mm|标题|备注`，例如
```
2026-09-30 20:00|【宝宝】明天 10:00 打乙肝疫苗第2针|💉疫苗 · 10月1日 10:00 · 前一天 20:00提醒 · 备注：带疫苗本
```

## 部署
推送到 `main` 后，GitHub Actions 会把 `site/` 发布到 `gh-pages` 分支。
