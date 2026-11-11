// 只读校验备份文件：integrity_check + 关键表行数
// 用法：BK=/app/backups/xxx.sqlite node --input-type=module < verify-backup.mjs
import { DatabaseSync } from 'node:sqlite';

const path = process.env.BK;
if (!path) {
  console.error('缺少 BK 环境变量');
  process.exit(2);
}
const db = new DatabaseSync(path, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('integrity_check:', Object.values(integrity)[0]);
const fk = db.prepare('PRAGMA foreign_key_check').all();
console.log('foreign_key_check:', fk.length === 0 ? 'ok' : `${fk.length} 处异常`);
for (const t of ['judges', 'projects', 'scores', 'entries', 'settings', 'audit', 'sessions']) {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
    console.log(`${t}: ${r.c}`);
  } catch (e) {
    console.log(`${t}: 读取失败 ${e.message}`);
  }
}
db.close();
