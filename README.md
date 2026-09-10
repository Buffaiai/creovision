# 创视界 · AIGC 创作平台

单页 AIGC 创作应用：文生图 / 图生图 / 文生视频 / 图生视频，接入 Agnes AI 全部图像与视频模型。零依赖 Node 服务做 API 代理，Key 只保存在服务端。带注册 / 登录（账号存服务端 `users.json`）。

## 项目结构

```
creovision/
├── index.html              # 前端页面（全部 UI + 交互逻辑）
├── server.js               # Node 代理服务（无第三方依赖，Node 18+）
├── favicon.svg             # 站点图标
├── config.json             # 本地开发配置（含 Key，已被 .gitignore 排除）
├── ecosystem.config.js     # PM2 部署配置（含 Key，已排除，首次在服务器上从下方式生成）
├── ecosystem.config.example.js  # 上者的模板（可提交）
├── deploy.sh               # rsync 部署：本地一键同步 + 重启（含自动备份、演练模式）
├── deploy-git.sh           # Git 部署：让服务器 git pull 最新代码 + 重启
├── .github/workflows/deploy.yml  # GitHub Actions：push 到 main 自动部署
├── nginx.conf.example      # Nginx 反向代理样例
├── Dockerfile              # 可选：容器部署
├── .env.example            # 环境变量模板
└── users.json              # 运行时生成：注册账号数据（含密码哈希，已排除）
```

## 本地运行

```bash
cd creovision
node server.js
# 打开 http://localhost:3077
```

---

## 服务器部署

### 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | **18 及以上**（用到内置 `fetch`，低于 18 会报错） |
| 内存 | 512MB 以上即可 |
| 端口 | 3077（仅本机监听，对外只开 80/443） |

---

### 方式一：PM2 常驻（推荐）

#### 1. 服务器上安装 Node 18+

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
node -v          # 确认 >= 18

# CentOS / Rocky
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs
```

#### 2. 上传代码

```bash
# 本地执行（会自动跳过 config.json / users.json）
scp -r creovision root@你的服务器IP:/opt/creovision
```

> 不要把 `config.json` 传上去，Key 用下面的方式在服务器上配置。

#### 3. 填 API Key

在服务器上从模板创建配置并填入 Key。`ecosystem.config.js` 含密钥，既不会进 Git 也不会被 `deploy.sh` 同步，所以**每个环境只需配一次**：

```bash
cd /opt/creovision
cp ecosystem.config.example.js ecosystem.config.js
vi ecosystem.config.js        # 把 AGNES_API_KEY 改成你的 Key
```

（等价方式：在服务器上 `export AGNES_API_KEY=sk-xxx` 后再启动，二选一即可。）

#### 4. 启动服务

```bash
npm i -g pm2
cd /opt/creovision
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # 按它输出的提示再执行一行命令，实现开机自启
```

常用运维命令：

```bash
pm2 status                 # 查看状态
pm2 logs creovision       # 看日志
pm2 restart creovision    # 重启
pm2 stop creovision       # 停止
```

#### 5. 验证

```bash
curl http://127.0.0.1:3077/api/health
# 返回 {"ok":true,"models":{...}} 即为正常
```

#### 6. 以后更新代码

在本地项目目录执行（不会覆盖服务器上的 Key 和账号数据）：

```bash
SERVER=root@你的服务器IP ./deploy.sh
```

> 依赖 `rsync`，本机和服务器都要装（`apt-get install -y rsync`）。macOS 自带 rsync，无需安装。
> 日常迭代流程见后文「持续更新」。

---

### 方式二：Docker

```bash
docker build -t creovision .
docker run -d --name aigc \
  -p 3077:3077 \
  -e AGNES_API_KEY=sk-你的Key \
  -v $(pwd)/users.json:/app/users.json \
  --restart unless-stopped creovision
```

> `-v users.json` 是为了让注册的账号在容器重建后不丢失。

---

### Nginx 反向代理 + HTTPS

把 `nginx.conf.example` 复制过去，改掉域名：

```bash
cp nginx.conf.example /etc/nginx/conf.d/aigc.conf
sed -i 's/your-domain.com/你的域名/g' /etc/nginx/conf.d/aigc.conf
nginx -t && nginx -s reload
```

申请免费 HTTPS 证书：

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名
```

**⚠️ 关键：超时必须调大。** 生图 / 建视频任务可能耗时 1–2 分钟，Nginx 默认 60 秒会返回 504。配置里已写好：

