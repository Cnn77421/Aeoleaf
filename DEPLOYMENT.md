# Aeoleaf 服务器更新手册

适用环境：

- 项目目录：`/www/wwwroot/aeoleaf`
- Git 分支：`master`
- PM2 应用名：`aeoleaf`
- 站点地址：`https://aeoleaf.com`

## 一、每次更新前

先进入项目并确认当前状态：

```bash
cd /www/wwwroot/aeoleaf
git status --short
git log -1 --oneline
pm2 status aeoleaf
```

如果 `git status --short` 没有输出，可以直接按“日常更新”操作。

如果出现源码、配置或数据库运行文件改动，不要直接执行 `git reset --hard`，先按“本地改动或拉取冲突”处理。

## 二、日常更新

### 1. 停止应用

```bash
pm2 stop aeoleaf
```

确认状态为 `stopped`：

```bash
pm2 status aeoleaf
```

### 2. 备份数据库

```bash
backup_dir="/root/aeoleaf-db-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"

cp -a database/aeoleaf.db "$backup_dir"/
[ -f database/aeoleaf.db-wal ] && cp -a database/aeoleaf.db-wal "$backup_dir"/
[ -f database/aeoleaf.db-shm ] && cp -a database/aeoleaf.db-shm "$backup_dir"/

echo "Database backup: $backup_dir"
```

### 3. 将 WAL 写入数据库本体

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('database/aeoleaf.db'); console.log(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()); db.close();"
```

输出中的 `busy` 必须为 `0`。如果不是 `0`，不要继续更新，先确认没有其他进程仍在访问数据库。

### 4. 拉取代码

```bash
git pull --ff-only origin master
```

使用 `--ff-only` 可以避免服务器上意外生成合并提交。

### 5. 安装生产依赖

```bash
npm ci --omit=dev
```

不要在服务器上使用无参数的 `npm install`，以免锁文件和实际依赖不一致。

### 6. 检查生产配置

```bash
grep -E '^(NODE_ENV|BASE_URL|SESSION_COOKIE_SECURE|TRUST_PROXY)=' .env
grep -q '^SESSION_SECRET=\.\+' .env && echo "SESSION_SECRET set"
grep -q '^ADMIN_PASSWORD=\.\+' .env && echo "ADMIN_PASSWORD set"
```

当前生产配置应满足：

```env
NODE_ENV=production
BASE_URL=https://aeoleaf.com
SESSION_COOKIE_SECURE=true
TRUST_PROXY=1
```

`SESSION_SECRET` 至少 24 个字符，`ADMIN_PASSWORD` 至少 8 个字符。不要将它们输出到聊天、日志或截图中。

如果 Node 直接对公网提供服务而不是位于 nginx 后面，使用：

```env
TRUST_PROXY=false
```

### 7. 启动应用

```bash
pm2 restart aeoleaf --update-env
pm2 save
```

如果 PM2 中没有该应用：

```bash
pm2 start npm --name aeoleaf -- start
pm2 save
```

### 8. 验证部署

```bash
pm2 status aeoleaf
pm2 logs aeoleaf --lines 50 --nostream
curl -I https://aeoleaf.com
git status --short
git log -1 --oneline
```

预期结果：

- PM2 状态为 `online`
- 网站返回 `HTTP/2 200` 或 `HTTP/1.1 200`
- 日志包含 `aeoleaf running on http://localhost:3000`
- `git status --short` 没有输出
- Git 最新提交与 GitHub `master` 一致

抽查数据库：

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('database/aeoleaf.db', { readOnly: true });
console.log({
  posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
  works: db.prepare('SELECT COUNT(*) AS n FROM works').get().n,
  guestbook: db.prepare('SELECT COUNT(*) AS n FROM guestbook').get().n
});
db.close();
"
```

Node 输出 `ExperimentalWarning: SQLite is an experimental feature` 属于内置 SQLite 提示，不代表启动失败。

## 三、本地改动或拉取冲突

### 只有 WAL/SHM 文件冲突

新版仓库已忽略 WAL、SHM 和 journal 文件，正常情况下以后不会再次出现。旧部署首次更新时若仍提示：

```text
database/aeoleaf.db-shm
database/aeoleaf.db-wal
would be overwritten by merge
```

必须先停止 PM2、备份数据库并执行 checkpoint，然后运行：

```bash
git stash push -m "server database runtime files" -- \
  database/aeoleaf.db-wal \
  database/aeoleaf.db-shm

