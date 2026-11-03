import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(s.settings.presentation.page, 2);
});
