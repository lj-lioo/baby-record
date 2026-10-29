# 照片 HTTPS：Cloudflare Tunnel → 极空间 photo-server

目标：`https://photo.jiayouzhaozhao.cn` → 家里 `http://192.168.110.199:8789`（极空间上的 baby-record photo-server）。

> **当前状态（2026-10-29）**：域名已在 Cloudflare 账号 `4678aa04…`（Nbacba100201@gmail.com）且为 Active；同步 Worker 已绑 `sync.jiayouzhaozhao.cn`。  
> **Tunnel 尚未创建**：本助手连接的 Cloudflare MCP **没有** Tunnel 写权限（需 `argotunnel.write` / Cloudflare Tunnel Write）。需你在该 Cloudflare 账号后台创建 Tunnel，或给 MCP 重授权后让助手补建。

## 你需要做的（家里同网机器）

在能访问 `192.168.110.199:8789` 的机器上安装并常开 `cloudflared`（优先极空间 Docker；也可用家里 Mac / Windows）。

### A. Cloudflare 控制台（账号须与域名同一账户）

1. Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared  
2. 名称建议：`baby-photo`  
3. 安装：按向导在极空间 / Mac / Windows 安装 connector（会拿到一段 `cloudflared service install <TOKEN>`）  
4. Public Hostname：
   - Subdomain: `photo`
   - Domain: `jiayouzhaozhao.cn`
   - Service: `http://192.168.110.199:8789`
5. 保存后 DNS 会出现 `photo` → `<tunnel-id>.cfargotunnel.com`（代理开启）

### B. 自检

1. 家里 Wi‑Fi 浏览器打开 `http://192.168.110.199:8789/health` → `{"ok":true,...}`  
2. 外网（关 VPN）打开 `https://photo.jiayouzhaozhao.cn/health` → 同样 ok  
3. App 设置 → 照片服务地址填 `https://photo.jiayouzhaozhao.cn` →「测试连接」  
4. 相册能上传 / 打开原片

### C. 注意

- photo-server 已允许 Origin `https://lj-lioo.github.io`；一般不用改 CORS。  
- Tunnel connector **必须**跑在能访问 NAS 局域网 IP 的机器上；只在 Cloudflare 建配置、家里没跑 cloudflared，公网 HTTPS **不会**通。  
- 不要把 Tunnel token 发到聊天或提交到 Git。

### D. 大批量上传（v1.13.7+）

- **原因**：经 Cloudflare Tunnel 的慢上行上，单次 PUT ≥约 512KB 易超时（约 100s 代理限制）；整文件传原图在 52 张批量时几乎都会失败。
- **客户端**：原图/视频按 **256KB 明文分块** 走 `/v1/video/:id/:n`，串行上传（并发=1），失败自动重试 3 次；建议每次选约 **12 张**，保持屏幕常亮。
- **角标**：`上传中` 跟本批未完成队列 + `remoteReady` 对齐，切到日程再回相册仍会显示未传完的；可点「一键补传」。
- 极空间 photo-server **无需升级**（已有 video-chunks）；旧版整文件 `/v1/photo` 仍可读。

