// 部署配置：推送服务地址（后端）。可在「设置」页覆盖。
window.BABY_CONFIG = {
  pushApi: 'https://dod-reno-routers-button.trycloudflare.com',
  appVersion: '1.15.1',   // 发布时同时改 sw.js 的 VERSION 和 js/views/settings.js 的 APP_BUILD
  // 云同步服务地址（Cloudflare Worker 自定义域名，国内可直连）。留空 = 不显示「云同步」。
  syncApi: 'https://sync.jiayouzhaozhao.cn',
  // 照片服务默认 HTTPS（Cloudflare Tunnel → 极空间 8789）。本机设置可覆盖；Tunnel 未就绪前请先按 docs/photo-tunnel.md 装 connector。
  photoApi: 'https://photo.jiayouzhaozhao.cn',
};
