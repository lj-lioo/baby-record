# 家有朝朝 · 极空间照片服务 v1.15.0

新上传的原图、视频是 NAS 可识别的普通文件；旧 AES-GCM 密文保留，仍由有同步密钥的客户端解密读取。服务不持有同步密钥，不会自动转换旧原图。不需要 ffmpeg、R2 或修改同步 Worker。

## 从旧版更新（手机可照做）

1. 在极空间 App 的 Docker 页面，打开现有 `baby-photo` 容器详情，记下端口、环境变量及 **`/data` 对应的 NAS 文件夹**。保留这个文件夹，不清空数据。
2. 把本目录新版 `server.js`、`Dockerfile`、`package.json` 放到原来的构建目录，覆盖代码。
3. 若使用“构建镜像”：重新构建 `baby-record-photo`，停止旧容器，用新镜像重建容器；沿用第 1 步的端口、环境变量、同一个 `/data` 文件夹。**只重启旧镜像不会更新代码。** 若原本将 `server.js` 作为文件挂载：覆盖挂载文件后重启即可。
4. 手机浏览器打开 `https://photo.jiayouzhaozhao.cn/health`，应出现 `"version":"1.15.0"`。App 设置里的照片服务地址仍填 `https://photo.jiayouzhaozhao.cn`。
5. 若容器设置过 `PHOTO_TOKEN`，在 App“设置 → 照片服务 → 照片服务令牌”填相同值并保存；每台手机都需配置。未设置则留空。打开一段新视频，检查可静音自动播放、拖进度；再打开照片，检查先有预览、随后变清晰。

若手机 Docker 界面不支持构建，需要在原来的构建机器上完成第 3 步；本次代码修改没有操作 NAS 或部署。

**是否必须更新：** 设置了 `PHOTO_TOKEN` 时需要新版 GET 查询鉴权，才能让 `<img>/<video>` 直接读取。未设令牌的 v1.14.0 已支持明文文件与 Range，基本播放和派生图上传可继续工作，仍建议更新并检查版本。更老、尚不支持 `/v1/file` 的服务必须更新；新客户端不会把新原图回退为密文。

## 首次安装 / 命令行更新

```bash
docker build -t baby-record-photo /path/to/sync/photo-server
docker run -d --name baby-photo \
  --restart unless-stopped \
  -p 8789:8789 \
  -v /原来的NAS相册文件夹:/data \
  -e DATA_DIR=/data \
  -e PORT=8789 \
  baby-record-photo
```

已有同名容器时应先在 Docker 界面停止、移除旧容器，再使用**原有挂载参数**重建；不要删除 NAS 相册文件夹。如果原来配置了 `PHOTO_TOKEN` 或 `CORS_ORIGINS`，重建时也须沿用。可选访问令牌用 `-e PHOTO_TOKEN=自己的长随机令牌`，它与云同步密钥不同。

App 在 HTTPS 下，不能连接局域网 `http://192.168…`。给 App 用的地址必须是 HTTPS（现有 Tunnel → NAS 8789）；局域网 `/health` 只用于服务自检。

## 存储和兼容

- 原文件 `/v1/file/:id`：按北京时间拍摄时间存为 `/data/年/年-月/日期_时间_短id.扩展名`，文件修改时间沿用拍摄时间。
- JPEG 缩略图使用 `<id>-t`，最长边 400px；JPEG 中图使用 `<id>-m`，最长边 1280px，原片保持不变。当前也存入日期目录，极空间自己的相册索引可能同时显示这些派生图。
- 索引 `/data/.index/` 和待拼接块 `/data/.staging/` 不要手动删除。旧 `*.bin`、`v_*/` 保留。
- 新客户端每个 PUT 为 **256KB**，符合 Tunnel 单次 ≤512KB 的约束；服务端保留旧客户端 9MB 分块上限。
- 云同步 Worker 只传说明、时间、图片引用等加密元数据；缩略图完整质量通过照片服务共享，绕开单条 32KB 上限，不再压成 240/160px。
- 本机缩略图从 localStorage 自动迁入 IndexedDB，事务成功才清除旧副本；失败保留原数据，可在以后保存时重试。
- 新照片由上传客户端在后台生成中图。HEIC 有 JPEG 中图时所有浏览器都可查看；本来无法解码 HEIC 的浏览器仍不能直接导入 HEIC。旧 HEIC 没有中图时保留缩略图，可用能解码的设备重新选图上传。不会自动转换旧加密原图。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8789` | 监听端口 |
| `DATA_DIR` | 代码旁的 `data`，Docker 为 `/data` | 文件存放目录 |
| `PHOTO_TOKEN` | 空 | 写入/删除需 Bearer；GET 可 Bearer 或 `access_token` 查询参数 |
| `CORS_ORIGINS` | 空 | 额外允许的 Origin，逗号分隔；默认允许既有 GitHub Pages 和 localhost/局域网 |

## API

- `GET /health` → 版本与能力；无需鉴权。
- `PUT /v1/file/:id/:n?total=N&taken=毫秒&ext=jpg&mime=image/jpeg` → 收齐后原样拼接。
- `GET /v1/file/:id` → 流式媒体，支持 `Range: bytes=a-b`、后缀范围和 416；`?info=1` 返回索引。
- `DELETE /v1/file/:id` → 删除该 ID 的明文、索引及旧密文。相册客户端还会分别删除 `-t`、`-m`。
- 旧 `PUT/GET/DELETE /v1/photo/:id`、`PUT/GET /v1/video/:id/:n`、`GET/DELETE /v1/video/:id`、`DELETE /v1/legacy/:id` 均保留，Bearer 鉴权不变。
- ID 只允许 `[0-9a-zA-Z_-]{6,64}`；新客户端生成的 ID 加派生后缀也在此范围。

GET 查询参数是浏览器原生媒体的鉴权方式，**不能用于 PUT/DELETE**。不要分享带 `access_token` 的媒体 URL，也不要在 Tunnel/代理日志里记录完整查询字符串。响应设置 `Referrer-Policy: no-referrer`；App 的保存/分享只交给系统缩略图文件。

## 自查

```bash
node --check server.js
node test.mjs
```

协议测试直接调用真实 HTTP handler 和文件流，可在禁止监听端口的环境运行；覆盖旧密文、明文分块、Range、派生图及新旧鉴权。浏览器与 NAS 上的实际拖动播放仍需实际 HTTP/HTTPS 环境验收。
