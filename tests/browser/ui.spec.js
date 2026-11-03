import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { once } from "node:events";
import { saveSettings, getSettings } from "../../server/db.js";

test("disabled trimming skips exclusion, refresh remains safe, mobile stage fits", async ({
  browser,
}) => {
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: "browser-test-password",
    tokenSecret: "browser-signing-secret-at-least-32-characters",
    publicUrl: "http://localhost:3002",
  });
  const db = service.db;
  saveSettings(db, {
    ...getSettings(db),
    trimEnabled: false,
    status: "running",
    testCompleted: true,
    prizes: [1, 0, 0],
  });
  db.exec(
    "INSERT INTO projects(id,name,team,position,status) VALUES ('p','实战技能','第一代表队',1,'open'); INSERT INTO judges(id,name,expires_at) VALUES ('j','保密姓名',9999999999999); INSERT INTO entries VALUES ('official',1,'p','j',9525,'2026-10-31T00:00:00Z')",
  );
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  try {
    await page.goto("http://localhost:3002/");
    await expect(page.locator(".judge-scores")).toContainText("95.25");
    await expect(page.locator(".final-score")).toHaveCount(0);
    await expect(page.locator(".final-score")).toHaveText("95.25分");
    await expect(page.locator(".excluded")).toHaveCount(0);
    await expect(page.getByText("保密姓名")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: ".impeccable/review/mobile-stage-blue.png",
      fullPage: true,
    });
    await page.reload();
    await expect(page.locator(".final-score")).toHaveText("95.25分");
  } finally {
    await context.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
