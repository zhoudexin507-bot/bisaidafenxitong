import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { once } from "node:events";
import { saveSettings, getSettings } from "../../server/db.js";

test("control desk, concise single-round screen, editable awards and archive-to-setup flow", async ({
  browser,
}) => {
  const base = "http://localhost:3002",
    password = "control-browser-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "control-browser-signing-secret-more-than-32",
    publicUrl: base,
  });
  const db = service.db;
  saveSettings(db, {
    ...getSettings(db),
    title: "警务实战技能比武",
    status: "running",
    demo: true,
    testCompleted: true,
    prizes: [1, 0, 0],
  });
  db.exec(
    "INSERT INTO projects(id,name,team,position,status) VALUES ('p','山地铁道攀登演练','第三代表队',3,'open'); INSERT INTO judges(id,name,expires_at) VALUES ('a','甲',9999999999999),('b','乙',9999999999999),('c','丙',9999999999999); INSERT INTO entries VALUES ('official',1,'p','a',9000,'2026-10-31T00:00:00Z')",
  );
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    }),
    display = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  const page = await admin.newPage(),
    screen = await display.newPage(),
    phone = await mobile.newPage(),
    errors = [];
  for (const p of [page, screen, phone])
    p.on("pageerror", (e) => errors.push(e.message));
  try {
    await admin.request.post(base + "/api/login", {
      headers: { Origin: base },
      data: { password },
    });
    await page.goto(base + "/admin");
    await expect(
      page.getByRole("heading", { name: "比赛控制台" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "项目与重评", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "等待评委提交" }),
    ).toBeDisabled();
    await page.screenshot({
      path: ".impeccable/review/control-desk.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: "重新评分", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "重新评分", exact: true }),
    ).toBeVisible();
    await screen.goto(base + "/");
    // 队伍名旁以小字号显示项目名称
    await expect(screen.locator(".current-info h2")).toContainText("03");
    await expect(screen.locator(".current-info h2")).toContainText(
      "第三代表队",
    );
    await expect(screen.locator(".stage-project-name")).toHaveText(
      "山地铁道攀登演练",
    );
    await expect(screen.locator(".current-info")).not.toContainText("号队伍");
    await expect(screen.locator(".current-info")).not.toContainText("轮");
    await screen.screenshot({
      path: ".impeccable/review/concise-screen.png",
      fullPage: true,
    });
    await phone.goto(base + "/");
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await phone.screenshot({
      path: ".impeccable/review/concise-screen-mobile.png",
      fullPage: true,
    });
    await page.goto(base + "/admin/rules");
    await expect(page.getByLabel("赛事名称")).toBeEnabled();
    await expect(page.getByLabel("评委人数")).toBeDisabled();
    await expect(page.getByText(/当前为已开赛的演示赛事/)).toBeVisible();
    await expect(page.getByLabel("一等奖名额")).toBeEnabled();
    await page.getByLabel("赛事名称").fill("调整后的比武赛事");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByText("操作已保存")).toBeVisible();
    await page.screenshot({
      path: ".impeccable/review/settings-explained.png",
      fullPage: true,
    });
    await page.goto(base + "/admin/awards");
    await page.getByLabel("一等奖名额").fill("0");
    await page.getByLabel("二等奖名额").fill("1");
    await page.getByRole("button", { name: "保存奖项名额" }).click();
    await expect(page.getByText("操作已保存")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("二等奖名额")).toHaveValue("1");
    await page.goto(base + "/admin/rules");
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "归档并新建比赛" }).click();
    await expect(page.getByLabel("评委人数")).toBeEnabled();
    await expect(page.getByLabel("比赛轮次")).toBeEnabled();
    await page.getByText("历史比赛归档（1）").click();
    await expect(page.getByRole("link", { name: /下载归档/ })).toBeVisible();
    await page.getByLabel("评委人数").fill("5");
    await page.getByLabel("项目数量").fill("2");
    await page.getByLabel("比赛轮次").fill("2");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByText("操作已保存")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("评委人数")).toHaveValue("5");
    const cookies = await admin.cookies();
    await mobile.addCookies(cookies);
    await phone.goto(base + "/admin");
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await phone.screenshot({
      path: ".impeccable/review/control-desk-mobile.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([admin.close(), display.close(), mobile.close()]);
    service.close();
    await new Promise((r) => server.close(r));
  }
});
