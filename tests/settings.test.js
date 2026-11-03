import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";

test("live metadata and prize edits preserve scores; scoring changes require a new archived event", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({ rounds: 1 });
  await f.rehearse();
  const { ok, request, state } = f;
  await ok("/admin/status", "POST", { status: "running" });
  let d = await state();
  const p = d.projects[0],
    tokens = await f.tokens();
  await ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
  await f.submit(tokens[0], p.id, 88);
  const epoch = d.settings.epoch;
  await ok("/admin/settings", "PUT", {
    ...d.settings,
    title: "现场改名",
    prizes: [0, 1, 1],
  });
  d = await state();
  assert.equal(d.settings.title, "现场改名");
  assert.equal(d.settings.epoch, epoch);
  assert.equal(d.settings.testCompleted, true);
  assert.equal(d.projects[0].scores[0].total, 8800);
  await ok("/admin/prizes", "PUT", { prizes: [1, 0, 1] });
  assert.equal(
    (await request("/admin/prizes", "PUT", { prizes: [2, 1, 0] })).status,
    400,
  );
  assert.equal(
    (await request("/admin/settings", "PUT", { ...d.settings, rounds: 2 }))
      .status,
    409,
  );
  assert.equal(
    (
      await request("/admin/settings", "PUT", {
        ...d.settings,
        trimEnabled: false,
      })
    ).status,
    409,
  );
  await ok("/admin/awards", "POST", { name: "个人奖", recipient: "甲" });
  const result = await ok("/admin/competitions/new", "POST", { epoch });
  const archive = (await request(`/admin/archives/${result.archiveId}`)).data;
  assert.equal(archive.settings.title, "现场改名");
  assert.equal(
    archive.entries.filter((e) => e.phase === "official")[0].total,
    8800,
  );
  assert.equal(archive.awards[0].recipient, "甲");
  assert.equal(archive.judges.length, 3);
  d = await state();
  assert.equal(d.archives.length, 1);
  assert.equal(d.settings.status, "draft");
  assert.equal(d.settings.demo, false);
  assert.equal(d.settings.testCompleted, false);
  assert.equal(d.projects.length, 2);
  assert.ok(
    d.projects.every((p) => p.scores.length === 0 && p.status === "pending"),
  );
  assert.equal(
    (await request("/judge/state", "GET", undefined, tokens[0])).status,
    401,
  );
  assert.equal(
    (await request("/admin/competitions/new", "POST", { epoch })).status,
    409,
  );
  await f.configure({ rounds: 3, judgeCount: 5, projectCount: 4 });
  assert.equal((await state()).settings.rounds, 3);
  await ok("/logout");
  assert.equal(
    (await request(`/admin/archives/${result.archiveId}`)).status,
    401,
  );
  assert.equal(
    (await request("/admin/competitions/new", "POST", { epoch: epoch + 1 }))
      .status,
    401,
  );
});

test("published awards and settings remain immutable", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({ rounds: 1, projectCount: 1, prizes: [1, 0, 0] });
  await f.rehearse();
  await f.ok("/admin/status", "POST", { status: "running" });
  const d = await f.state(),
    p = d.projects[0];
  await f.ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
  await f.complete(p.id);
  await f.ok(`/admin/projects/${p.id}/status`, "POST", { status: "closed" });
  await f.ok("/admin/status", "POST", { status: "final" });
  assert.equal(
    (await f.request("/admin/prizes", "PUT", { prizes: [0, 1, 0] })).status,
    409,
  );
  assert.equal(
    (
      await f.request("/admin/settings", "PUT", {
        ...d.settings,
        title: "已发布不能改",
      })
    ).status,
    409,
  );
});