git pull --ff-only origin master
```

不要执行 `git stash pop`。旧 WAL/SHM 不能覆盖更新后的数据库运行文件。

确认站点和数据正常后查看并删除对应 stash：

```bash
git stash list
git stash drop 'stash@{0}'
```

删除 stash 前必须保留 `/root/aeoleaf-db-backup-*` 实体备份。

### 出现其他源码或配置改动

先查看差异：

```bash
git status --short
git diff
```

不要盲目覆盖。服务器上的 `.env` 本来就不会被 Git 跟踪；其他源码改动需要先判断是临时修改还是必须保留的服务器修复。

需要临时保存时：

```bash
git stash push -m "server local changes before update"
git pull --ff-only origin master
git stash show -p 'stash@{0}'
```

先审查 stash 内容，再决定是否逐项恢复，不要直接 `stash pop`。

## 四、更新失败后的恢复

### 应用无法启动

```bash
pm2 status aeoleaf
pm2 logs aeoleaf --lines 100 --nostream
grep -E '^(NODE_ENV|BASE_URL|SESSION_COOKIE_SECURE|TRUST_PROXY)=' .env
```

常见原因：

- `BASE_URL` 不是 HTTPS
- `SESSION_COOKIE_SECURE` 不是 `true`
- 未显式设置 `TRUST_PROXY`
- `SESSION_SECRET` 或 `ADMIN_PASSWORD` 太短
- 3000 端口被其他进程占用
- `npm ci --omit=dev` 未成功完成

### 数据异常

立即停止应用：

```bash
pm2 stop aeoleaf
```

不要在应用运行时直接覆盖 SQLite 文件。先记录当前数据库文件，再从本次更新前打印的备份目录恢复。恢复前至少同时保留当前损坏现场和旧备份两份副本。

### 回退代码

先找到上一个正常提交：

```bash
git log --oneline -10
```

服务器部署建议切到明确提交验证，不要使用 `git reset --hard`：

```bash
git switch --detach <正常提交哈希>
npm ci --omit=dev
pm2 restart aeoleaf --update-env
```

恢复到最新 `master`：

```bash
pm2 stop aeoleaf
git switch master
git pull --ff-only origin master
npm ci --omit=dev
pm2 restart aeoleaf --update-env
```

代码回退不会自动回退数据库结构或数据，因此每次更新前的数据库备份不能省略。

## 五、日志和编码

查看日志：

```bash
pm2 logs aeoleaf --lines 100
```

`[track] geo` 是访客定位日志，不是错误。重复 IP 可能来自搜索引擎、社交平台预览或自动扫描。

终端中文乱码时检查：

```bash
locale
```

当前终端可临时切换为 UTF-8：

```bash
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
```

## 六、最短更新清单

确认工作区干净时，可按顺序执行：

```bash
cd /www/wwwroot/aeoleaf
pm2 stop aeoleaf

backup_dir="/root/aeoleaf-db-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -a database/aeoleaf.db "$backup_dir"/
[ -f database/aeoleaf.db-wal ] && cp -a database/aeoleaf.db-wal "$backup_dir"/
[ -f database/aeoleaf.db-shm ] && cp -a database/aeoleaf.db-shm "$backup_dir"/

node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('database/aeoleaf.db'); console.log(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()); db.close();"

git pull --ff-only origin master
npm ci --omit=dev
pm2 restart aeoleaf --update-env
pm2 save

pm2 status aeoleaf
pm2 logs aeoleaf --lines 50 --nostream
curl -I https://aeoleaf.com
git status --short
```
