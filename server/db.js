import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const defaultSettings = {
  title: "比武竞赛",
  subtitle: "以专业衡量实力 · 让每一份努力被看见",
  status: "draft",
  trimEnabled: true,
  trimHigh: 1,
  trimLow: 1,
  trimSymmetric: true,
  rounds: 1,
  currentRound: 1,
  mode: "official",
  epoch: 0,
  testCompleted: false,
  prizes: [1, 2, 3],
  demo: false,
  revealMode: "auto",
  showTeamNumber: true,
  releasedScores: {},
  // 非比赛时间停用：叠加在任何 status 之上，对外只显示「未开放」
  closed: false,
  stage: { scene: "live", message: "", remainingMs: 0, endsAt: null, version: 0 },
  presentation: { view: "project", projectId: null },
};

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS judges (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, token_version INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scores (project_id TEXT NOT NULL REFERENCES projects(id), judge_id TEXT NOT NULL REFERENCES judges(id), total INTEGER NOT NULL CHECK(total>=0), details TEXT NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY(project_id, judge_id));
    CREATE TABLE IF NOT EXISTS score_revisions (project_id TEXT NOT NULL REFERENCES projects(id), judge_id TEXT NOT NULL REFERENCES judges(id), revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id, judge_id));
    CREATE TABLE IF NOT EXISTS entries (phase TEXT NOT NULL, round INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE, total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 10000), submitted_at TEXT NOT NULL, PRIMARY KEY(phase,round,project_id,judge_id));
    CREATE TABLE IF NOT EXISTS revisions (phase TEXT NOT NULL, round INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE, revision INTEGER NOT NULL, PRIMARY KEY(phase,round,project_id,judge_id));
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS archives (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS awards (id TEXT PRIMARY KEY, name TEXT NOT NULL, recipient TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS backgrounds (kind TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  // Additive migration preserves existing competitions and QR credentials.
  if (
    !db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .some((c) => c.name === "members")
  ) {
    db.exec("ALTER TABLE projects ADD COLUMN members TEXT NOT NULL DEFAULT ''");
  }
  // 个人奖项等级：0=未分组，1/2/3=一/二/三等奖
  if (
    !db
      .prepare("PRAGMA table_info(awards)")
      .all()
      .some((c) => c.name === "level")
  )
    db.exec("ALTER TABLE awards ADD COLUMN level INTEGER NOT NULL DEFAULT 0");
  db.prepare("INSERT OR IGNORE INTO settings VALUES (1, ?)").run(
    JSON.stringify(defaultSettings),
  );
  if (
    !db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .some((c) => c.name === "tie_order")
  )
    db.exec("ALTER TABLE projects ADD COLUMN tie_order INTEGER");
  if (!db.prepare("SELECT 1 FROM migrations WHERE name='rounds-v1'").get()) {
    transaction(db, () => {
      db.exec(
        "INSERT OR IGNORE INTO entries SELECT 'official',1,project_id,judge_id,total,submitted_at FROM scores; INSERT OR IGNORE INTO revisions SELECT 'official',1,project_id,judge_id,revision FROM score_revisions;",
      );
      const settings = JSON.parse(
        db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      );
      saveSettings(db, {
        ...defaultSettings,
        ...settings,
        presentation: settings.presentation || {
          view: settings.status === "final" ? "ranking" : "project",
          projectId: null,
        },
        trimSymmetric: settings.trimHigh === settings.trimLow,
        testCompleted: settings.testCompleted ?? settings.status !== "draft",
      });
      db.prepare("UPDATE judges SET expires_at=MIN(expires_at,?)").run(
        Date.now() + 48 * 3600000,
      );
      db.prepare("INSERT INTO migrations VALUES ('rounds-v1')").run();
    });
  }
  // The old "hide home title" checkbox becomes per-layer visibility flags.
  if (!db.prepare("SELECT 1 FROM migrations WHERE name='display-hide-v1'").get()) {
    transaction(db, () => {
      const settings = JSON.parse(
        db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      );
      if (settings.showHomeTitle === false) {
        const layouts = settings.displayLayouts || {};
        const home = layouts.home || {};
        saveSettings(db, { ...defaultSettings, ...settings, displayLayouts: {
          ...layouts, home: {
            ...home,
            title: { ...home.title, hidden: true },
            subtitle: { ...home.subtitle, hidden: true },
          },
        } });
      }
      db.prepare("INSERT OR IGNORE INTO migrations VALUES ('display-hide-v1')").run();
    });
  }
  return db;
}

export function getSettings(db) {
  const settings = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE id=1").get().value,
  );
  return {
    ...defaultSettings,
    ...settings,
    presentation: settings.presentation || {
      view: settings.status === "final" ? "ranking" : "project",
      projectId: null,
    },
  };
}
export function saveSettings(db, value) {
  db.prepare("UPDATE settings SET value=? WHERE id=1").run(
    JSON.stringify(value),
  );
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(db, actor, action, detail) {
  db.prepare(
    "INSERT INTO audit(actor,action,detail,created_at) VALUES (?,?,?,?)",
  ).run(actor, action, JSON.stringify(detail), new Date().toISOString());
}
