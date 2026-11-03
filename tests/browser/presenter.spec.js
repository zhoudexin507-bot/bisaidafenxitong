import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { once } from "node:events";
import { saveSettings, getSettings } from "../../server/db.js";

test("button-free presentation runs rehearsal, rejudge, next team and awards in one page", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const base = "http://localhost:3002",
    password = "presenter-browser-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "presenter-browser-secret-longer-than-32",
    publicUrl: base,
  });
  saveSettings(service.db, {
    ...getSettings(service.db),
    title: "警务实战技能比武",
    prizes: [1, 1, 0],
  });
  service.db.exec(
    "INSERT INTO projects(id,name,team,position,members) VALUES ('p1','项目一','第一代表队',1,'张明、李华'),('p2','项目二','第二代表队',2,'王强、陈杰'); INSERT INTO judges(id,name,expires_at) VALUES ('a','不应展示的姓名甲',9999999999999),('b','不应展示的姓名乙',9999999999999),('c','不应展示的姓名丙',9999999999999); INSERT INTO awards VALUES ('award','最佳协作奖','张明','')",
  );
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  const viewer = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    mobile = await viewer.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  mobile.on("pageerror", (e) => errors.push(e.message));
  const state = async () =>
    (await context.request.get(base + "/api/admin/presenter/state")).json();
  const expectStep = async (type) =>
    expect.poll(async () => (await state()).presenter.next.type).toBe(type);
  async function press(key = "ArrowRight") {
    await page.waitForTimeout(700);
    await page.keyboard.press(key);
  }
  async function score(judge, value) {
    const s = await state(),
      p = s.projects[0],
      token = service.tokenFor(
        service.db.prepare("SELECT * FROM judges WHERE id=?").get(judge),
      );
    const headers = { Origin: base, Authorization: `Bearer ${token}` };
    const d = await (
      await context.request.get(base + "/api/judge/state", { headers })
    ).json();
    const r = await context.request.post(base + "/api/judge/scores", {
      headers,
      data: {
        projectId: p.id,
        score: value,
        phase: d.settings.mode,
        round: d.settings.currentRound,
        epoch: d.settings.epoch,
        revision: d.projects.find((x) => x.id === p.id).revision,
      },
    });
    expect(r.status()).toBe(201);
  }
  async function complete(values = [80, 90, 100]) {
    for (let i = 0; i < 3; i++) await score(["a", "b", "c"][i], values[i]);
  }
  const finalScore = () =>
    expect(page.locator(".final-score")).toBeVisible({ timeout: 7000 });
  try {
    await page.goto(base + "/admin/present");
    await page.getByLabel("管理员密码").fill(password);
    await page.getByRole("button", { name: "进入演示", exact: true }).click();
    await expect(page.locator(".presenter-screen")).toBeVisible();
    await expect
      .poll(async () => (await state()).settings.presentation.manual)
      .toBe(true);
    await expect(page.getByRole("button")).toHaveCount(0);
    await press("Space");
    await expectStep("open");
    await expect(page.locator(".badge")).toContainText("准备评分");
    await page.screenshot({
      path: ".impeccable/review/presenter-ready.png",
      fullPage: true,
    });
    await press("PageDown");
    await expectStep("waiting");
    await press();
    await expectStep("waiting");
    await score("a", 80);
    await expect(
      page.locator(".submission-state").filter({ hasText: "已打分" }),
    ).toHaveCount(1);
    await expect(page.locator(".judge-scores")).not.toContainText("80.00");
    await score("b", 90);
    await score("c", 100);
    await expect(page.locator(".stage-score")).toHaveAttribute(
      "data-reveal-step",
      "0",
    );
    await press();
    expect((await state()).settings.mode).toBe("test");
    await finalScore();
    await press();
    await expectStep("startOfficial");
    await press();
    await expectStep("open");
    await press();
    await expectStep("waiting");
    await complete();
    await finalScore();
    await press("r");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("评委 02", { exact: true }).check();
    await page.getByRole("button", { name: "开始重评", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".final-score")).toHaveCount(0);
    await expectStep("waiting");
    await score("b", 91);
    await finalScore();
    await page.waitForTimeout(700);
    await page.locator(".screen-event").click();
    await expectStep("open");
    expect((await state()).projects[0].id).toBe("p2");
    await page.reload();
    await expect(page.locator(".current-info h2")).toContainText("第二代表队");
    await expect(page.getByRole("button")).toHaveCount(0);
    await press("PageDown");
    await expectStep("waiting");
    await complete([70, 80, 90]);
    await finalScore();
    await press();
    await expect(page.locator(".stage-heading")).toHaveText("得分排名");
    await page.screenshot({
      path: ".impeccable/review/presenter-ranking.png",
      fullPage: true,
    });
    await mobile.goto(base + "/screen");
    await expect(mobile.getByRole("button")).toHaveCount(0);
    await mobile.screenshot({
      path: ".impeccable/review/presenter-ranking-mobile.png",
      fullPage: true,
    });
    await press();
    await expect(page.locator(".stage-heading")).toHaveText("团体奖项");
    await expect(page.locator(".winner-members").first()).toHaveText(
      "张明、李华",
    );
    await page.screenshot({
      path: ".impeccable/review/presenter-team-awards.png",
      fullPage: true,
    });
    await press();
    await expect(page.locator(".stage-heading")).toHaveText("个人奖项");
    await page.screenshot({
      path: ".impeccable/review/presenter-personal-awards.png",
      fullPage: true,
    });
    await expectStep("done");
    await expect(page.getByRole("button")).toHaveCount(0);
    await press("ArrowLeft");
    await expect(page.locator(".stage-heading")).toHaveText("团体奖项");
    await press("h");
    await expect(
      page.getByRole("heading", { name: "演示快捷键" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/admin/present");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await viewer.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
