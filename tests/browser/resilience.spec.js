import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../../server/app.js";

// 大屏在 SSE 中断时的三条生命线：15 秒轮询兜底、EventSource 自动重连、
// 断网恢复后的 online 刷新。场景画面（中场休息 / 候场）作为可观察信号。
test("screen falls back to polling when SSE is broken and recovers live updates", async ({ browser }) => {
  test.setTimeout(90000);
  const base = "http://localhost:3002",
    password = "resilience-browser-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "resilience-browser-secret-longer-than-32",
    publicUrl: base,
  });
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: "reduce",
  });
  const screen = await context.newPage();
  const errors = [];
  screen.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data, method = "post") => {
    const r = await context.request[method](base + "/api" + path, {
      headers: { Origin: base },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  };
  const stageVersion = async () =>
    (await (await context.request.get(base + "/api/admin/state")).json()).settings
      .stage.version || 0;
  try {
    await post("/login", { password });
    const initial = await (
      await context.request.get(base + "/api/admin/state")
    ).json();
    await post(
      "/admin/settings",
      {
        ...initial.settings,
        judgeCount: 1,
        projectCount: 1,
        rounds: 1,
        trimEnabled: false,
        prizes: [1, 0, 0],
      },
      "put",
    );
    // 从页面加载起就中断所有 SSE 连接：大屏只能依赖 15 秒轮询兜底
    await screen.route("**/api/events", (route) => route.abort());
    await screen.goto(base + "/screen");
    await expect(screen.locator(".stage-cover")).toHaveCount(0);
    // 服务端切入中场休息，轮询应在 15 秒周期 + 缓冲内让大屏跟进
    await post("/admin/stage", {
      action: "scene",
      scene: "break",
      message: "轮询兜底生效",
      seconds: 0,
      version: await stageVersion(),
    });
    await expect(screen.getByRole("heading", { name: "中场休息" })).toBeVisible({
      timeout: 20000,
    });
    await expect(screen.getByText("轮询兜底生效")).toBeVisible();
    // 解除拦截后 EventSource 自动重连，恢复推送应明显快于 15 秒轮询周期
    await screen.unroute("**/api/events");
    await post("/admin/stage", {
      action: "scene",
      scene: "live",
      seconds: 0,
      version: await stageVersion(),
    });
    await expect(screen.locator(".stage-cover")).toHaveCount(0, {
      timeout: 9000,
    });
    // 真实断网：期间服务端切换画面，恢复联网后 online 事件 + 重连让大屏追上
    await context.setOffline(true);
    await post("/admin/stage", {
      action: "scene",
      scene: "standby",
      message: "断网恢复验证",
      seconds: 0,
      version: await stageVersion(),
    });
    await screen.waitForTimeout(2000);
    await expect(
      screen.getByRole("heading", { name: "比赛即将开始" }),
    ).toHaveCount(0);
    await context.setOffline(false);
    await expect(
      screen.getByRole("heading", { name: "比赛即将开始" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(screen.getByText("断网恢复验证")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
