import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createApp } from "../../server/app.js";

const pdfPages = (buffer) =>
  (buffer.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) || []).length;

// 评委二维码打印：既支持「多码一页」网格，也支持「单页单码」逐页打印。
test("judge QR print pages support grid and single-per-page modes", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const base = "http://localhost:3002",
    password = "print-modes-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "print-modes-secret-at-least-32-characters",
    publicUrl: base,
  });
  const judges = 5;
  service.db.exec(
    "INSERT INTO projects(id,name,team,position,status) VALUES ('p','实战技能','第一代表队',1,'open');" +
      Array.from(
        { length: judges },
        (_, i) =>
          `INSERT INTO judges(id,name,expires_at) VALUES ('j${i}','评委${i}',9999999999999);`,
      ).join(""),
  );
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  try {
    expect(
      (
        await context.request.post(base + "/api/login", {
          headers: { Origin: base },
          data: { password },
        })
      ).ok(),
    ).toBeTruthy();
    for (const [path, name] of [
      ["/admin/print", "official"],
      ["/admin/test-qr", "test"],
    ]) {
      await page.goto(base + path);
      await expect(page.locator(".print-ticket")).toHaveCount(judges);

      // 多码一页：两列网格，5 张席位卡 → 2 页
      await page.emulateMedia({ media: "print" });
      expect(pdfPages(await page.pdf({ format: "A4" }))).toBe(2);
      await page.screenshot({
        path: `.impeccable/review/print-${name}-grid.png`,
        fullPage: true,
      });

      // 打印媒体下工具栏被隐藏，须切回 screen 才能点击模式切换
      await page.emulateMedia({ media: "screen" });
      await page.getByRole("button", { name: "单页单码" }).click();
      await expect(page.locator(".print-grid.single")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "单页单码" }),
      ).toHaveAttribute("aria-pressed", "true");

      // 单页单码：一位评委一张 A4 → 5 页
      await page.emulateMedia({ media: "print" });
      expect(pdfPages(await page.pdf({ format: "A4" }))).toBe(judges);
      await page.screenshot({
        path: `.impeccable/review/print-${name}-single.png`,
        fullPage: true,
      });

      // 切回网格模式，避免影响后续断言与用户默认
      await page.emulateMedia({ media: "screen" });
      await page.getByRole("button", { name: "多码一页" }).click();
      await expect(page.locator(".print-grid.single")).toHaveCount(0);
    }

    // 纯净版导出：一键 ZIP，含全部评委的「二维码 + 席位标签」PNG
    await page.goto(base + "/admin/print");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "导出图片 ZIP" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("评委评分二维码.zip");
    const zip = readFileSync(await download.path());
    const eocd = zip.length - 22;
    expect(zip.toString("latin1", eocd, eocd + 4)).toBe("PK\u0005\u0006");
    expect(zip.readUInt16LE(eocd + 10)).toBe(judges); // 目录条目 = 评委数
    // 第一项为合法 PNG：跳过本地头与文件名后校验魔数
    const nameLength = zip.readUInt16LE(26),
      extraLength = zip.readUInt16LE(28),
      dataStart = 30 + nameLength + extraLength;
    expect(zip.toString("latin1", dataStart, dataStart + 8)).toBe(
      "\u0089PNG\r\n\u001a\n",
    );
    expect(zip.length).toBeGreaterThan(judges * 3000); // 每张图有实际内容
  } finally {
    await context.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
