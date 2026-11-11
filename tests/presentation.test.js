import test from "node:test";
import assert from "node:assert/strict";
import { resultPages, resultViews } from "../shared/slides.js";
import { fixture } from "./helpers.js";

test("presenter authenticates, rehearses, advances rounds atomically and publishes fixed awards", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/presenter/state")).status, 401);
  assert.equal(
    (await f.request("/admin/presenter/next", "POST", { key: "x" })).status,
    401,
  );
  await f.login();
  await f.configure();
  const state = async () => (await f.request("/admin/presenter/state")).data;
  async function next(type) {
    const s = await state();
    assert.equal(s.presenter.next.type, type);
    await f.ok("/admin/presenter/next", "POST", { key: s.presenter.next.key });
  }
  await f.ok("/admin/presenter/start");
  assert.equal((await state()).settings.presentation.manual, true);
  await next("startTest");
  let p = (await state()).projects[0];
  assert.equal(p.status, "ready");
  const before = (await state()).presenter.next.key;
  const duplicate = await Promise.all(
    [1, 2].map(() =>
      f.request("/admin/presenter/next", "POST", { key: before }),
    ),
  );
  assert.deepEqual(duplicate.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await state()).projects[0].status, "open");
  const tokens = await f.tokens();
  await f.submit(tokens[0], p.id, 80);
  let partial = await state();
  assert.equal(partial.presenter.next.enabled, false);
  assert.equal(partial.projects[0].scores[0].total, undefined);
  assert.equal(
    (
      await f.request("/admin/presenter/next", "POST", {
        key: partial.presenter.next.key,
      })
    ).status,
    409,
  );
  await f.submit(tokens[1], p.id, 90);
  await f.submit(tokens[2], p.id, 100);
  await next("finishTest");
  assert.equal((await state()).projects[0].scores.length, 0);
  await next("startOfficial");
  for (let round = 1; round <= 2; round++) {
    for (let i = 0; i < 2; i++) {
      await next("open");
      p = (await state()).projects[0];
      await f.complete(p.id, [70 + i * 5, 80 + i * 5, 90 + i * 5]);
      if (round === 1 && i === 0) {
        await f.ok("/admin/scores/rejudge", "POST", {
          projectId: p.id,
          judgeIds: [(await state()).judges[1].id],
          reason: "现场重评",
        });
        assert.equal((await state()).settings.presentation.manual, true);
        assert.equal((await state()).presenter.next.type, "waiting");
        assert.ok(
          (await state()).projects[0].scores.every(
            (s) => s.total === undefined,
          ),
        );
        await f.submit(tokens[1], p.id, 80);
      }
      if (i === 0) await next("prepare");
    }
    if (round === 1) {
      await next("round");
      assert.equal((await state()).settings.currentRound, 2);
    }
  }
  await next("publish");
  let s = await state();
  assert.equal(s.settings.status, "final");
  assert.equal(s.settings.presentation.view, "ranking");
  assert.deepEqual(
    s.ranking.map((p) => p.result.average),
    [85, 80],
  );
  await next("view");
  assert.equal((await state()).settings.presentation.view, "teamAwards");
  await next("view");
  assert.equal((await state()).settings.presentation.page, 1);
  await next("view");
  assert.equal((await state()).settings.presentation.view, "individualAwards");
  assert.equal((await state()).presenter.next.enabled, false);
  await f.ok("/admin/presenter/previous", "POST", {
    key: (await state()).presenter.next.key,
  });
  assert.equal((await state()).settings.presentation.view, "teamAwards");
});

test("presenter paginates persisted final slides and handles ties without leaving the screen", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({
    judgeCount: 1,
    projectCount: 9,
    rounds: 1,
    trimEnabled: false,
    prizes: [1, 2, 6],
  });
  const state = async () => (await f.request("/admin/presenter/state")).data;
  const next = async () =>
    f.ok("/admin/presenter/next", "POST", {
      key: (await state()).presenter.next.key,
    });
  for (let i = 0; i < 9; i++)
    await f.ok("/admin/awards", "POST", {
      name: "个人奖",
      recipient: `人员${i}`,
      note: "",
    });
  await f.rehearse();
  await f.ok("/admin/presenter/start");
  await next();
  for (let i = 0; i < 9; i++) {
    await next();
    await f.complete((await state()).projects[0].id, [90]);
    if (i < 8) await next();
  }
  let s = await state();
  assert.equal(s.presenter.next.type, "tie");
  assert.equal(
    (
      await f.request("/admin/presenter/next", "POST", {
        key: s.presenter.next.key,
      })
    ).status,
    409,
  );
  await f.ok("/admin/tiebreak", "POST", {
    projectIds: s.presenter.ties.map((p) => p.id),
    reason: "加赛裁定",
  });
  await next();
  assert.equal((await state()).settings.presentation.view, "ranking");
  await next();
  assert.equal((await state()).settings.presentation.page, 1);
  assert.equal((await f.request("/state")).data.settings.presentation.page, 1);
  await next();
  assert.equal((await state()).settings.presentation.view, "teamAwards");
  await next();
  await next();
  assert.equal((await state()).settings.presentation.page, 2);
  await next();
  assert.equal((await state()).settings.presentation.page, 3);
  await next();
  assert.equal((await state()).settings.presentation.view, "individualAwards");
  await next();
  assert.equal((await state()).settings.presentation.page, 1);
  assert.equal((await state()).presenter.next.enabled, false);
  for (let i = 0; i < 2; i++)
    await f.ok("/admin/presenter/previous", "POST", {
      key: (await state()).presenter.next.key,
    });
  s = await state();
  assert.equal(s.settings.presentation.view, "teamAwards");
  assert.equal(s.settings.presentation.page, 3);
  assert.equal(s.settings.presentation.reviewing, true);
});

