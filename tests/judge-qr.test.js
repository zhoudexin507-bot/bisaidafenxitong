import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";

test("测试二维码：正式阶段拒绝、测试阶段可用、结束后自动失效且正式码不变", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();

  const judges = (await f.state()).judges;
  const officialUrls = [];
  for (const j of judges) {
    const r = await f.request(`/admin/judges/${j.id}/link`);
    assert.equal(r.status, 200);
    officialUrls.push(r.data.url);
  }

  const testLinks = (await f.request("/admin/judges/test-links")).data.judges;
  assert.equal(testLinks.length, judges.length);
  const testTokens = testLinks.map((j) => j.url.split("#")[1]);
  assert.deepEqual(testLinks.map(j => j.expires_at), judges.map(j => j.expires_at));
  // 测试 token 必须与正式 token 不同
  for (const token of testTokens)
    assert.ok(!officialUrls.some((url) => url.endsWith(token)));

  // 非测试阶段（draft / official）使用测试码应被拒绝
  const denied = await f.request(
    "/judge/state",
    "GET",
    undefined,
    testTokens[0],
  );
  assert.equal(denied.status, 403);

  // 进入测试评分阶段后测试码可用
  await f.ok("/admin/test/start");
  const first = judges[0];
  const expire = f.service.db.prepare("UPDATE judges SET expires_at=? WHERE id=?");
  expire.run(Date.now() - 1, first.id);
  for (const token of [testTokens[0], officialUrls[0].split("#")[1]])
    assert.equal((await f.request("/judge/state", "GET", undefined, token)).status, 403);
  await f.ok(`/admin/judges/${first.id}/access`, "POST", { renew: true });
  const state = (
    await f.request("/judge/state", "GET", undefined, testTokens[0])
  ).data;
  assert.equal(state.settings.mode, "test");

  const project = (await f.state()).projects[0];
  await f.ok(`/admin/projects/${project.id}/status`, "POST", {
    status: "open",
  });
  // 测试码与正式码混用提交均有效（都记录在 test 阶段）
  assert.equal(
    (await f.submit(testTokens[0], project.id, 88)).status,
    201,
  );
  const officials = await f.tokens();
  assert.equal(
    (await f.submit(officials[1], project.id, 90)).status,
    201,
  );
  assert.equal(
    (await f.submit(officials[2], project.id, 92)).status,
    201,
  );

  // 完成测试评分后测试码自动失效
  await f.ok("/admin/test/finish");
  const deniedAgain = await f.request(
    "/judge/state",
    "GET",
    undefined,
    testTokens[0],
  );
  assert.equal(deniedAgain.status, 403);
  await f.ok("/admin/status", "POST", { status: "running" });
  await f.ok(`/admin/projects/${project.id}/status`, "POST", { status: "open" });
  const body = await f.body(officials[0], project.id, 95);
  assert.equal((await f.request("/judge/scores", "POST", body, testTokens[0])).status, 403);
  assert.equal((await f.request("/judge/scores", "POST", body, officials[0])).status, 201);

  // 全程正式二维码保持不变
  const judgesAfter = (await f.state()).judges;
  for (let i = 0; i < judgesAfter.length; i++) {
    const r = await f.request(`/admin/judges/${judgesAfter[i].id}/link`);
    assert.equal(r.data.url, officialUrls[i]);
  }

  // 测试二维码 SVG 可正常生成
  const qr = await f.request(
    `/admin/judges/${judgesAfter[0].id}/qr?kind=test`,
  );
  assert.equal(qr.status, 200);
  assert.ok(String(qr.data).includes("<svg"));
});

test("续期不换码：renew 只延长时间，token 与二维码保持稳定", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();

  const judges = (await f.state()).judges;
  const before = (await f.request(`/admin/judges/${judges[0].id}/link`)).data
    .url;
  const expiresBefore = (await f.state()).judges[0].expires_at;

  await f.ok(`/admin/judges/${judges[0].id}/access`, "POST", {
    renew: true,
    days: 7,
  });

  const after = (await f.state()).judges[0];
  assert.equal(
    (await f.request(`/admin/judges/${judges[0].id}/link`)).data.url,
    before,
  );
  assert.ok(after.expires_at > expiresBefore);
  // 旧 token 依然有效
  assert.equal(
    (
      await f.request("/judge/state", "GET", undefined, before.split("#")[1])
    ).status,
    200,
  );

  // 全部续期：所有评委 token 不变、有效期统一延长
  const urlsBefore = [];
  for (const j of (await f.state()).judges)
    urlsBefore.push(
      (await f.request(`/admin/judges/${j.id}/link`)).data.url,
    );
  const renewed = await f.ok("/admin/judges/renew-all", "POST", { days: 14 });
  assert.equal(renewed.count, urlsBefore.length);
  const state = await f.state();
  for (let i = 0; i < state.judges.length; i++) {
    assert.equal(
      (await f.request(`/admin/judges/${state.judges[i].id}/link`)).data.url,
      urlsBefore[i],
    );
    assert.ok(state.judges[i].expires_at - Date.now() > 13 * 86400000);
  }
  await f.ok(`/admin/judges/${judges[0].id}/access`, "POST", { renew: true, days: 1 });
  await f.ok("/admin/judges/renew-all", "POST", { days: 1 });
  assert.deepEqual((await f.state()).judges.map(j => j.expires_at), state.judges.map(j => j.expires_at));
});

test("评委默认有效期 7 天，days 参数可自定义且有上限", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();

  await f.ok("/admin/judges", "POST", { name: "压测观察员", title: "" });
  const added = (await f.state()).judges.at(-1);
  const days = (added.expires_at - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `默认应为 7 天，实际 ${days.toFixed(2)} 天`);

  await f.ok("/admin/judges", "POST", {
    name: "短期评委",
    title: "",
    days: 3,
  });
  const short = (await f.state()).judges.at(-1);
  assert.ok(short.expires_at - Date.now() < 3.1 * 86400000);

  // 超过 30 天应被拒绝
  const bad = await f.request("/admin/judges", "POST", {
    name: "违规评委",
    days: 31,
  });
  assert.equal(bad.status, 400);

  // access 不带任何操作应被拒绝
  const noop = await f.request(`/admin/judges/${added.id}/access`, "POST", {});
  assert.equal(noop.status, 400);
});
