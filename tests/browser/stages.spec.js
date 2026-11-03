import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { once } from "node:events";
import { mkdirSync } from "node:fs";

test("settings, rehearsal, anonymous animated reveal, rejudging, two rounds and award stages", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const base = "http://localhost:3002",
    password = "browser-test-password";
  const service = createApp({
    dbPath: ":memory:",
    adminPassword: password,
    tokenSecret: "browser-test-signing-secret-at-least-32-characters",
    publicUrl: base,
  });
  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    audience = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "no-preference",
    }),
    mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const operator = await admin.newPage(),
    screen = await audience.newPage(),
    phone = await mobile.newPage();
  const errors = [];
  for (const p of [operator, screen, phone])
    p.on("pageerror", (e) => errors.push(e.message));
  mkdirSync(".impeccable/review", { recursive: true });
  const shot = async (name) =>
    screen.screenshot({
      path: `.impeccable/review/${name}.png`,
      fullPage: true,
    });
  try {
    await operator.goto(base + "/admin/rules");
    await operator.getByLabel("管理员密码").fill(password);
    await operator.getByRole("button", { name: "登录工作台" }).click();
    await expect(
      operator.getByRole("heading", { name: "赛事设置" }),
    ).toBeVisible();
    await operator.getByLabel("赛事名称").fill("2026 年度警务技能比武");
    await operator.getByLabel("评委人数").fill("3");
    await operator.getByLabel("项目数量").fill("2");
    await operator.getByLabel("比赛轮次").fill("2");
    await operator.getByLabel("二等奖名额").fill("1");
    await operator.getByLabel("三等奖名额").fill("0");
    await operator.getByRole("button", { name: "保存设置" }).click();
    await expect(operator.getByText("操作已保存")).toBeVisible();
    await operator.screenshot({
      path: ".impeccable/review/settings-blue.png",
      fullPage: true,
    });
    async function post(path, data = {}) {
      const r = await admin.request.post(base + "/api/admin" + path, {
        data,
        headers: { Origin: base },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      return r.json();
    }
    const state = async () =>
      (await admin.request.get(base + "/api/admin/state")).json();
    let d = await state(),
      p = d.projects;
    for (let i = 0; i < 2; i++) {
      const r = await admin.request.put(
        base + `/api/admin/projects/${p[i].id}`,
        {
          headers: { Origin: base },
          data: {
            name: ["应急处置与协同作战", "警情研判与现场指挥"][i],
            team: ["第一代表队", "第二代表队"][i],
            position: i + 1,
            members: ["陈志远、王晓峰、刘文静", "李明、赵晓、孙宁"][i],
          },
        },
      );
      expect(r.ok()).toBeTruthy();
    }
    const links = await Promise.all(
      d.judges.map(
        async (j) =>
          (
            await (
              await admin.request.get(base + `/api/admin/judges/${j.id}/link`)
            ).json()
          ).url,
      ),
    );
    async function submit(i, projectId, score) {
      const headers = {
        Origin: base,
        Authorization: `Bearer ${links[i].split("#")[1]}`,
      };
      const js = await (
        await admin.request.get(base + "/api/judge/state", { headers })
      ).json();
      const r = await admin.request.post(base + "/api/judge/scores", {
        headers,
        data: {
          projectId,
          score,
          phase: js.settings.mode,
          round: js.settings.currentRound,
          epoch: js.settings.epoch,
          revision: js.projects.find((p) => p.id === projectId).revision,
        },
      });
      expect(r.status(), await r.text()).toBe(201);
    }
    await operator.goto(base + "/admin/display");
    await expect(
      operator.getByRole("button", { name: "开始正式比赛" }),
    ).toBeDisabled();
    await operator
      .getByRole("button", { name: "开始测试评分", exact: true })
      .click();
    await operator
      .getByRole("button", { name: "准备评分", exact: true })
      .click();
    await screen.goto(base + "/");
    await expect(screen.getByLabel("分数未知")).toBeVisible();
    await shot("blue-ready");
    await operator
      .getByRole("button", { name: "开始评分", exact: true })
      .click();
    await phone.goto(links[0]);
    await expect(phone.getByRole("heading", { name: "评委 01" })).toBeVisible();
    await expect(phone.getByText("测试评分", { exact: true })).toBeVisible();
    await phone.getByLabel("总分（满分 100 分）").fill("80");
    await mobile.setOffline(true);
    await phone.getByRole("button", { name: "提交评分", exact: true }).click();
    await expect(phone.getByRole("alert").first()).toBeVisible();
    await mobile.setOffline(false);
    await phone.reload();
    await expect(phone.getByLabel("总分（满分 100 分）")).toHaveValue("80");
    await phone.screenshot({
      path: ".impeccable/review/phone-blue.png",
      fullPage: true,
    });
    await phone.getByRole("button", { name: "提交评分", exact: true }).click();
    await expect(
      phone.getByRole("heading", { name: "评分已提交" }),
    ).toBeVisible();
    await expect(screen.getByText("已打分", { exact: true })).toHaveCount(1);
    await expect(screen.locator(".judge-scores")).not.toContainText("80.00");
    await shot("blue-scoring");
    await submit(1, p[0].id, 90);
    await submit(2, p[0].id, 100);
    await expect(screen.locator(".stage-score")).toHaveAttribute(
      "data-reveal-step",
      "0",
    );
    await expect(screen.locator(".judge-scores")).toContainText("80.00");
    await expect(screen.locator(".final-score")).toHaveCount(0);
    await shot("blue-all-scores");
    await expect(screen.locator(".stage-score")).toHaveAttribute(
      "data-reveal-step",
      "1",
    );
    await expect(screen.locator(".extreme")).toHaveCount(2);
    await shot("blue-extremes");
    await expect(screen.locator(".stage-score")).toHaveAttribute(
      "data-reveal-step",
      "2",
    );
    await expect(screen.locator(".excluded")).toHaveCount(2);
    await shot("blue-excluded");
    await expect(screen.locator(".final-score")).toHaveText("90.00分");
    await shot("blue-final-score");
    await operator
      .getByRole("button", { name: "完成测试", exact: true })
      .click();
    await expect(
      operator.getByRole("button", { name: "开始正式比赛" }),
    ).toBeEnabled();
    await operator.getByRole("button", { name: "开始正式比赛" }).click();
    await operator
      .getByRole("button", { name: "开始评分", exact: true })
      .click();
    await expect(phone.getByLabel("总分（满分 100 分）")).toHaveValue("");
    for (let i = 0; i < 3; i++) await submit(i, p[0].id, 80 + i * 10);
    await operator.goto(base + "/admin/projects");
    operator.on("dialog", (dialog) => dialog.accept());
    await operator
      .getByRole("button", { name: "重新评分", exact: true })
      .click();
    await operator.locator(".rejudge-list input").first().check();
    await operator.getByLabel("重评原因").fill("录入错误");
    await operator.getByRole("button", { name: "确认重评（1 人）" }).click();
    await expect(phone.getByText("请重新评分", { exact: true })).toBeVisible();
    await expect(phone.getByLabel("总分（满分 100 分）")).toHaveValue("");
    await expect(screen.getByText("未打分", { exact: true })).toHaveCount(1);
    await phone.getByLabel("总分（满分 100 分）").fill("85");
    await phone.getByRole("button", { name: "提交评分", exact: true }).click();
    await expect(
      phone.getByRole("heading", { name: "评分已提交" }),
    ).toBeVisible();
    await operator
      .getByRole("button", { name: "重新评分", exact: true })
      .click();
    await operator
      .getByRole("button", { name: "全部评委", exact: true })
      .click();
    await operator.getByLabel("重评原因").fill("整组复评");
    await operator.getByRole("button", { name: "确认重评（3 人）" }).click();
    await expect(screen.getByText("未打分", { exact: true })).toHaveCount(3);
    for (let i = 0; i < 3; i++) await submit(i, p[0].id, 80 + i * 10);
    await post(`/projects/${p[0].id}/status`, { status: "closed" });
    await post(`/projects/${p[1].id}/status`, { status: "open" });
    for (let i = 0; i < 3; i++) await submit(i, p[1].id, 70 + i * 10);
    await post(`/projects/${p[1].id}/status`, { status: "closed" });
    await operator.getByRole("button", { name: "进入第 2 轮" }).click();
    await expect(operator.getByText("正式比赛 · 第 2 / 2 轮")).toBeVisible();
    for (let pi = 0; pi < 2; pi++) {
      await post(`/projects/${p[pi].id}/status`, { status: "open" });
      for (let i = 0; i < 3; i++)
        await submit(i, p[pi].id, (pi === 0 ? 60 : 70) + i * 10);
      await post(`/projects/${p[pi].id}/status`, { status: "closed" });
    }
    await operator.goto(base + "/admin/ranking");
    await expect(
      operator.getByRole("heading", { name: "同分顺序确认" }),
    ).toBeVisible();
    await operator.getByLabel("项目序号顺序").fill("2,1");
    await operator.getByLabel("裁定依据").fill("按同分规则复核");
    await operator.getByRole("button", { name: "确认同分顺序" }).click();
    await expect(
      operator.getByRole("heading", { name: "同分顺序确认" }),
    ).toHaveCount(0);
    await post("/awards", { name: "最佳协作奖", recipient: "王晓峰" });
    await operator.goto(base + "/admin/display");
    await operator.getByRole("button", { name: "发布最终成绩" }).click();
    await expect(
      screen.getByRole("heading", { name: "得分排名", exact: true }),
    ).toBeVisible();
    await shot("blue-ranking");
    await operator.getByRole("button", { name: "下一步：团体奖项" }).click();
    await expect(screen.getByText("陈志远、王晓峰、刘文静")).toBeVisible();
    await shot("blue-team-awards");
    await operator.getByRole("button", { name: "下一步：个人奖项" }).click();
    await expect(screen.getByText("王晓峰", { exact: true })).toBeVisible();
    await shot("blue-individual-awards");
    await screen.reload();
    await expect(
      screen.getByRole("heading", { name: "个人奖项", exact: true }),
    ).toBeVisible();
    await operator.goto(base + "/admin/judges");
    await expect(operator.locator(".qr-code")).toHaveCount(3);
    await operator
      .locator(".qr-code")
      .first()
      .evaluate((img) => img.decode());
    await operator.goto(base + "/admin/print");
    await expect(operator.locator(".print-ticket")).toHaveCount(3);
    await operator.emulateMedia({ media: "print" });
    await operator.screenshot({
      path: ".impeccable/review/print-blue.png",
      fullPage: true,
    });
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([admin.close(), audience.close(), mobile.close()]);
    service.close();
    await new Promise((r) => server.close(r));
  }
});
