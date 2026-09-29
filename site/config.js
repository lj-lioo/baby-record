// 部署配置：推送服务地址（后端）。可在「设置」页覆盖。
window.BABY_CONFIG = {
  pushApi: 'https://dod-reno-routers-button.trycloudflare.com',
  appVersion: '1.4.1',   // 发布时同时改 sw.js 的 VERSION 和 js/views/settings.js 的 APP_BUILD
  // 云同步服务地址（Cloudflare Worker）。留空 = 不显示「云同步」，App 行为与之前完全一样。
  syncApi: 'https://baby-record-sync.baby-record-e1lwbaby-record-e1lw.workers.dev',
};
