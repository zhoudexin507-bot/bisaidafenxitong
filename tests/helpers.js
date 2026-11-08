import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../server/app.js";
export async function fixture(t, overrides = {}) {
  const config = {
    dbPath: ":memory:",
    adminPassword: "integration-test-password",
    tokenSecret: "integration-signing-secret-at-least-32-characters",
    ...overrides,
  };
  let service,
    server,
    base,
    cookie = "";
  async function start() {
    server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    config.publicUrl ??= origin;
    base = origin + "/api";
    service = createApp(config);
    server.on("request", service.app);
  }
  async function stop() {
    service.close();
    await new Promise((r) => server.close(r));
  }
  await start();
  t.after(stop);
  async function request(path, method = "GET", body, token, headers = {}) {
    const raw = body instanceof Uint8Array;
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: config.publicUrl,
        ...(body === undefined
          ? {}
          : raw
            ? { "Content-Type": "application/octet-stream" }
            : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: r.status, data, headers: r.headers };
  }
  async function ok(path, method = "POST", body = {}, headers = {}) {
    const r = await request(path, method, body, undefined, headers);
    assert.ok(r.status < 300, `${path}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  async function login() {
    const r = await request("/login", "POST", {
      password: config.adminPassword,
    });
    cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  const state = async () => (await request("/admin/state")).data;
  async function configure(extra = {}) {
    const s = (await state()).settings;
    return ok("/admin/settings", "PUT", {
      ...s,
      judgeCount: 3,
      projectCount: 2,
      rounds: 2,
      prizes: [1, 1, 0],
      ...extra,
    });
  }
  async function tokens() {
    return Promise.all(
      (await state()).judges.map(
        async (j) =>
          (await request(`/admin/judges/${j.id}/link`)).data.url.split("#")[1],
      ),
    );
  }
  async function body(token, projectId, score) {
    const d = (await request("/judge/state", "GET", undefined, token)).data;
    return {
      projectId,
      score,
      phase: d.settings.mode,
      round: d.settings.currentRound,
      epoch: d.settings.epoch,
      revision: d.projects.find((p) => p.id === projectId).revision,
    };
  }
  async function submit(token, projectId, score) {
    return request(
      "/judge/scores",
      "POST",
      await body(token, projectId, score),
      token,
    );
  }
  async function complete(projectId, values = [80, 90, 100]) {
    const ts = await tokens();
    for (let i = 0; i < ts.length; i++)
      assert.equal((await submit(ts[i], projectId, values[i])).status, 201);
  }
  async function rehearse() {
    await ok("/admin/test/start");
    const p = (await state()).projects[0];
    await ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
    await complete(p.id);
    await ok("/admin/test/finish");
  }
  return {
    get service() {
      return service;
    },
    get base() {
      return base;
    },
    config,
    request,
    ok,
    state,
    login,
    configure,
    tokens,
    body,
    submit,
    complete,
    rehearse,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
