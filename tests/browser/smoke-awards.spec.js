import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { once } from "node:events";
import { utils, write } from "xlsx/xlsx.mjs";

const base = "http://localhost:3005",
  password = "smoke-award-password-123";

let service, server;
test.beforeAll(async () => {
  service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "smoke-signing-secret-at-least-32-characters!!",
    publicUrl: base,
  });
  server = service.app.listen(3005, "127.0.0.1");
  await once(server, "listening");
});
test.afterAll(async () => {
  service.close();
  await new Promise((r) => server.close(r));
});

test("award roster accepts manual entries, CSV and Excel imports", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/login", {
    headers: { Origin: base },
    data: { password },
  });
  await page.goto(base + "/admin/awards");
  await expect(page.getByLabel("单位")).toBeVisible();
  await expect(page.getByLabel("姓名")).toBeVisible();
  await expect(page.getByLabel("颁奖说明")).toHaveCount(0);

  // 手工添加一条
  await page.getByLabel("单位").fill("第一分局");
  await page.getByLabel("姓名").fill("张三");
  await page.getByRole("button", { name: "添加个人奖项" }).click();
  await expect(page.getByText("张三")).toBeVisible();

  // CSV 批量导入（表头 + 数据行）
  const csv = "单位,姓名\n第二分局,李四\n第三分局,王五\n";
  await page.setInputFiles("input[type=file]", {
    name: "awards.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("\uFEFF" + csv, "utf8"),
  });
  await expect(page.getByText("已解析 2 条")).toBeVisible();
  await page.getByRole("button", { name: "追加导入" }).click();
  await expect(page.getByText("李四")).toBeVisible();
  await expect(page.getByText("王五")).toBeVisible();

  for (const format of ["xlsx", "xls"]) {
    const person = `测试人-${format}`;
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([["第一单位", person]]), "名单");
    await page.setInputFiles("input[type=file]", {
      name: `awards.${format}`,
      mimeType: "application/octet-stream",
      buffer: write(workbook, { bookType: format, type: "buffer" }),
    });
    await expect(page.getByText("已解析 1 条")).toBeVisible();
    await page.getByRole("button", { name: "追加导入" }).click();
    await expect(page.locator(".award-import-preview")).toHaveCount(0);
    await expect(page.getByText(person, { exact: true })).toBeVisible();
  }

  // 校验重评原因不再是必填（打开重评弹窗直接提交不再被表单拦截）
  await page.goto(base + "/admin/projects");
  await expect(page.getByLabel("重评原因（选填）")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.close();
  await context.close();
});
