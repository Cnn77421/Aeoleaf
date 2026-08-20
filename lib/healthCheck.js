const fs = require('fs');
const path = require('path');
const { dbPath } = require('../config/db');
const { BACKUP_ROOT } = require('./backupService');

function bytes(value) {
  const number = Number(value || 0);
  if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(1)} GB`;
  if (number >= 1024 ** 2) return `${(number / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(number / 1024))} KB`;
}

function runHealthChecks(db, env = process.env) {
  const checks = [];
  const add = (id, label, status, message, detail = '') => checks.push({ id, label, status, message, detail });
  try {
    const result = db.prepare('PRAGMA quick_check').get();
    const value = String(result?.quick_check || Object.values(result || {})[0] || 'unknown');
    const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    add('database', 'SQLite 数据库', value === 'ok' ? 'ok' : 'error', value === 'ok' ? '完整性检查通过' : `完整性异常：${value}`, `${dbPath} · ${bytes(size)}`);
  } catch (error) { add('database', 'SQLite 数据库', 'error', '数据库检查失败', error.message); }

  try {
    const stat = fs.statfsSync(path.dirname(dbPath));
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const ratio = total ? free / total : 0;
    const status = free < 512 * 1024 ** 2 || ratio < 0.05 ? 'error' : free < 2 * 1024 ** 3 || ratio < 0.15 ? 'warning' : 'ok';
    add('storage', '磁盘空间', status, `可用 ${bytes(free)}`, `总计 ${bytes(total)} · ${(ratio * 100).toFixed(1)}% 可用`);
  } catch (error) { add('storage', '磁盘空间', 'warning', '无法读取磁盘空间', error.message); }

  const uploadsRoot = path.resolve(env.PUBLIC_DIR || path.resolve(__dirname, '../public'), 'uploads');
  try {
    fs.mkdirSync(uploadsRoot, { recursive: true });
    fs.accessSync(uploadsRoot, fs.constants.R_OK | fs.constants.W_OK);
    add('uploads', '上传目录', 'ok', '目录可读写', uploadsRoot);
  } catch (error) { add('uploads', '上传目录', 'error', '上传目录不可读写', error.message); }

  try {
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });
    fs.accessSync(BACKUP_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    const latest = db.prepare('SELECT * FROM backup_events ORDER BY id DESC LIMIT 1').get();
    const enabled = db.prepare("SELECT value FROM settings WHERE key='backup_schedule_enabled'").get()?.value === '1';
    const status = latest?.outcome === 'failure' ? 'error' : enabled && !latest ? 'warning' : 'ok';
    add('backups', '备份系统', status, latest ? `最近一次：${latest.outcome === 'success' ? '成功' : '失败'}` : enabled ? '定时备份已开启，尚无执行记录' : '目录可读写，定时备份未开启', latest?.created_at || BACKUP_ROOT);
  } catch (error) { add('backups', '备份系统', 'error', '备份目录不可用', error.message); }

  const major = Number(process.versions.node.split('.')[0]);
  add('runtime', 'Node.js 运行时', major >= 22 ? 'ok' : 'error', `Node.js ${process.versions.node}`, `运行 ${Math.floor(process.uptime() / 60)} 分钟 · PID ${process.pid}`);
  const production = env.NODE_ENV === 'production';
  const baseUrl = String(env.BASE_URL || '');
  const secure = !production || /^https:\/\//i.test(baseUrl);
  add('security', '生产安全配置', secure ? 'ok' : 'error', production ? (secure ? 'HTTPS 基础地址有效' : '生产环境 BASE_URL 必须使用 HTTPS') : '当前为开发环境', baseUrl || 'BASE_URL 未设置');

  const memory = process.memoryUsage();
  add('memory', '进程内存', memory.rss > 1024 ** 3 ? 'warning' : 'ok', `RSS ${bytes(memory.rss)}`, `Heap ${bytes(memory.heapUsed)} / ${bytes(memory.heapTotal)}`);
  return { checkedAt: new Date().toISOString(), checks, summary: { ok: checks.filter((item) => item.status === 'ok').length, warning: checks.filter((item) => item.status === 'warning').length, error: checks.filter((item) => item.status === 'error').length } };
}

function recordHealthSnapshot(db, health) {
  const status = health.summary.error ? 'error' : health.summary.warning ? 'warning' : 'ok';
  const previous = db.prepare('SELECT status FROM health_snapshots ORDER BY id DESC LIMIT 1').get();
  db.prepare('INSERT INTO health_snapshots (status,ok_count,warning_count,error_count,details_json) VALUES (?,?,?,?,?)')
    .run(status, health.summary.ok, health.summary.warning, health.summary.error, JSON.stringify(health.checks));
  db.prepare('DELETE FROM health_snapshots WHERE id NOT IN (SELECT id FROM health_snapshots ORDER BY id DESC LIMIT 500)').run();
  return { status, previousStatus: previous?.status || '', changed: previous?.status !== status };
}

module.exports = { runHealthChecks, recordHealthSnapshot, bytes };
