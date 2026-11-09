# 服务器多用户部署与管理员后台

Nova Studio 现在支持「管理员统一配置模型、多用户共享使用」的服务器部署模式：

- 管理员在后台维护供应商、模型、默认模型、插件凭据、用户与配额
- 所有 API Key 使用 AES-256-GCM 加密保存在服务器 SQLite 中，不再下发到浏览器
- 用户通过账号登录后直接使用管理员配置好的模型
- 任务按用户归属，图片、任务状态与 WebSocket 订阅都做了权限校验
- 按用户统计每日/每月图片、视频、文本用量，并支持配额限制
- 管理员操作写入审计日志

> 本地 / 桌面单用户场景仍然可用：设置 `NOVA_AUTH_DISABLED=true` 后跳过登录，
> 继续使用浏览器里自带的供应商与 API Key（BYOK）。

---

## 1. 首次启动

### 方式 A：环境变量创建管理员

在 `.env` 中设置：

```env
NOVA_ADMIN_USERNAME=admin
NOVA_ADMIN_PASSWORD=请换成一个强密码
```

首次启动且用户表为空时，会自动创建该管理员。创建完成后建议删除这两行，
或登录后台在「账号」页修改密码。

### 方式 B：初始化页面

不配置环境变量，直接访问：

```text
http://<服务器地址>:3000/setup/
```

填写用户名、显示名称与密码即可创建第一个管理员。初始化完成后 `/setup/` 会失效。

### 必设：主密钥

```env
NOVA_SECRET_KEY=一段足够长的随机字符串
```

主密钥用于加密供应商与插件的 API Key。未设置时会在数据库同目录生成
`.nova-secret`（权限 0600）。**请务必把主密钥或 `.nova-secret` 与数据库一起备份**；
丢失后已保存的 Key 无法解密，只能重新填写。

生成随机密钥：

```bash
openssl rand -base64 48
```

---

## 2. 管理员后台

登录管理员账号后：

- 宽屏侧栏会出现「管理后台」
- 或直接访问 `/admin/`
- 也可以在「设置 → 账号」里进入

后台包含：

| 页面 | 功能 |
| --- | --- |
| 总览 | 用户数、今日任务、队列、失败率、最近任务、近 7 天活跃用户、系统信息 |
| 用户 | 创建/编辑/删除用户、角色、启停、重置密码、8 项配额 |
| 供应商与模型 | 供应商 CRUD、连接测试、从上游批量导入模型、模型能力配置、全局默认模型 |
| 任务 | 全站任务筛选、查看结果、删除任务与产物 |
| 用量 | 7/30/90 天趋势、按类型统计、按用户统计 |
| 插件 | 已安装视频插件、共享凭据配置、重新扫描目录、加载失败原因 |
| 站点设置 | 站点名、注册开关、BYOK 开关、个人默认覆盖开关、新用户默认配额、会话天数、公告 |
| 操作审计 | 管理员关键操作记录 |

### 模型配置建议

1. 先添加供应商：名称、类型、Base URL、API Key
2. 点「测试连接」拉取上游模型列表
3. 勾选模型，选择「导入为图片模型」或「导入为文本模型」
4. 对图片模型补充最大参考图数量、最大输出尺寸、内置预设、高级参数开关
5. 在「全局默认模型」里为各工作流指定默认模型
6. 用户端即可直接使用

### 配额语义

- `0` 表示不限
- 管理员账号默认不限
- 新用户默认配额在「站点设置」中配置
- 每个用户还可以单独覆盖
- 待处理任务上限与单次并发上限至少为 1

---

## 3. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NOVA_SECRET_KEY` | 自动生成 `.nova-secret` | 加密供应商/插件 Key 的主密钥 |
| `NOVA_ADMIN_USERNAME` | 空 | 首次启动自动创建的管理员用户名 |
| `NOVA_ADMIN_PASSWORD` | 空 | 首次启动自动创建的管理员密码 |
| `NOVA_AUTH_DISABLED` | `false` | `true` 时跳过登录，本地单用户 BYOK 模式 |
| `NOVA_COOKIE_SECURE` | 自动判断 | 反向代理终止 HTTPS 时设为 `true` |

原有的 `NOVA_TASK_DB`、`NOVA_IMAGE_DIR`、`NOVA_TASK_CONCURRENCY`、
`NOVA_MAX_QUEUE_SIZE`、限流、提示词广场、CDP 等变量保持不变。

---

## 4. Docker 部署

```bash
cp backend/.env.docker.example .env
# 编辑 .env，至少设置 NOVA_SECRET_KEY 与 NOVA_ADMIN_PASSWORD
mkdir -p data plugins
cp -r backend/plugins/ccode-h3 plugins/
docker compose up -d
```

访问 `http://localhost:3000/setup/` 或使用环境变量创建的管理员登录。

数据都在宿主机 `./data/`：

- `nova-tasks.sqlite`：任务、用户、会话、供应商、模型、用量、审计
- `nova-images/`：生成图片
- `.nova-secret`：未设置 `NOVA_SECRET_KEY` 时自动生成的主密钥

备份时请把 `./data/` 整个目录一起备份。

---

## 5. 反向代理与 HTTPS

生产环境建议用 Nginx / Caddy 终止 HTTPS，并转发到 `127.0.0.1:3000`：

```nginx
server {
  listen 443 ssl;
  server_name nova.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

同时设置：

```env
NOVA_COOKIE_SECURE=true
NOVA_PUBLIC_BASE_URL=https://nova.example.com
```

`NOVA_PUBLIC_BASE_URL` 用于视频插件把参考素材的公网地址交给上游，内网部署必须显式配置。

---

## 6. 权限与数据隔离

- 未登录访问 `/api/nova/*` 返回 401（登录、初始化、健康检查、插件素材回读除外）
- 普通用户只能访问自己的任务、图片与 WebSocket 订阅
- 管理员可以访问全部任务与图片
- 供应商/插件 Key 只以掩码形式返回给管理员，任何接口都不返回明文
- 插件素材 `/api/nova/plugin-media/:file` 保持匿名可读：上游服务按 URL 拉取素材时没有 Cookie
- 修改密码或停用用户会立即删除其所有会话

---

## 7. 从旧版升级

旧版数据只有 `tasks` / `task_items` / 插件素材表。升级后首次启动会自动：

- 新增 `users`、`sessions`、`providers`、`models`、`app_settings`、`usage_events`、`audit_logs`、`plugin_credentials` 表
- 给 `tasks` 增加 `user_id` 列
- 保留旧任务（`user_id` 为空，仅管理员可见）

旧版浏览器 localStorage 里的模型配置不会自动迁移到服务器。
升级为多用户模式后，请管理员在后台重新配置供应商与模型。
如果只想继续本地单用户使用，设置 `NOVA_AUTH_DISABLED=true` 即可。

---

## 8. 本地 / 桌面模式

```env
NOVA_AUTH_DISABLED=true
```

该模式下：

- 不显示登录页，`/auth/me` 返回本地管理员身份
- 继续使用浏览器 localStorage 里的模型与 API Key
- 任务归属本地用户
- 管理员后台仍可访问，但服务端模型目录为空，BYOK 设置界面保持原样

适合 Electron 桌面版、个人本机使用或内网单用户部署。
