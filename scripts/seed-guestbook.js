// One-off seed: adds a few sample guestbook messages with hand-picked
// timestamps. Idempotent — matches existing rows by message text, so
// re-running updates them in place instead of creating duplicates.
//
// IMPORTANT: run with the dev server stopped. The server keeps its own
// in-memory copy of the SQLite database and would overwrite this file on
// its next write (e.g. visitor tracking). Sequence:
//   1. stop the dev server
//   2. node scripts/seed-guestbook.js
//   3. start the dev server again

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initDB, db, saveDBSync } = require('../config/db');

const MESSAGES = [
  { name: 'Wyl',  message: '生日快乐！愿你新的一岁，写的字越来越多，熬的夜越来越少。', created_at: '2026-05-21 08:42:13' },
  { name: 'Jo',   message: '第一次逛到这个小站，排版和配色都好舒服，会常来的。',       created_at: '2026-05-12 22:05:48' },
  { name: 'Mira', message: '祝风叶生日快乐呀，新的一岁也要做喜欢的事、见喜欢的人。',   created_at: '2026-05-21 00:07:36' },
  { name: 'El',   message: '从你的作品里学到了好多，谢谢你愿意把这些都分享出来。',     created_at: '2026-05-06 17:23:09' },
  { name: 'Tao',  message: '大一就能独立做出这样完整的网站，真的很厉害，继续加油！🎂', created_at: '2026-05-20 23:51:02' }
];

async function main() {
  await initDB();

  let added = 0;
  let updated = 0;
  for (const m of MESSAGES) {
    const existing = db.prepare(
      'SELECT id FROM guestbook WHERE message = ?'
    ).get(m.message);
    if (existing) {
      db.prepare(
        'UPDATE guestbook SET name = ?, created_at = ? WHERE id = ?'
      ).run(m.name, m.created_at, existing.id);
      updated++;
      console.log(`updated: ${m.name} @ ${m.created_at}`);
    } else {
      db.prepare(
        'INSERT INTO guestbook (name, message, avatar, created_at) VALUES (?, ?, ?, ?)'
      ).run(m.name, m.message, '', m.created_at);
      added++;
      console.log(`added: ${m.name} @ ${m.created_at}`);
    }
  }

  saveDBSync();
  console.log(`\nDone. ${added} added, ${updated} updated.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
