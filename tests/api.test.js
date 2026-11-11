import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./helpers.js";

test("configured rehearsal, two rounds, fixed awards, persistence and security", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jh-rounds-"));
  const f = await fixture(t, { dbPath: join(dir, "db.sqlite") });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { request, ok, state } = f;
  await t.test("authentication and request origin", async () => {
    assert.equal((await request("/admin/state")).status, 401);
    assert.equal(
      (
        await request(
          "/login",
          "POST",
          { password: f.config.adminPassword },
          undefined,
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/login", "POST", { password: "incorrect" })).status,
      401,
    );
    const login = await f.login();
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  });
  await t.test(
    "scale, symmetric and asymmetric trim, fixed quotas, 7-day credentials",
    async () => {
      await f.configure();
      let d = await state();
      assert.equal(d.judges.length, 3);
      assert.equal(d.projects.length, 2);
      assert.equal(d.settings.rounds, 2);
      assert.ok(
        d.judges.every(
          (j) =>
            j.expires_at > Date.now() + 6.9 * 86400000 &&
            j.expires_at <= Date.now() + 7 * 86400000,
        ),
      );
      assert.equal(
        (
          await request("/admin/settings", "PUT", {
            ...d.settings,
            judgeCount: 2,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/admin/settings", "PUT", {
            ...d.settings,
            prizes: [2, 1, 0],
          })
        ).status,
        400,
      );
      await f.configure({
        judgeCount: 5,
        trimSymmetric: false,
        trimHigh: 2,
        trimLow: 0,
      });
      assert.equal((await state()).settings.trimLow, 0);
      await f.configure({ trimSymmetric: true, trimHigh: 1, trimLow: 0 });
      assert.equal((await state()).settings.trimLow, 1);
      const j = (await state()).judges[0];
      assert.match((await request(`/admin/judges/${j.id}/qr`)).data, /<svg/);
    },
  );
  const d = await state(),
    p = d.projects,
    ts = await f.tokens();
  await t.test(
    "mandatory rehearsal, no official score contamination, stale test rejection",
    async () => {
      assert.equal(
        (await request("/admin/status", "POST", { status: "running" })).status,
        409,
      );
      await ok("/admin/test/start");
      // 完成测试不再要求任何评委先完成评分
      await ok("/admin/test/finish");
      await ok("/admin/test/start");
      await ok(`/admin/projects/${p[0].id}/status`, "POST", { status: "open" });
      const stale = await f.body(ts[0], p[0].id, 50);
      await f.complete(p[0].id, [10, 20, 30]);
      // 测试阶段管理端排名按测试分展示（收官预演的数据源），公共接口仍隐藏
      assert.equal((await state()).ranking.length, 1);
      assert.equal((await request("/state")).data.ranking.length, 0);
      await ok("/admin/test/finish");
      assert.equal((await state()).projects[0].scores.length, 0);
      // 完成测试后回到正式口径：测试分不进入正式排名
      assert.equal((await state()).ranking.length, 0);
      await ok("/admin/status", "POST", { status: "running" });
      await ok(`/admin/projects/${p[0].id}/status`, "POST", {
        status: "ready",
      });
      assert.equal((await f.submit(ts[0], p[0].id, 90)).status, 409);
      await ok(`/admin/projects/${p[0].id}/status`, "POST", { status: "open" });
      assert.equal(
        (await request("/judge/scores", "POST", stale, ts[0])).status,
        409,
      );
    },
  );
  await t.test(
    "single open project, validation, simultaneous idempotent submissions, anonymous display",
    async () => {
      assert.equal(
        (
          await request(`/admin/projects/${p[1].id}/status`, "POST", {
            status: "open",
          })
        ).status,
        409,
      );
      assert.equal(
        (await request("/admin/judges", "POST", { name: "late" })).status,
        409,
      );
      const body = await f.body(ts[0], p[0].id, 80);
      assert.equal((await request("/judge/scores", "POST", body)).status, 401);
      assert.equal(
        (await request("/judge/scores", "POST", body, ts[0] + "x")).status,
        401,
      );
      for (const score of [-1, 101, 90.001, null, "90"])
        assert.equal(
          (await request("/judge/scores", "POST", { ...body, score }, ts[0]))
            .status,
          400,
        );
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request("/judge/scores", "POST", body, ts[0]),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 201).length, 1);
      assert.equal(responses.filter((r) => r.data.duplicate).length, 9);
      assert.equal((await f.submit(ts[0], p[0].id, 81)).status, 409);
      const screen = (await request("/state")).data;
      assert.equal(screen.projects.length, 1);
      assert.equal(screen.projects[0].scores.length, 1);
      assert.equal(screen.projects[0].result.average, null);
      assert.ok(!("total" in screen.projects[0].scores[0]));
      assert.ok(!("roundResults" in screen.projects[0]));
      assert.ok(!("overall" in screen.projects[0]));
      assert.ok(screen.judges.every((j) => !("name" in j) && !("title" in j)));
      assert.equal(screen.ranking.length, 0);
      const own = (await request("/judge/state", "GET", undefined, ts[0])).data
        .projects[0];
      assert.equal(own.ownScore.total, 8000);
      assert.ok(!("scores" in own));
      await f.submit(ts[1], p[0].id, 90);
      await f.submit(ts[2], p[0].id, 100);
      const full = (await request("/state")).data.projects[0];
      assert.equal(full.result.average, 90);
      assert.equal(full.result.droppedHigh.length, 1);
      assert.equal(full.result.droppedLow.length, 1);
    },
  );
  let stale;
  await t.test(
    "all projects must close before advancing rounds; each round stays isolated",
    async () => {
      stale = await f.body(ts[0], p[0].id, 80);
      assert.equal(
        (await request("/admin/round/next", "POST", {})).status,
        409,
      );
      await ok(`/admin/projects/${p[0].id}/status`, "POST", {
        status: "closed",
      });
      await ok(`/admin/projects/${p[1].id}/status`, "POST", { status: "open" });
      await f.complete(p[1].id, [70, 80, 90]);
      await ok(`/admin/projects/${p[1].id}/status`, "POST", {
        status: "closed",
      });
      assert.equal((await state()).ranking.length, 0);
      assert.equal(
        (await request("/admin/status", "POST", { status: "final" })).status,
        409,
      );
      await ok("/admin/round/next");
      assert.equal((await state()).settings.currentRound, 2);
      assert.equal((await state()).projects[0].scores.length, 0);
      await ok(`/admin/projects/${p[0].id}/status`, "POST", { status: "open" });
      assert.equal(
        (await request("/judge/scores", "POST", stale, ts[0])).status,
        409,
      );
      await f.complete(p[0].id, [60, 70, 80]);
      await ok(`/admin/projects/${p[0].id}/status`, "POST", {
        status: "closed",
      });
      await ok(`/admin/projects/${p[1].id}/status`, "POST", { status: "open" });
      await f.complete(p[1].id, [70, 80, 90]);
      await ok(`/admin/projects/${p[1].id}/status`, "POST", {
        status: "closed",
      });
      assert.deepEqual(
        (await state()).ranking.map((p) => p.result.average),
        [80, 80],
      );
      assert.deepEqual(
        (await state()).projects[0].roundResults.map((r) => r.average),
        [90, 70],
      );
    },
  );
  await t.test(
    "ties require explicit order and never exceed fixed award quotas",
    async () => {
      assert.equal(
        (await request("/admin/status", "POST", { status: "final" })).status,
        409,
      );
      assert.equal(
        (
          await request("/admin/tiebreak", "POST", {
            projectIds: [p[0].id, p[0].id],
            reason: "复核",
          })
        ).status,
        400,
      );
      await ok("/admin/tiebreak", "POST", {
        projectIds: [p[1].id, p[0].id],
        reason: "按赛前公布的同分规则复核",
      });
      const ranking = (await state()).ranking;
      assert.deepEqual(
        ranking.map((p) => p.prize),
        [1, 2],
      );
      assert.equal(ranking[0].id, p[1].id);
      await ok(`/admin/projects/${p[0].id}/members`, "PUT", {
        members: "甲、乙",
      });
      await ok("/admin/awards", "POST", {
        name: "个人风采奖",
        recipient: "丙",
      });
      await ok("/admin/status", "POST", { status: "final" });
      const csv = (await request("/admin/export.csv")).data;
      assert.match(csv, /80.00/);
      assert.match(csv, /个人风采奖/);
      assert.match(csv, /甲、乙/);
      assert.match(csv, /轮次/);
      assert.equal(
        (await request("/admin/status", "POST", { status: "running" })).status,
        409,
      );
      assert.equal(
        (
          await request("/admin/scores/rejudge", "POST", {
            projectId: p[0].id,
            judgeIds: [d.judges[0].id],
            reason: "late",
          })
        ).status,
        409,
      );
      assert.equal(
        (await request("/state")).data.settings.presentation.view,
        "ranking",
      );
      await ok("/admin/presentation", "POST", { view: "teamAwards" });
      assert.equal((await request("/state")).data.ranking.length, 2);
      await ok("/admin/presentation", "POST", { view: "individualAwards" });
      assert.equal((await request("/state")).data.awards[0].recipient, "丙");
      assert.equal((await request("/state")).data.ranking.length, 0);
    },
  );
  await t.test("credential rotation, disabled and expired links", async () => {
    const id = d.judges[0].id;
    await ok(`/admin/judges/${id}/access`, "POST", {
      rotate: true,
      days: 30,
    });
    assert.equal(
      (await request("/judge/state", "GET", undefined, ts[0])).status,
      401,
    );
    ts[0] = (await f.tokens())[0];
    let j = (await state()).judges[0];
    assert.ok(j.expires_at <= Date.now() + 30 * 86400000);
    await ok(`/admin/judges/${id}/access`, "POST", { enabled: false });
    assert.equal(
      (await request("/judge/state", "GET", undefined, ts[0])).status,
      403,
    );
    await ok(`/admin/judges/${id}/access`, "POST", { enabled: true });
    f.service.db.prepare("UPDATE judges SET expires_at=0 WHERE id=?").run(id);
    assert.equal(
      (await request("/judge/state", "GET", undefined, ts[0])).status,
      403,
    );
    await ok(`/admin/judges/${id}/access`, "POST", { rotate: true });
    ts[0] = (await f.tokens())[0];
    j = (await state()).judges[0];
    // 未指定 days 时默认续期 7 天
    assert.ok(
      j.expires_at > Date.now() + 6.9 * 86400000 &&
        j.expires_at <= Date.now() + 7 * 86400000,
    );
  });
  await t.test(
    "restart retains rounds, sessions, links and SSE catchup",
    async () => {
      await f.restart();
      assert.equal((await state()).ranking[0].result.average, 80);
      assert.equal((await state()).settings.status, "final");
      assert.equal(
        (await request("/judge/state", "GET", undefined, ts[0])).status,
        200,
      );
      const controller = new AbortController();
      const response = await fetch(f.base + "/events", {
        signal: controller.signal,
      });
      const reader = response.body.getReader();
      assert.match(
        new TextDecoder().decode((await reader.read()).value),
        /event: update/,
      );
      await ok("/admin/presentation", "POST", { view: "ranking" });
      assert.match(
        new TextDecoder().decode((await reader.read()).value),
        /event: update/,
      );
      controller.abort();
      await ok("/logout");
      assert.equal((await request("/admin/state")).status, 401);
    },
  );
});