test("团体奖从三等奖揭晓，跳过空奖级，同级每四队一页", () => {
  const ranking = [1, 3, 3, 3, 3, 3, null].map((prize, id) => ({ prize, id }));
  assert.deepEqual(resultPages({ ranking }, "teamAwards").map((page) => page.map((team) => team.id)),
    [[1, 2, 3, 4], [5], [0]]);
  ranking[6].prize = 2;
  assert.deepEqual(resultPages({ ranking }, "teamAwards").map((page) => page[0].prize), [3, 3, 2, 1]);
  assert.deepEqual(resultPages({ ranking: [] }, "teamAwards"), []);
  assert.deepEqual(resultViews({ ranking: [], settings: { presentation: { view: "ranking" } } }),
    ["ranking", "individualAwards"]);
});

test("个人奖保持录入顺序，每六人一页", () => {
  const awards = Array.from({ length: 8 }, (_, i) => i);
  assert.deepEqual(resultPages({ awards }, "individualAwards"), [[0, 1, 2, 3, 4, 5], [6, 7]]);
});

test("test phase previews the full award ceremony without touching official results", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure({ rounds: 1 });
  const state = async () => (await f.request("/admin/presenter/state")).data;
  async function next(type) {
    const s = await state();
    assert.equal(s.presenter.next.type, type);
    await f.ok("/admin/presenter/next", "POST", { key: s.presenter.next.key });
  }
  await f.ok("/admin/presenter/start");
  await next("startTest");
  // 第 1 队收齐后仍是“提前结束”入口；公共接口与手动切视图都保持关闭
  let p = (await state()).projects[0];
  await next("open");
  await f.complete(p.id, [80, 90, 100]);
  assert.equal((await state()).presenter.next.type, "finishTest");
  assert.equal((await f.request("/state")).data.ranking.length, 0);
  assert.equal(
    (
      await f.request("/admin/presentation", "POST", { view: "ranking" })
    ).status,
    409,
  );
  // 控制台推进第 2 队（与现场彩排操作一致），打相同分数制造精确同分
  await f.ok(`/admin/projects/${p.id}/status`, "POST", { status: "closed" });
  const second = (await f.state()).projects[1];
  await f.ok(`/admin/projects/${second.id}/status`, "POST", { status: "open" });
  await f.complete(second.id, [80, 90, 100]);
  // 全部收齐：出现同分裁定步骤，直接推进被拒，须先裁定
  const tie = await state();
  assert.equal(tie.presenter.next.type, "tie");
  assert.equal(tie.presenter.ties.length, 2);
  assert.equal(
    (
      await f.request("/admin/presenter/next", "POST", {
        key: tie.presenter.next.key,
      })
    ).status,
    409,
  );
  // 收齐后大屏控制可手动切排名（收官预演入口）
  await f.ok("/admin/presentation", "POST", { view: "ranking" });
  let public1 = (await f.request("/state")).data;
  assert.equal(public1.ranking.length, 2);
  assert.equal(public1.settings.presentation.view, "ranking");
  await f.ok("/admin/presentation", "POST", { view: "project", projectId: p.id });
  await f.ok("/admin/tiebreak", "POST", {
    projectIds: (await f.state()).projects.map((x) => x.id),
    reason: "彩排自动裁定",
  });
  // 进入预演：封存末队、展示测试排名；比赛状态保持进行中
  await next("publishTest");
  let s = await state();
  assert.equal(s.settings.status, "running");
  assert.equal(s.settings.mode, "test");
  assert.equal(s.settings.presentation.view, "ranking");
  assert.deepEqual(
    s.ranking.map((x) => x.result.average),
    [90, 90],
  );
  const public2 = (await f.request("/state")).data;
  assert.equal(public2.ranking.length, 2);
  assert.ok(public2.ranking.every((x) => x.prize));
  // 排名 → 团体奖项（两奖级各一页）→ 个人奖项 → 完成测试
  await next("view");
  assert.equal(s0((await state())).view, "teamAwards");
  await next("view");
  assert.equal(s0((await state())).page, 1);
  await next("view");
  assert.equal(s0((await state())).view, "individualAwards");
  // 预演中允许回看
  await f.ok("/admin/presenter/previous", "POST", {
    key: (await state()).presenter.next.key,
  });
  assert.equal(s0(await state()).view, "teamAwards");
  await next("view");
  await next("finishTest");
  // 回到筹备：测试分保留在隔离账，正式排名与 tie_order 全部归零
  s = await state();
  assert.equal(s.settings.status, "draft");
  assert.equal(s.settings.mode, "official");
  assert.equal(s.ranking.length, 0);
  assert.equal(
    f.service.db
      .prepare("SELECT COUNT(*) n FROM projects WHERE tie_order IS NOT NULL")
      .get().n,
    0,
  );
  assert.equal(
    f.service.db
      .prepare("SELECT COUNT(*) n FROM entries WHERE phase='test'")
      .get().n,
    6,
  );
  assert.equal(
    f.service.db
      .prepare("SELECT COUNT(*) n FROM entries WHERE phase='official'")
      .get().n,
    0,
  );
  function s0(snapshot) {
    return snapshot.settings.presentation;
  }
});
