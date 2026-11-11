import { test, expect } from "@playwright/test";
import { fixture } from "../helpers.js";

test("home title switch, private layout preview and published results use the saved artwork and typography", async ({ browser }) => {
  let stop;
  const f = await fixture({ after: fn => { stop = fn; } });
  const base = new URL(f.base).origin;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    await f.login();
    await f.configure({ title: "投屏验收", subtitle: "赛事副标题", rounds: 1, projectCount: 1, prizes: [1,0,0] });
    await context.request.post(base + "/api/login", { headers: { Origin: f.config.publicUrl }, data: { password: f.config.adminPassword } });
    const admin = await context.newPage(), screen = await context.newPage();
    await admin.goto(base + "/admin/display");
    const file = { name: "backdrop.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") };
    await expect(admin.locator(".background-row")).toHaveCount(2);
    for (const row of await admin.locator(".background-row").all()) {
      await row.locator("input").setInputFiles(file);
      await expect(row.locator(".background-thumb.is-set")).toBeVisible();
    }
    await expect(admin.locator(".background-thumb.is-set")).toHaveCount(2);
    await admin.getByRole("button", { name: "背景首页", exact: true }).click();
    await screen.goto(base + "/screen");
    await expect(screen.locator(".board-home h1")).toHaveText("投屏验收");
    await admin.getByRole("button", { name: "排版预览", exact: true }).click();
    for (const layer of ["赛事名称", "赛事副标题"]) {
      await admin.locator(".layout-form").getByRole("button", { name: layer, exact: true }).click();
      await admin.getByLabel("显示此文字项").uncheck();
      await admin.getByRole("button", { name: "保存此文字项" }).click();
      await expect(admin.getByRole("button", { name: "保存此文字项" })).toBeDisabled();
    }
    await expect(screen.locator(".board-home")).toBeVisible();
    await expect(screen.locator(".board-home")).toHaveText("");
    await expect(screen.locator(".board-home")).toHaveCSS("background-image", /backgrounds\/home/);
    await screen.setViewportSize({ width: 1024, height: 768 });
    const rect = await screen.locator(".board-home").boundingBox();
    // 背景画布铺满整个视口，不再按 16:9 留黑边
    expect(rect.width).toBe(1024);
    expect(rect.height).toBe(768);
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await admin.locator(".layout-pickers").getByRole("button", { name: "得分排名" }).click();
    await expect(admin.getByText("赛前排版使用示例数据")).toBeVisible();
    await admin.getByLabel("字号（1920px 画布）").fill("80");
    await admin.getByLabel("水平位置（%）").fill("29");
    await admin.getByLabel("垂直位置（%）").fill("18");
    await admin.getByLabel("文字颜色").fill("#eec144");
    await admin.getByRole("button", { name: "保存此文字项" }).click();
    await expect(admin.getByRole("button", { name: "保存此文字项" })).toBeDisabled();
    await admin.getByRole("button", { name: "返回现场预览", exact: true }).click();
    await expect(screen.locator(".board-home")).toHaveText("");
    await f.rehearse();
    const d = await f.state(), project = d.projects[0];
    await f.ok("/admin/status", "POST", { status: "running" });
    await f.ok(`/admin/projects/${project.id}/status`, "POST", { status: "open" });
    await f.complete(project.id);
    await f.ok(`/admin/projects/${project.id}/status`, "POST", { status: "closed" });
    await f.ok("/admin/awards", "POST", { name: "测试单位", recipient: "获奖人甲" });
    await f.ok("/admin/status", "POST", { status: "final" });
    for (const [view, name] of [["ranking", "得分排名"], ["teamAwards", "团体奖项"], ["individualAwards", "个人奖项"]]) {
      // 点击直接请求服务器切换；重载大屏页避免依赖 SSE 刷新时序
      await admin.getByRole("button", { name, exact: true }).click();
      const board = screen.locator(`.board-${view}`);
      await screen.reload();
      await expect(board).toHaveCSS("background-image", /backgrounds\/awards/);
      await expect(board).toContainText(view === "individualAwards" ? "获奖人甲" : project.team);
      if (view === "ranking") {
        await screen.reload();
        await expect(board.locator("h1")).toHaveCSS("color", "rgb(238, 193, 68)");
        expect(await board.locator("h1").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(80);
        expect(await board.locator(".layer-title").evaluate(el => [el.style.left, el.style.top])).toEqual(["29%", "18%"]);
      }
    }
  } finally { await context.close(); await stop(); }
});
