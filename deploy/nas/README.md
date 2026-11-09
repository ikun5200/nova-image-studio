# 飞牛 NAS 部署（/vol1/1000/生图站）

镜像：`ghcr.io/ikun5200/nova-image-studio:latest`

## 1. 准备目录

在飞牛 NAS 的终端里：

```bash
mkdir -p /vol1/1000/生图站
cd /vol1/1000/生图站
```

把本目录的 `docker-compose.yml` 和 `.env.example` 复制过去，然后：

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

- `NOVA_SECRET_KEY`：随机字符串，`openssl rand -base64 48`
- `NOVA_ADMIN_PASSWORD`：管理员密码
- `NOVA_PUBLIC_BASE_URL`：NAS 的局域网或公网地址，例如 `http://192.168.1.100:3000`

## 2. 拉取镜像并启动

如果 GHCR 包是公开的：

```bash
docker compose up -d
```

如果 GHCR 包是私有的，先在 NAS 上登录（PAT 需要 `read:packages` 权限）：

```bash
echo '<你的 GitHub PAT>' | docker login ghcr.io -u ikun5200 --password-stdin
docker compose up -d
```

也可以直接在飞牛「Docker → 镜像仓库」里添加 GHCR 仓库并填入用户名 / PAT。

## 3. 首次使用

浏览器打开：

```text
http://<NAS地址>:3000/
```

如果 `.env` 里配置了 `NOVA_ADMIN_USERNAME` / `NOVA_ADMIN_PASSWORD`，直接登录即可；
否则访问 `http://<NAS地址>:3000/setup/` 创建第一个管理员。

登录后点击右上角「管理后台」，先配置：

1. 供应商（Base URL + API Key）
2. 图片模型 / 文本模型
3. 全局默认模型

然后用户端就能直接使用。

## 4. 数据与备份

所有数据都在 `./data/`：

- `nova-tasks.sqlite`：任务、用户、会话、供应商、模型、用量、审计
- `nova-images/`：生成图片
- `.nova-secret`：未设置 `NOVA_SECRET_KEY` 时自动生成的主密钥

备份时把整个 `/vol1/1000/生图站/data/` 目录一起备份。**`.nova-secret` 丢失后已保存的 API Key 无法解密。**

## 5. 更新

```bash
cd /vol1/1000/生图站
docker compose pull
docker compose up -d --force-recreate
```

## 6. 常见问题

**拉取镜像 403 / denied**

GHCR 包默认可能是私有的。到 GitHub 个人主页 → Packages → `nova-image-studio` →
Package settings → Change visibility → Public；或者在 NAS 上用带 `read:packages` 的 PAT 登录。

**视频任务提示素材地址不可访问**

`NOVA_PUBLIC_BASE_URL` 必须是上游能访问到的地址，不能填 `localhost` 或 `127.0.0.1`。

**端口冲突**

修改 `docker-compose.yml` 里的 `"3000:3000"` 为例如 `"13000:3000"`，并同步修改
`NOVA_PUBLIC_BASE_URL` 的端口。