```nginx
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

#### 宝塔面板用户

- 软件商店装好 Nginx 和 PM2 管理器；
- 网站 → 反向代理 → 目标 URL 填 `http://127.0.0.1:3077`；
- 或用「Node 项目」直接添加，端口填 3077；
- 反向代理配置里同样要把「proxy_read_timeout」调大。

---

### 防火墙

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
# 3077 不要对外开放，只让本机的 Nginx 转发访问
```

云服务器（阿里云 / 腾讯云）还要在控制台的**安全组**里放行 80、443。

---

## 持续更新（日常迭代流程）

核心原则：**代码可以随便覆盖，数据必须原样保留。**

| 类别 | 文件 | 部署时 |
|---|---|---|
| 代码（可覆盖） | `index.html`、`server.js`、`favicon.svg`、各种 `.example` | 每次同步 |
| 数据（必须保留） | `users.json`（账号）、`.session_secret`（登录密钥）、`backups/` | **永不覆盖**（部署脚本已排除） |
| 配置（仅首次） | `ecosystem.config.js`（含 Key）、`config.json` | 服务器上配一次即可 |

### 推荐节奏

```bash
# 1. 本地改完，先在本地跑一遍确认没问题
node server.js

# 2. 提交一版（小步提交，方便随时回退）
git add . && git commit -m "说明这次改了什么"

# 3. 先演练，看看会改哪些文件
SERVER=root@你的服务器IP ./deploy.sh --dry-run

# 4. 正式部署
SERVER=root@你的服务器IP ./deploy.sh
```

### 出问题怎么回滚

- **代码回滚**：本地 `git checkout HEAD~1 -- index.html server.js`，然后再跑一次 `./deploy.sh`
- **账号回滚**：服务器上 `ls backups/`，挑一份复制回去
  ```bash
  cp backups/users.json.20260910_103000 users.json
  pm2 restart creovision
  ```

### 几点提醒

- 每次部署前会自动把 `users.json` 备份到 `backups/`，保留最近 5 份
- 改了 `server.js` 必须重启才生效（PM2 不会自动加载新代码）
- **生产环境不要开 `watch` 热重载**，否则改到一半会被自动加载上去
- 大改之前建议手动多留一份：`cp users.json users.json.manual`
- 登录用的是无状态签名 token，**重启服务不会把用户踢下线**，可以放心随时部署

### 用 GitHub 私有仓库管理代码（推荐）

可以，而且建议这么做：有完整历史、随时回滚，还能做到 **push 即部署**。

**一次性配置**

```bash
# 1. 在 GitHub 上新建一个 Private 仓库（不要勾选任何初始化文件）

