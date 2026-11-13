import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../../server/app.js";
import { saveSettings, getSettings } from "../../server/db.js";

// 非比赛时间停用系统：大屏与评委端只显示「未开放」，恢复开放后实时还原。
test("closing the system blanks the public screen and judge page until reopened", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const base = "http://localhost:3002",
    password = "system-closed-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "system-closed-browser-secret-longer-32",
    publicUrl: base,
  });
  service.db.exec(
    "INSERT INTO projects(id,name,team,position) VALUES ('p1','项目一','第一代表队',1),('p2','项目二','第二代表队',2);" +
      "INSERT INTO judges(id,name,expires_at) VALUES ('a','评委甲',9999999999999),('b','评委乙',9999999999999),('c','评委丙',9999999999999)",
  );
  saveSettings(service.db, { ...getSettings(service.db), prizes: [1, 1, 0] });
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const publicContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: "reduce",
  });
  const judgeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const operator = await adminContext.newPage(),
    screen = await publicContext.newPage(),
    phone = await judgeContext.newPage();
  const errors = [];
  for (const p of [operator, screen, phone])
    p.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data = {}) => {
    const r = await adminContext.request.post(base + "/api" + path, {
      headers: { Origin: base },
      data,
    });
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const scoreTeam = async (projectId, scores) => {
    for (const [i, id] of ["a", "b", "c"].entries()) {
      const token = service.tokenFor(
        service.db.prepare("SELECT * FROM judges WHERE id=?").get(id),
      );
      const headers = { Origin: base, Authorization: `Bearer ${token}` };
      const d = await (
        await adminContext.request.get(base + "/api/judge/state", { headers })
      ).json();
      const r = await adminContext.request.post(base + "/api/judge/scores", {
        headers,
        data: {
          projectId,
          score: scores[i],
          phase: d.settings.mode,
          round: d.settings.currentRound,
          epoch: d.settings.epoch,
          revision: 0,
        },
      });
      expect(r.status(), await r.text()).toBe(201);
    }
  };
  const runProject = async (id, scores) => {
    await post(`/admin/projects/${id}/status`, { status: "open" });
    await scoreTeam(id, scores);
    await post(`/admin/projects/${id}/status`, { status: "closed" });
  };
  try {
    // 先登录，后续 API 与页面共用同一管理员会话
    await operator.goto(base + "/admin");
    await operator.getByLabel("管理员密码").fill(password);
    await operator.getByRole("button", { name: "登录工作台" }).click();
    await expect(
      operator.getByRole("heading", { name: "比赛控制台" }),
    ).toBeVisible();

    // 走完整场：测试 → 正式 → 发布
    await post("/admin/test/start");
    await runProject("p1", [80, 90, 100]);
    await post("/admin/test/finish");
    await post("/admin/status", { status: "running" });
    await runProject("p1", [78, 88, 92]);
    await runProject("p2", [72, 86, 90]);
    await post("/admin/status", { status: "final" });

    // 大屏处于排名画面，评委链接可用
    await screen.goto(base + "/screen");
    await expect(screen.locator(".stage-heading")).toHaveText("得分排名");
    const token = service.tokenFor(
      service.db.prepare("SELECT * FROM judges WHERE id=?").get("a"),
    );
    await phone.goto(base + "/judge#" + token);
    await expect(phone.getByText("评委 01")).toBeVisible();

    // 后台停用系统（确认框自动接受）
    await operator.goto(base + "/admin");
    operator.on("dialog", (dialog) => dialog.accept());
    await operator.getByRole("button", { name: "停用系统" }).click();
    await expect(operator.getByText("系统已停用 · 对外不展示")).toBeVisible();

    // 大屏不刷新，经 SSE 实时切换为未开放，且不再出现旧名单
    await expect(screen.getByRole("heading", { name: "赛事系统未开放" })).toBeVisible({
      timeout: 10000,
    });
    await expect(screen.getByText("第一代表队")).toHaveCount(0);
    // 评委端显示未开放
    await expect(phone.getByText("评分系统当前未开放")).toBeVisible({
      timeout: 10000,
    });
    // 投屏演示同样呈现未开放画面（控制条提示恢复开放）
    await operator.goto(base + "/admin/present");
    await expect(
      operator.getByRole("heading", { name: "赛事系统未开放" }),
    ).toBeVisible();

    // 恢复开放：大屏不刷新即回到排名画面
    await operator.goto(base + "/admin");
    await operator.getByRole("button", { name: "恢复开放" }).click();
    await expect(screen.locator(".stage-heading")).toHaveText("得分排名", {
      timeout: 10000,
    });
    await expect(phone.getByText("比赛已结束")).toBeVisible({
      timeout: 10000,
    });
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await publicContext.close();
    await judgeContext.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