test("login rate limit locks out repeated failures", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 15; i++)
    assert.equal(
      (await f.request("/login", "POST", { password: `wrong-${i}` })).status,
      401,
    );
  // 第 16 次即使密码正确也被限流；成功登录本就不计入配额
  assert.equal(
    (await f.request("/login", "POST", { password: f.config.adminPassword }))
      .status,
    429,
  );
});

test("write endpoints reject untrusted origins beyond login", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();
  const evil = { Origin: "https://evil.example" };
  const d = await f.state(),
    ts = await f.tokens();
  assert.equal(
    (
      await f.request(
        "/admin/settings",
        "PUT",
        { ...d.settings, title: "篡改" },
        undefined,
        evil,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/admin/test/start", "POST", {}, undefined, evil)).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "/judge/scores",
        "POST",
        { projectId: d.projects[0].id, score: 1 },
        ts[0],
        evil,
      )
    ).status,
    403,
  );
  // 同源写请求不受影响
  assert.equal(
    (await f.request("/admin/prizes", "PUT", { prizes: [1, 1, 0] })).status,
    200,
  );
});

test("stale epoch submissions are rejected with a valid token", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();
  const d = await f.state(),
    ts = await f.tokens();
  await f.ok("/admin/test/start");
  await f.ok(`/admin/projects/${d.projects[0].id}/status`, "POST", {
    status: "open",
  });
  // 测试阶段的请求体：完成测试后 epoch 递增，phase/round 都改为正确仍应被拒
  const body = await f.body(ts[0], d.projects[0].id, 80);
  await f.complete(d.projects[0].id);
  await f.ok("/admin/test/finish");
  await f.ok("/admin/status", "POST", { status: "running" });
  await f.ok(`/admin/projects/${d.projects[0].id}/status`, "POST", {
    status: "open",
  });
  const stale = { ...body, phase: "official" };
  const rejected = await f.request("/judge/scores", "POST", stale, ts[0]);
  assert.equal(rejected.status, 409);
  assert.match(rejected.data.error, /赛程已更新/);
  assert.equal((await f.submit(ts[0], d.projects[0].id, 80)).status, 201);
});