# 2. 本地关联并推送（地址换成你自己的）
git remote add origin git@github.com:Buffaiai/creovision.git
git branch -M main
git push -u origin main
```

> `.gitignore` 已排除 `config.json`、`users.json`、`.session_secret`、`ecosystem.config.js`，
> 密钥和账号数据不会进仓库。**即使是私有仓库也不要提交密钥**——误改成公开、换人协作、
> GitHub 的密钥扫描都可能导致泄露。

**方式 A：半自动（push + 一条命令）**

服务器上先 clone 一次（用 Deploy Key 或你的账号授权）：

```bash
git clone git@github.com:Buffaiai/creovision.git /opt/creovision
cd /opt/creovision && cp ecosystem.config.example.js ecosystem.config.js   # 填入 Key
```

之后每次更新：

```bash
git add . && git commit -m "改了什么" && git push
SERVER=root@你的服务器IP ./deploy-git.sh      # 服务器拉代码、备份账号、重启
```

**方式 B：全自动（push 即部署，最省事）**

仓库里已备好 `.github/workflows/deploy.yml`。在 GitHub 仓库
**Settings → Secrets and variables → Actions → New repository secret** 里加 3 个：

| Secret | 值 |
|---|---|
| `SERVER_HOST` | 服务器 IP，如 `1.2.3.4` |
| `SERVER_USER` | 登录用户名，如 `root` |
| `SERVER_SSH_KEY` | 服务器 SSH **私钥**全文（含首尾 `-----BEGIN` / `-----END` 行） |

配好后，每次 `git push` 到 main 分支会自动：备份账号 → 同步代码 → 重启 → 健康检查。
也可以在 Actions 页面手动点「Run workflow」触发。

> 服务器不需要 GitHub 凭据、也不需要 clone 仓库——Actions 在云端检出代码后 rsync 过去。
> 账号数据（`users.json`、`.session_secret`）不会被覆盖。

---

## ⚠️ 上线前必读

### 1. 接口未鉴权 —— 公网任何人都能烧你的 Key

服务部署到公网后，任何访问者都能通过 `/api/*` 用你的 Key 生成内容。三选一防护：

**方案 A：IP 白名单（自用最简单）**
在 Nginx 的 `location /` 里加：

```nginx
allow 你的公网IP;
deny  all;
```

**方案 B：Basic Auth 口令**

```bash
apt-get install -y apache2-utils
htpasswd -c /etc/nginx/.aigc_htpasswd Buffaiai
```

然后打开 `nginx.conf.example` 里 `auth_basic` 那两行的注释，再 `nginx -s reload`。

**方案 C：要求登录才能生成**（推荐，已内置）

项目已有账号体系，设置 `REQUIRE_LOGIN=1` 后，生图 / 生视频接口会校验登录 token，未登录直接返回 `401 {"error":"请先登录后再生成"}`。

```bash
REQUIRE_LOGIN=1 node server.js
```

- `ecosystem.config.js` 中已默认写入 `REQUIRE_LOGIN: "1"`，用 PM2 部署即自动生效
- 本地直接 `node server.js` 不设该变量，保持不校验，开发调试不受影响
- 前端登录后会自动在所有生成请求上附带 token；若服务端返回 401，会自动弹出登录框提示重新登录
- 启动日志会明确打印当前是「已开启」还是「未开启」，方便确认

> 注意：`/api/video/status` 与 `/api/download` 不做校验（不消耗额度，且要保证刷新页面后能继续轮询未完成的视频任务）。

### 2. Key 安全

只用环境变量或服务器上的配置文件，**绝不提交进 Git、绝不写进前端**。`config.json` 和 `ecosystem.config.js` 都已在 `.gitignore` 中排除。

### 3. 额度计费

Image 2.0/2.1 Flash 当前免费；Video V2.0 当前 $0/秒。**Video 2.5（付费）已从页面移除并在服务端拦截**，如需启用请删除 `server.js` 中 `handleVideoCreate` 里的 403 限制块。

### 4. 登录功能上线注意事项（新）

- **`users.json` 需要写权限**：注册时会写入该文件，确保运行 Node 的用户对项目目录有写权限：
  ```bash
  chown -R $(whoami) /opt/creovision
  ```
- **登录态不会因重启丢失**：token 采用无状态签名（HMAC-SHA256，有效期 30 天），服务端不保存会话，因此 `pm2 restart` 或重新部署后用户仍保持登录。
  - 签名密钥存放在 `.session_secret`（服务器上首次启动自动生成，权限 600）。`deploy.sh` 已排除该文件，**重新部署不会覆盖它**，登录态不受影响；换到全新服务器时会自动生成新密钥（用户重新登录即可）。
  - 多实例部署时，请用环境变量 `SESSION_SECRET` 给所有实例配置同一个密钥。
  - 登出会让该用户此前签发的**所有** token 立即失效（内部通过 `tokenVer` 自增实现），且重启后依然有效。
- **定期备份 `users.json`**：账号数据都在这一个文件里。

---

## 常见问题排查

| 现象 | 原因 / 解决 |
|---|---|
| 生图或建任务返回 504 | Nginx `proxy_read_timeout` 太小，按上面调到 300s |
| 页面提示「本地服务未启动」 | 服务没起来：`pm2 status` 看状态，`pm2 logs creovision` 看报错 |
| 提示「未配置 API Key」 | 环境变量没生效，检查 `ecosystem.config.js` 里的 `AGNES_API_KEY`，改完要 `pm2 restart creovision` |
| 能打开页面但生图失败 | `pm2 logs creovision` 看 Agnes 返回，常见是额度/频率限制或 Key 失效 |
| 注册失败 | 目录没有写权限，见上面「登录功能上线注意事项」 |
| 上传参考图失败 | Nginx `client_max_body_size` 太小，配置里已设为 20m |
| 域名能访问但不是 HTTPS | 执行 `certbot --nginx -d 你的域名` 后重载 Nginx |

---

## API（本服务暴露的接口）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 + 模型列表 |
| POST | `/api/image` | 生图 `{model, prompt, size, ratio, images[]}` |
| POST | `/api/video` | 建视频任务 `{model, prompt, size, ratio, seconds, image_url}` |
| GET | `/api/video/status?id=&model=` | 查询视频任务进度/结果 |
| GET | `/api/download?url=` | 强制下载生成结果（仅限 Agnes 输出域名） |
| POST | `/api/auth/register` | 注册 `{email, password}` |
| POST | `/api/auth/login` | 登录 `{email, password}` |
| GET | `/api/auth/me` | 当前登录用户（Bearer token） |
| POST | `/api/auth/logout` | 退出登录 |
