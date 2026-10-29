# 宝宝记录 · 极空间照片服务

在极空间（或任意 Docker 主机）里跑一个小服务：**只存客户端 AES-GCM 加密后的原图密文**，不接触明文、不持有同步密钥。

App 设置里填「照片服务地址」，例如家里局域网：

```text
http://192.168.1.8:8789
```

（把 IP 换成你极空间在路由器里的局域网地址。）

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

3. 手机连家里 Wi‑Fi，浏览器打开 `http://极空间局域网IP:8789/health`，应看到 `{"ok":true,"service":"baby-record-photo",...}`。
4. 打开宝宝记录 App → **设置 → 📷 照片服务** → 填 `http://极空间局域网IP:8789` → 点「测试连接」。

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

`:id` 仅允许 `[0-9a-zA-Z_-]{6,64}`。

## 访问说明（暂不买域名）

- **家里 Wi‑Fi**：App 填局域网 `http://192.168.x.x:8789` 即可上传/查看原图。
- **外出**：需手机开 VPN 连回家，或以后买域名 + Cloudflare Tunnel 再绑公网地址。
- 相册**元数据**（缩略图、说明、时间）仍走现有 Cloudflare 云同步；`*.workers.dev` 在国内常需 VPN。

## 安全

- 服务端**永远看不到照片明文**（没有同步密钥解不开）。
- 不要把同步密钥（`brs1_…`）写进 Docker 环境变量或提交到仓库。
- 局域网无 Token 时，同一 Wi‑Fi 下别人若猜到 URL+id 只能拿到密文；有公网暴露时务必加 Tunnel 鉴权或 `PHOTO_TOKEN`。
