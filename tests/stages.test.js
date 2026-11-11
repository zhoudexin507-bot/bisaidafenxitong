import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, getSettings } from "../server/db.js";
import { fixture } from "./helpers.js";

test("legacy migration is additive, idempotent and preserves tokens and scores", () => {
  const dir = mkdtempSync(join(tmpdir(), "jh-migration-")),
    path = join(dir, "db.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,team TEXT,description TEXT,position INTEGER,status TEXT); INSERT INTO projects VALUES ('p','项目','队伍','',1,'closed'); CREATE TABLE judges(id TEXT PRIMARY KEY,name TEXT,title TEXT,enabled INTEGER,token_version INTEGER,expires_at INTEGER); INSERT INTO judges VALUES ('j','姓名','',1,3,9999999999999); CREATE TABLE scores(project_id TEXT,judge_id TEXT,total INTEGER,details TEXT,submitted_at TEXT,PRIMARY KEY(project_id,judge_id)); INSERT INTO scores VALUES ('p','j',9000,'{}','2026-01-01');",
    );
    legacy
      .prepare("INSERT INTO settings VALUES (1,?)")
      .run(
        JSON.stringify({
          title: "旧赛事",
          status: "final",
          trimEnabled: false,
        }),
      );
    legacy.close();
    let db = openDatabase(path);
    assert.equal(db.prepare("SELECT total FROM entries").get().total, 9000);
    assert.equal(
      db.prepare("SELECT token_version FROM judges").get().token_version,
      3,
    );
    assert.equal(getSettings(db).presentation.view, "ranking");
    assert.equal(getSettings(db).testCompleted, true);
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM entries").get().n, 1);
    assert.equal(db.prepare("SELECT members FROM projects").get().members, "");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy home-title switch migrates into per-layer visibility flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "jh-display-hide-")),
    path = join(dir, "db.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,team TEXT,description TEXT,position INTEGER,status TEXT); CREATE TABLE judges(id TEXT PRIMARY KEY,name TEXT,title TEXT,enabled INTEGER,token_version INTEGER,expires_at INTEGER);",
    );
    legacy
      .prepare("INSERT INTO settings VALUES (1,?)")
      .run(JSON.stringify({ title: "旧赛事", showHomeTitle: false }));
    legacy.close();
    const db = openDatabase(path);
    const home = getSettings(db).displayLayouts.home;
    assert.equal(home.title.hidden, true);
    assert.equal(home.subtitle.hidden, true);
    // Reopening neither duplicates the migration nor flips the flags back.
    db.close();
    const reopened = openDatabase(path);
    const again = getSettings(reopened).displayLayouts.home;
    assert.equal(again.title.hidden, true);
    assert.equal(again.subtitle.hidden, true);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejudging is scoped, hides scores, invalidates drafts and retains audit evidence", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({ rounds: 1 });
  await f.rehearse();
  const { ok, request, state } = f,
    d = await state(),
    p = d.projects[0],
    ts = await f.tokens();
  await ok("/admin/status", "POST", { status: "running" });
  await ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
  await f.complete(p.id);
  const stale = await f.body(ts[0], p.id, 90);
  await t.test(
    "one judge reset preserves others and hides the entire result",
    async () => {
      await ok("/admin/scores/rejudge", "POST", {
        projectId: p.id,
        judgeIds: [d.judges[0].id],
        reason: "录入错误",
      });
      const screen = (await request("/state")).data.projects[0];
      assert.equal(screen.scores.length, 2);
      assert.equal(screen.result.average, null);
      assert.ok(screen.scores.every((s) => !("total" in s)));
      assert.equal(
        (await request("/judge/scores", "POST", stale, ts[0])).status,
        409,
      );
      assert.equal((await f.submit(ts[0], p.id, 95)).status, 201);
      assert.equal((await state()).projects[0].result.average, 95);
    },
  );
  await t.test(
    "invalid batch changes nothing; full reset clears every current score",
    async () => {
      assert.equal(
        (
          await request("/admin/scores/rejudge", "POST", {
            projectId: p.id,
            judgeIds: [d.judges[0].id, "bad"],
            reason: "无效名单",
          })
        ).status,
        400,
      );
      assert.equal((await state()).projects[0].scores.length, 3);
      await ok("/admin/scores/rejudge", "POST", {
        projectId: p.id,
        judgeIds: d.judges.map((j) => j.id),
        reason: "整组重评",
      });
      assert.equal((await state()).projects[0].scores.length, 0);
      await ok("/admin/status", "POST", { status: "paused" });
      assert.equal((await f.submit(ts[0], p.id, 80)).status, 409);
      await ok("/admin/status", "POST", { status: "running" });
      await f.complete(p.id);
      const logs = (await request("/admin/audit.json")).data.filter(
        (l) => l.action === "重新评分",
      );
      assert.equal(logs.length, 2);
      assert.equal(JSON.parse(logs[0].detail).originals[0].total, 8000);
      assert.equal(JSON.parse(logs[1].detail).originals.length, 3);
      await ok(`/admin/projects/${p.id}/status`, "POST", { status: "closed" });
      await ok(`/admin/projects/${d.projects[1].id}/status`, "POST", {
        status: "open",
      });
      assert.equal(
        (
          await request("/admin/scores/rejudge", "POST", {
            projectId: p.id,
            judgeIds: [d.judges[0].id],
            reason: "另一项目正在评分",
          })
        ).status,
        409,
      );
    },
  );
});

test("rejudging a two-judge subset keeps the third score and restores completion", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({ rounds: 1 });
  await f.rehearse();
  const { ok, state } = f,
    d = await state(),
    p = d.projects[0],
    ts = await f.tokens();
  await ok("/admin/status", "POST", { status: "running" });
  await ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
  await f.complete(p.id, [80, 90, 100]);
  assert.equal((await state()).projects[0].result.average, 90);
  await ok("/admin/scores/rejudge", "POST", {
    projectId: p.id,
    judgeIds: [d.judges[0].id, d.judges[1].id],
    reason: "相邻两位评委操作失误",
  });
  // 仅第三人原分保留；管理视图未收齐（部分均分不启用去分），公共接口不泄漏分数
  let after = (await state()).projects[0];
  assert.equal(after.scores.length, 1);
  assert.equal(after.scores[0].judge_id, d.judges[2].id);
  assert.equal(after.result.complete, false);
  assert.equal(after.result.average, 100);
  const screen = (await f.request("/state")).data.projects[0];
  assert.equal(screen.result.average, null);
  assert.ok(screen.scores.every((s) => !("total" in s)));
  // 旧重评版本的草稿提交被拒，随后两位按新版本补交，收齐恢复
  const fresh = await f.body(ts[0], p.id, 85);
  assert.equal(
    (
      await f.request(
        "/judge/scores",
        "POST",
        { ...fresh, revision: fresh.revision - 1 },
        ts[0],
      )
    ).status,
    409,
  );
  assert.equal((await f.submit(ts[0], p.id, 70)).status, 201);
  assert.equal(
    (await f.request("/judge/scores", "POST", await f.body(ts[0], p.id, 71), ts[0]))
      .status,
    409,
  );
  assert.equal((await f.submit(ts[1], p.id, 80)).status, 201);
  after = (await state()).projects[0];
  assert.equal(after.scores.length, 3);
  // 对称去高去低各 1 后保留 [80]，均分 80（而非简单平均 83.33）
  assert.equal(after.result.average, 80);
});
