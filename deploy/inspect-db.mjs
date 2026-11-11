import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/competition.sqlite', { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log('tables:', tables.join(','));
for (const t of tables) {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
    console.log(`  ${t}: ${r.c}`);
  } catch (e) {
    console.log(`  ${t}: err ${e.message}`);
  }
}
db.close();
