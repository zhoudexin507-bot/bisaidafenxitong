import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./helpers.js";
import { changeStage } from "../server/stage.js";

test("manual reveal protects public payloads, rejects stale releases and clears on rejudge", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/reveal", "POST", {})).status, 401);
  await f.login();
  await f.configure();
  await f.rehearse();
  await f.ok("/admin/reveal-mode", "PUT", { mode: "manual" });
  await f.ok("/admin/presenter/start");
  const next = async () => {
    const d = (await f.request("/admin/presenter/state")).data;
    await f.ok("/admin/presenter/next", "POST", { key: d.presenter.next.key });
  };
  await next();
  await next();
  const p = (await f.state()).projects[0];
  assert.equal((await f.request("/admin/reveal-mode", "PUT", { mode: "auto" })).status, 409);
  await f.complete(p.id);
  for (const path of ["/state", "/admin/presenter/state"]) {
    const d = (await f.request(path)).data;
    assert.equal(d.projects[0].result.awaitingReveal, true);
    assert.equal(d.projects[0].result.average, null);
    assert.equal(d.projects[0].result.sum, undefined);
    assert.equal(d.projects[0].releaseKey, undefined);
    assert.equal(d.settings.releasedScores, undefined);
    assert.ok(d.projects[0].scores.every((s) => s.total === undefined));
    assert.equal(d.ranking.length, 0);
  }
  assert.equal((await f.request(`/admin/projects/${p.id}/status`, "POST", { status: "closed" })).status, 409);
  const original = (await f.state()).projects[0].releaseKey;
  assert.equal((await f.request("/admin/reveal", "POST", { projectId: p.id, releaseKey: "old" })).status, 409);
  assert.equal((await f.request("/admin/presenter/state")).data.presenter.next.type, "reveal");
  await next();
  assert.equal((await f.request("/state")).data.projects[0].result.average, 90);
  const judges = (await f.state()).judges;
  await f.ok("/admin/scores/rejudge", "POST", { projectId: p.id, judgeIds: [judges[0].id], reason: "核对后重评" });
  await f.submit((await f.tokens())[0], p.id, 88);
  assert.equal((await f.request("/state")).data.projects[0].result.awaitingReveal, true);
  assert.equal((await f.request("/admin/reveal", "POST", { projectId: p.id, releaseKey: original })).status, 409);
  await f.ok("/admin/reveal", "POST", { projectId: p.id, releaseKey: (await f.state()).projects[0].releaseKey });
  assert.equal((await f.request("/state")).data.projects[0].result.complete, true);
  await f.ok(`/admin/projects/${p.id}/status`, "POST", { status: "closed" });
});

test("stage timer pauses accurately; covers persist, reject concurrent edits and return without advancing", async (t) => {
  let s = changeStage({}, { action: "scene", scene: "break", seconds: 60 }, 1000);
  s = changeStage(s, { action: "start" }, 1000);
  s = changeStage(s, { action: "pause" }, 12000);
  assert.equal(s.stage.remainingMs, 49000);
  s = changeStage(s, { action: "start" }, 20000);
  assert.equal(s.stage.endsAt, 69000);
  s = changeStage(s, { action: "pause" }, 80000);
  assert.equal(s.stage.remainingMs, 0);
  const dir = mkdtempSync(join(tmpdir(), "jh-director-"));
  const f = await fixture(t, { dbPath: join(dir, "test.sqlite") });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal((await f.request("/admin/stage", "POST", {})).status, 401);
  await f.login();
  await f.configure();
  await f.ok("/admin/stage", "POST", { action: "scene", scene: "break", message: "请稍候", seconds: 60, version: 0 });
  assert.equal((await f.request("/admin/stage", "POST", { action: "start", version: 0 })).status, 409);
  await f.ok("/admin/stage", "POST", { action: "start", version: 1 });
  const before = (await f.state()).settings;
  await f.restart();
  const restored = (await f.state()).settings;
  assert.deepEqual(restored.stage, before.stage);
  const ps = (await f.request("/admin/presenter/state")).data;
  assert.equal(ps.presenter.next.type, "returnStage");
  await f.ok("/admin/presenter/next", "POST", { key: ps.presenter.next.key });
  const after = (await f.state()).settings;
  assert.equal(after.stage.scene, "live");
  assert.equal(after.status, before.status);
  assert.deepEqual(after.presentation, before.presentation);
  assert.equal((await f.request("/admin/stage", "POST", { action: "reset", seconds: -1, version: after.stage.version })).status, 400);
});

test("presence comes from authenticated judge requests and is invalidated by credential rotation", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();
  const j = (await f.state()).judges[0];
  assert.equal(j.online, false);
  const token = (await f.tokens())[0];
  await f.request("/judge/state", "GET", undefined, token);
  assert.equal((await f.state()).judges[0].online, true);
  assert.equal((await f.request("/state")).data.judges[0].online, undefined);
  await f.ok(`/admin/judges/${j.id}/access`, "POST", { enabled: true, rotate: true });
  assert.equal((await f.state()).judges[0].online, false);
});
