import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("backups", { recursive: true });
const db = new DatabaseSync(
  process.env.DB_PATH || "./data/competition.sqlite",
  { readOnly: true },
);
const target = resolve(
  "backups",
  `competition-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
await backup(db, target);
db.close();
console.log(`一致性备份已保存：${target}`);
