import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../../server/app.js";
import { saveSettings, getSettings } from "../../server/db.js";

// 评委分析页 + 后台画面导出下载 + 发布成绩后逐队回看比赛画面。
test("analysis page, image exports and post-publish per-team review", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const base = "http://localhost:3002",
    password = "analysis-browser-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "analysis-browser-signing-secret-at-least-32",
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
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data = {}) => {
    const r = await context.request.post(base + "/api" + path, {
      headers: { Origin: base },
      data,
    });
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const state = async () =>
    (await context.request.get(base + "/api/admin/state")).json();
  // 三个评委按序给指定项目打分（避免两队同分）
  async function scoreTeam(projectId, scores) {
    for (const [i, id] of ["a", "b", "c"].entries()) {
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
          score: scores[i],
          phase: d.settings.mode,
          round: d.settings.currentRound,
          epoch: d.settings.epoch,
          revision: 0,
        },
      });
      expect(r.status(), await r.text()).toBe(201);
    }
  }
  const runProject = async (id, scores) => {
    await post(`/admin/projects/${id}/status`, { status: "open" });
    await scoreTeam(id, scores);
    await post(`/admin/projects/${id}/status`, { status: "closed" });
  };
  try {
    await page.goto(base + "/admin/analysis");
    await page.getByLabel("管理员密码").fill(password);
    await page.getByRole("button", { name: "登录工作台" }).click();
    await expect(
      page.getByRole("heading", { name: "评委打分分析" }),
    ).toBeVisible();

    // 测试阶段：仅第一队收齐（3 / 6 槽位）
    await post("/admin/test/start");
    await runProject("p1", [80, 90, 100]);
    await post("/admin/test/finish");
    // 正式阶段：两队分差不同（88 与 86），发布最终成绩
    await post("/admin/status", { status: "running" });
    await runProject("p1", [78, 88, 92]);
    await runProject("p2", [70, 86, 93]);
    await post("/admin/status", { status: "final" });
    await expect
      .poll(async () => (await state()).settings.status)
      .toBe("final");

    // —— 评委分析页：总览、剔除统计、热力矩阵与阶段切换 ——
    await expect(page.locator(".stats-strip")).toContainText("100%");
    await expect(page.getByText("2 次（高 0 / 低 2）")).toBeVisible(); // 评委甲
    await expect(page.getByText("0 次")).toBeVisible(); // 评委乙从未被剔除
    const firstRow = page.locator(".analysis-matrix tbody tr").first();
    await expect(firstRow).toContainText("78.00");
    await expect(firstRow).toContainText("88.00");
    await expect(firstRow).toContainText("92.00");
    await expect(firstRow.locator("td").last()).toContainText("88.00"); // 项目参照均分
    // 切到测试分：仅第一队 3 / 6 → 50%
    await page.getByRole("button", { name: "测试评分" }).click();
    await expect(page.locator(".stats-strip")).toContainText("50%");
    await page.getByRole("button", { name: "正式评分", exact: true }).click();
    await expect(page.locator(".stats-strip").getByText("100%")).toBeVisible();

    // 分析页导出图片
    const analysisExport = page.getByRole("button", { name: "导出图片" });
    const [analysisPng] = await Promise.all([
      page.waitForEvent("download"),
      analysisExport.click(),
    ]);
    expect(analysisPng.suggestedFilename()).toMatch(
      /^评委打分分析-\d{4}-\d{2}-\d{2}\.png$/,
    );

    // —— 成绩排名页导出：单页 PNG、多页 ZIP、空视图提示 ——
    await page.goto(base + "/admin/ranking");
    const exportButton = page.getByRole("button", { name: "导出图片" });
    const [rankingPng] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);
    expect(rankingPng.suggestedFilename()).toBe("得分排名.png");
    await page.getByRole("button", { name: "团体奖项", exact: true }).click();
    const [awardsZip] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);
    expect(awardsZip.suggestedFilename()).toBe("团体奖项图片包.zip");
    await page.getByRole("button", { name: "个人奖项", exact: true }).click();
    await exportButton.click();
    await expect(page.getByText("暂无可导出的内容")).toBeVisible();

    // —— 发布后逐队回看：大屏控制的面板与翻队按钮仍然可用 ——
    await page.goto(base + "/admin/display");
    const teamSelect = page.getByLabel("当前展示队伍");
    await expect(teamSelect).toBeVisible();
    // 发布后收分流程按钮不再出现
    await expect(
      page.getByRole("button", { name: "开始评分" }),
    ).toHaveCount(0);
    // 切到得分排名，再切回比赛画面
    await page.getByRole("button", { name: "得分排名", exact: true }).click();
    await expect
      .poll(async () => (await state()).settings.presentation.view)
      .toBe("ranking");
    await page.getByRole("button", { name: "比赛画面", exact: true }).click();
    await expect
      .poll(async () => (await state()).settings.presentation.view)
      .toBe("project");
    // 排名视图会清空队伍指向：回到比赛画面落在第一队，逐队翻看与下拉切换都可用
    await expect
      .poll(async () => (await state()).settings.presentation.projectId)
      .toBe("p1");
    await expect(teamSelect).toHaveValue("p1");
    await page.getByRole("button", { name: "下一队" }).click();
    await expect
      .poll(async () => (await state()).settings.presentation.projectId)
      .toBe("p2");
    await expect(teamSelect).toHaveValue("p2");
    await teamSelect.selectOption("p1");
    await expect
      .poll(async () => (await state()).settings.presentation.projectId)
      .toBe("p1");

    expect(errors).toEqual([]);
  } finally {
    await context.close();
    service.close();
    await new Promise((r) => server.close(r));
  }
});
