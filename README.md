# Aeoleaf · 风叶

一个集个人博客、作品展示和内容管理于一体的网站，用来记录设计与技术笔记，整理作品，也留下一处与访客交流的空间。

项目采用 **Node.js + Express + EJS + SQLite**，页面由服务端渲染，管理后台与前台运行在同一个应用中，无需单独部署数据库服务。

## 功能

### 前台

- **个人首页与关于页**：展示个人介绍、文章和作品，支持后台配置站点内容。
- **博客**：Markdown 文章、标签筛选、文章目录与预计阅读时长。
- **作品集**：作品列表与详情展示。
- **站内搜索**：搜索已发布文章和作品。
- **留言板**：访客留言、后台审核与管理员回复。
- **订阅与 SEO**：RSS、站点地图、robots.txt，以及文章级 SEO 配置。

### 管理后台

- **内容管理**：文章和作品编辑、历史版本恢复、回收站；文章支持草稿预览链接、预约发布与定时下线。
- **媒体管理**：上传图片、查看媒体文件，使用 Sharp 生成优化图片副本。
- **访客分析**：访问记录、地域信息、来源归因、留存与访问路径分析，以及 CSV 导出和 IP 黑名单。
- **安全中心**：管理员密码登录、WebAuthn 通行密钥、会话查看与撤销、操作审计。
- **备份恢复**：创建、下载和恢复 `.aebak` 完整备份，支持配置定时备份。
- **运行维护**：通知中心、系统健康检查和站点设置。

## 技术栈

| 部分 | 实现 |
| --- | --- |
| 服务端 | Node.js、Express |
| 页面模板 | EJS、CSS、JavaScript |
| 数据存储 | Node.js 内置 `node:sqlite`，使用 WAL 模式 |
| Markdown | marked、DOMPurify、jsdom |
| 图片处理 | Multer、Sharp |
| 认证与会话 | express-session、SQLite 会话存储、SimpleWebAuthn |
| 访客地域 | MaxMind GeoLite2 City，可降级使用 ip2region |
| 检查与测试 | ESLint、Node.js Test Runner、GitHub Actions |

## 本地运行

### 1. 准备环境

使用 **Node.js 24** 与 npm，与仓库 CI 的 Node.js 主版本保持一致。`package.json` 声明的最低版本为 `22.5.0`，应用依赖 Node.js 内置 SQLite。

下载或克隆本仓库后，在项目根目录执行：

```bash
npm ci
```

### 2. 配置环境变量

将 [`.env.example`](.env.example) 复制为 `.env`。已有 `.env` 时直接编辑，不要覆盖原配置。

macOS / Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

保留模板中的本地运行配置，并填写：

- `ADMIN_PASSWORD`：自定义管理员密码。留空时后台登录被禁用；生产环境要求至少 8 个字符。
- `SESSION_SECRET`：随机会话密钥。生产环境要求至少 24 个字符，且不能使用模板占位值。

可用以下命令生成随机会话密钥，将结果填入 `.env`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 3. 启动应用

```bash
npm run dev
```

开发模式通过 nodemon 监听文件变化并重启。普通启动使用：

```bash
npm start
```

默认访问地址：

- 网站：<http://localhost:3000>
- 管理后台：<http://localhost:3000/admin>

首次启动会自动创建 SQLite 数据库、数据表和默认站点设置，无需手动导入 SQL。使用 `ADMIN_PASSWORD` 登录后台后，即可配置站点、添加文章与作品。

## 环境变量

以下为主要配置；示例见 [`.env.example`](.env.example)，生产校验逻辑见 [`lib/runtimeConfig.js`](lib/runtimeConfig.js)。

