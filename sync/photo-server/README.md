# 宝宝记录 · 极空间照片服务

在极空间（或任意 Docker 主机）里跑一个小服务：**只存客户端 AES-GCM 加密后的原图密文**，不接触明文、不持有同步密钥。

App 跑在 **HTTPS**（GitHub Pages）上时，浏览器**不允许**页面去 `fetch` 局域网的 `http://192.168.x.x`（混合内容拦截）。所以：

- Safari **地址栏直接打开** `http://极空间IP:8789/health` → 可以（用来确认服务活着）
- App 设置里填同一个 `http://…` 点「测试连接」→ **会 Load failed**（不是地址写错，是浏览器安全策略）

真正给 App 用的地址必须是 **HTTPS**，例如买域名后用 Cloudflare Tunnel 把 `https://photo.你的域名` 指到极空间 `8789`，再在设置里填这个 https 地址。

## 极空间 Docker 怎么挂

1. 在极空间里建一个共享文件夹，例如 `宝宝相册密文`（随便起名）。
2. 打开 **Docker** → 新建容器 / 用命令行：

```bash
# 在已能访问本仓库的机器上构建，或把本目录拷进极空间后再 build
docker build -t baby-record-photo /path/to/sync/photo-server

docker run -d --name baby-photo \
  --restart unless-stopped \
  -p 8789:8789 \
  -v /挂载点/宝宝相册密文:/data \
  -e PORT=8789 \
  # 可选：设置访问令牌后，App 端暂未附带 Token 头（MVP 建议家里局域网先不设）
  # -e PHOTO_TOKEN=自己设一串长随机数 \
  baby-record-photo
```

3. 手机连家里 Wi‑Fi，浏览器打开 `http://极空间局域网IP:8789/health`，应看到 `{"ok":true,"service":"baby-record-photo",...}`（这只证明服务活着）。
4. **不要**指望在 HTTPS 的 App 里填局域网 `http://…` 能测通。等域名 + Tunnel 配好 HTTPS 后，在 App → **设置 → 📷 照片服务** 填 `https://photo.你的域名` →「测试连接」。

## v1.10.0 升级：支持视频（需重建容器）

App v1.10.0 加了视频，照片服务也要更新到 1.10.0，否则上传视频会失败（照片不受影响）：

1. 把新版 `sync/photo-server` 目录拷到极空间（覆盖旧的 `server.js`）。
2. 极空间 Docker：**停止并删除旧容器 `baby-photo` → 重新 `docker build` 镜像 → 用同样的 `docker run` 参数（同一个 `/data` 挂载文件夹）重建**。已存照片都在挂载文件夹里，不会丢。
3. 打开 `http://极空间IP:8789/health`，看到 `"version":"1.10.0"` 就好了。

视频按 4MB 一块分别加密，存在 `/data/v_<id>/0.bin, 1.bin …`；每块上限 9MB，所以不需要调大内存。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8789` | 监听端口 |
| `DATA_DIR` | `/data`（容器内） | 密文存放目录，对应极空间文件夹 |
| `PHOTO_TOKEN` | 空 | 若设置，请求需 `Authorization: Bearer <TOKEN>`（MVP App 尚未带 Token，局域网可留空） |
| `CORS_ORIGINS` | 空 | 额外允许的 Origin，逗号分隔；默认已含 GitHub Pages 与常见 localhost / 局域网 |

## API

- `GET /health` → 健康检查
- `PUT /v1/photo/:id` → 上传密文（body = `iv(12)+ciphertext`）
- `GET /v1/photo/:id` → 下载密文
- `DELETE /v1/photo/:id` → 删除密文
- `GET /v1/photo/:id` 和视频块都支持 `Range: bytes=a-b`（206），流式读盘
- `PUT /v1/video/:id/:n` → 上传视频第 n 块密文（每块 `iv(12)+ciphertext`，AAD=`id:n`，≤9MB，超出 413）
- `GET /v1/video/:id/:n` → 下载第 n 块；`GET /v1/video/:id` → `{chunks}`；`DELETE /v1/video/:id` → 删整个视频

`:id` 仅允许 `[0-9a-zA-Z_-]{6,64}`。

## 访问说明

- **服务自检（家里 Wi‑Fi）**：浏览器打开 `http://192.168.x.x:8789/health`。
- **给 App 用**：必须 `https://…`（域名 + Cloudflare Tunnel → 家里 8789）。GitHub Pages 上的 PWA 无法直连局域网 http（混合内容）。
- **不能**把 App 整站改成局域网 http 托管来绕过：同步加密依赖 `crypto.subtle`，需要安全上下文（HTTPS / localhost），`http://192.168.x.x` 上会坏掉。
- 相册**元数据**（缩略图、说明、时间）仍走现有 Cloudflare 云同步；`*.workers.dev` 在国内常需 VPN。

## 安全

- 服务端**永远看不到照片明文**（没有同步密钥解不开）。
- 不要把同步密钥（`brs1_…`）写进 Docker 环境变量或提交到仓库。
- 局域网无 Token 时，同一 Wi‑Fi 下别人若猜到 URL+id 只能拿到密文；有公网暴露时务必加 Tunnel 鉴权或 `PHOTO_TOKEN`。
