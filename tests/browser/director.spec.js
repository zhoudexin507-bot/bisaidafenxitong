import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../../server/app.js";

test("director desk, manual reveal, stage timer and mobile layout work together", async ({ browser }) => {
  test.setTimeout(60000);
  const base = "http://localhost:3002", password = "director-browser-password";
  const service = createApp({ dbPath: ":memory:", adminPassword: password, tokenSecret: "director-secret-at-least-32-characters", publicUrl: base });
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const viewer = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage(), screen = await viewer.newPage(), presenter = await context.newPage();
  const errors = [];
  for (const p of [page, screen, presenter]) p.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data = {}, method = "post") => {
    const r = await context.request[method](base + "/api" + path, { headers: { Origin: base }, data });
    expect(r.ok(), await r.text()).toBeTruthy();
  };
  const state = async () => (await context.request.get(base + "/api/admin/state")).json();
  const fit = async (p) => expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const capture = async (p, name) => {
    if (process.env.SKIP_DIRECTOR_CAPTURES !== "1") await p.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  };
  try {
    await post("/login", { password });
    const initial = await state();
    await post("/admin/settings", { ...initial.settings, title: "警务实战技能比武", judgeCount: 5, projectCount: 6, rounds: 1 }, "put");
    await page.goto(base + "/admin");
    await expect(page.getByRole("heading", { name: "赛前检查" })).toBeVisible();
    await page.getByLabel("成绩揭晓方式").selectOption("manual");
    await expect.poll(async () => (await state()).settings.revealMode).toBe("manual");
    await page.getByRole("button", { name: "关闭通知" }).click();
    await capture(page, "director-desktop");
    await fit(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await fit(page);
    await capture(page, "director-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/admin/display");
    await page.getByLabel("候场 / 休息提示").fill("请评委就座，比赛即将开始");
    await page.getByLabel("倒计时（分钟）").fill("0.5");
    await page.getByRole("button", { name: "开场候场", exact: true }).click();
    await expect(page.getByRole("button", { name: "开场候场", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "开始 / 继续计时", exact: true }).click();
    await screen.goto(base + "/screen");
    await expect(screen.getByRole("heading", { name: "比赛即将开始" })).toBeVisible();
    await expect(screen.locator(".stage-clock strong")).toContainText("00:");
    await capture(screen, "director-stage");
    await page.getByRole("button", { name: "关闭通知" }).click();
    await capture(page, "director-controls");
    await page.setViewportSize({ width: 390, height: 844 });
    await fit(page);
    await capture(page, "director-controls-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "暂停倒计时", exact: true }).click();
    await expect.poll(async () => (await state()).settings.stage.endsAt).toBe(null);
    await screen.reload();
    await expect(screen.getByText("倒计时未运行")).toBeVisible();
    await presenter.goto(base + "/admin/present");
    await expect(presenter.locator(".stage-cover")).toBeVisible();
    await expect(presenter.locator(".sr-only[role=status]")).toHaveText("返回比赛画面");
    await presenter.keyboard.press("ArrowRight");
    await expect(presenter.locator(".stage-cover")).toHaveCount(0);
    await presenter.waitForTimeout(700);
    await presenter.keyboard.press("ArrowRight");
    await expect.poll(async () => (await state()).settings.mode).toBe("test");
    await presenter.waitForTimeout(700);
    await presenter.keyboard.press("ArrowRight");
    await expect.poll(async () => (await state()).projects[0].status).toBe("open");
    let d = await state();
    for (const [i, j] of d.judges.entries()) {
      const token = service.tokenFor(service.db.prepare("SELECT * FROM judges WHERE id=?").get(j.id));
      const headers = { Origin: base, Authorization: `Bearer ${token}` };
      const own = await (await context.request.get(base + "/api/judge/state", { headers })).json();
      const r = await context.request.post(base + "/api/judge/scores", { headers, data: { projectId: d.projects[0].id, score: 80 + i * 2, phase: "test", round: 1, epoch: own.settings.epoch, revision: 0 } });
      expect(r.status()).toBe(201);
    }
    await expect(screen.getByText("评分已收齐 · 等待公布")).toBeVisible();
    await expect(screen.locator(".final-score")).toHaveCount(0);
    await expect(presenter.locator(".sr-only[role=status]")).toHaveText("公布本队成绩");
    await presenter.waitForTimeout(700); // Presentation intentionally ignores repeat advances within 650 ms.
    await presenter.keyboard.press("ArrowRight");
    await expect(screen.locator(".final-score")).toHaveText("84.00分", { timeout: 7000 });
    await presenter.keyboard.press("b");
    await expect(screen.getByRole("heading", { name: "中场休息" })).toBeVisible();
    await presenter.keyboard.press("b");
    await expect(screen.locator(".stage-cover")).toHaveCount(0);
    await page.goto(base + "/admin");
    await expect(page.getByText("5 / 5 席近期在线")).toBeVisible();
    await page.goto(base + "/admin/display");
    await page.getByRole("button", { name: "中场休息", exact: true }).click();
    await expect(screen.getByRole("heading", { name: "中场休息" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const value of ["", "121"]) {
      await page.getByLabel("倒计时（分钟）").fill(value);
      await expect(page.getByLabel("倒计时（分钟）")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText("请输入 0–120 分钟")).toBeVisible();
      await expect(page.getByRole("button", { name: "比赛画面", exact: true })).toBeEnabled();
    }
    if (process.env.CAPTURE_DIRECTOR_FIX === "1") await page.screenshot({ path: ".impeccable/review/director-recovery-mobile.png", fullPage: true });
    await page.getByRole("button", { name: "比赛画面", exact: true }).click();
    await expect(screen.locator(".stage-cover")).toHaveCount(0);
    await fit(page);
    await fit(screen);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await viewer.close();
    service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
