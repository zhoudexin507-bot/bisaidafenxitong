import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../../server/app.js";
import { saveSettings, getSettings } from "../../server/db.js";

// 测试阶段收官预演：全部收齐后，主持人在同一投屏页走完
// 同分裁定 → 测试排名 → 团体奖项 → 个人奖项 → 完成测试，画面带「测试预演」角标。
test("presenter previews ranking and awards ceremony inside the test phase", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const base = "http://localhost:3002",
    password = "test-ceremony-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "test-ceremony-browser-secret-longer-than-32",
    publicUrl: base,
  });
  service.db.exec(
    "INSERT INTO projects(id,name,team,position) VALUES ('p1','项目一','第一代表队',1),('p2','项目二','第二代表队',2);" +
      "INSERT INTO judges(id,name,expires_at) VALUES ('a','评委甲',9999999999999),('b','评委乙',9999999999999),('c','评委丙',9999999999999)",
  );
  saveSettings(service.db, { ...getSettings(service.db), prizes: [1, 1, 0] });
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const viewer = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    screen = await viewer.newPage();
  const errors = [];
  for (const p of [page, screen]) p.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data) => {
    const r = await context.request.post(base + "/api" + path, {
      headers: { Origin: base },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const state = async () =>
    (await context.request.get(base + "/api/admin/state")).json();
  // 与现场彩排一致：全体评委给两队打相同分数，制造精确同分
  async function scoreTeam(projectId) {
    for (const id of ["a", "b", "c"]) {
      const token = service.tokenFor(
        service.db.prepare("SELECT * FROM judges WHERE id=?").get(id),
      );
      const headers = { Origin: base, Authorization: `Bearer ${token}` };
      const d = await (
        await context.request.get(base + "/api/judge/state", { headers })
      ).json();
      const r = await context.request.post(base + "/api/judge/scores", {
        headers,
        data: {
          projectId,
          score: 90,
          phase: d.settings.mode,
          round: d.settings.currentRound,
          epoch: d.settings.epoch,
          revision: 0,
        },
      });
      expect(r.status(), await r.text()).toBe(201);
    }
  }
  try {
    await page.goto(base + "/admin/present");
    await page.getByLabel("管理员密码").fill(password);
    await page.getByRole("button", { name: "进入演示", exact: true }).click();
    await expect(page.locator(".presenter-screen")).toBeVisible();
    const press = async (key = "ArrowRight") => {
      await page.waitForTimeout(700);
      await page.keyboard.press(key);
    };
    await press("Space"); // 开始测试评分 → 首队准备
    await expect
      .poll(async () => (await state()).settings.mode)
      .toBe("test");
    await press(); // 开放评分
    await expect
      .poll(async () => (await state()).projects[0].status)
      .toBe("open");
    await scoreTeam("p1");
    // 控制台封存第 1 队、开放第 2 队（测试阶段逐队推进的现场操作方式）
    await post("/admin/projects/p1/status", { status: "closed" });
    await post("/admin/projects/p2/status", { status: "open" });
    await scoreTeam("p2");
    // 等待末队亮分动画收尾，tie 步骤的 waitForReveal 才放行
    await expect(page.locator(".final-score")).toBeVisible({ timeout: 10000 });
    // 下一步进入同分裁定弹层，填写依据后裁定
    await press();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("裁定依据").fill("按出场顺序裁定");
    await page.getByRole("button", { name: "确认顺序", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(screen.locator(".stage-cover")).toHaveCount(0);
    // 下一步展示测试排名：大屏出现排名与「测试预演」角标
    await screen.goto(base + "/screen");
    await press();
    await expect(screen.locator(".stage-heading")).toHaveText("得分排名");
    await expect(screen.getByText("测试预演")).toBeVisible();
    // 刷新大屏仍停留在当前预演页（服务器持久化）
    await screen.reload();
    await expect(screen.locator(".stage-heading")).toHaveText("得分排名");
    // 排名 → 团体奖项（两奖级各一页）→ 个人奖项
    await press();
    await expect(screen.locator(".stage-heading")).toHaveText("团体奖项");
    await press();
    await expect(screen.locator(".stage-heading")).toHaveText("团体奖项");
    await press();
    await expect(screen.locator(".stage-heading")).toHaveText("个人奖项");
    // 预演中允许回看
    await press("ArrowLeft");
    await expect(screen.locator(".stage-heading")).toHaveText("团体奖项");
    await press(); // 回到个人奖项
    await press(); // 完成测试 → 回到筹备，等待进入正式比赛
    await expect
      .poll(async () => (await state()).settings.status)
      .toBe("draft");
    await expect
      .poll(async () => (await state()).settings.mode)
      .toBe("official");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await viewer.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