| 变量 | 用途与要求 |
| --- | --- |
| `PORT` | HTTP 监听端口，默认 `3000` |
| `NODE_ENV` | 设为 `production` 时启用生产配置校验 |
| `BASE_URL` | 站点完整地址，用于 canonical、RSS、站点地图等；生产环境必须为 HTTPS |
| `ADMIN_PASSWORD` | 管理员登录与敏感操作验证密码 |
| `SESSION_SECRET` | 会话签名密钥 |
| `SESSION_COOKIE_SECURE` | 本地 HTTP 使用 `false`；生产环境必须显式设为 `true` |
| `TRUST_PROXY` | 直连使用 `false`；单层受信任反向代理使用 `1`；支持 `1`–`10`，生产环境必须显式配置 |
| `DATABASE_PATH` | SQLite 文件路径，默认 `database/aeoleaf.db` |
| `BACKUP_DIR` | 备份目录，默认 `database/backups/` |
| `MAXMIND_ACCOUNT_ID` | 可选，下载 GeoLite2 数据库使用的账户 ID |
| `MAXMIND_LICENSE_KEY` | 可选，下载 GeoLite2 数据库使用的许可证密钥 |
| `MAXMIND_DB_PATH` | 可选，GeoLite2 City `.mmdb` 文件路径 |
| `HELMET_CSP_REPORT_ONLY` | 设为 `1` 时以仅报告模式发送 CSP，供策略调试使用 |

访客地域主库需要单独配置和下载。相关命令与部署步骤见 [部署手册](DEPLOYMENT.md#五日志和编码)。IP 地域反映网络出口的大致范围，不能作为访客的精确地址。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动应用 |
| `npm run dev` | 开发模式，文件变化时自动重启 |
| `npm run lint` | 执行 ESLint 检查 |
| `npm test` | 执行单元测试与集成测试 |
| `npm run minify` | 为 `public/css/`、`public/js/` 中的源文件生成压缩文件 |
| `npm run minify:check` | 检查压缩文件是否与源文件同步，不写入文件 |
| `npm run geo:update` | 下载、验证并更新 GeoLite2 地域数据库，需要配置 MaxMind 凭据 |
| `npm run geo:rebuild` | 重新解析历史访客 IP 的地域信息，会更新数据库 |

修改前端 CSS 或 JavaScript 后执行 `npm run minify`，并将对应压缩文件一并提交。

提交前检查：

```bash
npm run lint
npm test
npm run minify:check
```

仓库的 [GitHub Actions 工作流](.github/workflows/ci.yml) 还会执行 `npm audit --omit=dev`。

## 项目结构

```text
.
├── server.js            # 应用入口、中间件与定时任务
├── config/              # SQLite 初始化与数据访问
├── routes/              # 前台、后台与 API 路由
├── middleware/          # 认证、同源检查、限流与上传处理
├── lib/                 # 备份、安全、发布调度、分析等业务模块
├── views/               # EJS 页面、后台模板与公共片段
├── public/              # 样式、脚本、图片与上传资源
├── database/            # SQLite 数据与备份等运行文件
├── scripts/             # 资源压缩、地域库更新与维护脚本
├── test/                # 单元测试与集成测试
├── .github/workflows/   # CI 配置
├── .env.example         # 环境变量模板
└── DEPLOYMENT.md         # 服务器更新、备份与恢复手册
```

## 部署与数据维护

应用需要可运行 Node.js 的服务器和可持久化的磁盘，不能仅通过 GitHub Pages 托管完整功能。

生产安装使用 `npm ci --omit=dev`，配置 HTTPS、会话密钥和可信代理后启动应用。生产配置不合格时，应用会拒绝启动并输出校验原因。使用通行密钥时，`BASE_URL` 的域名须与后台访问域名一致。

完整的 PM2 更新流程、数据库备份与故障恢复说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。该手册中的服务器目录、域名、分支和 PM2 应用名对应原项目环境，部署到其他服务器时需按实际情况调整。

`.env`、SQLite 数据、上传文件、备份和地域数据库均已配置 Git 忽略规则。克隆代码不会带上这些本地运行数据；迁移已有站点时，需要单独迁移或恢复。后台完整备份包含数据库、上传文件和媒体隔离文件，环境密钥仍需单独配置。更新前先备份，保留异地副本，不要在应用运行时直接覆盖 SQLite 文件。
