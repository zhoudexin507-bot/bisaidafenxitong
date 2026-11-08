import { test, expect } from "@playwright/test";
import { fixture } from "../helpers.js";

const sizes = [[1920, 1080], [1366, 768], [1024, 768], [390, 844]];

async function checkTextContrast(locator, minimum = 4.5) {
  const contrast = await locator.first().evaluate((element) => {
    function luminance(rgb) {
      const [r, g, b] = rgb.match(/[\d.]+/g).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    }
    let surface = element;
    while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)")
      surface = surface.parentElement;
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(surface).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(minimum);
}

for (const judges of [7, 30]) {
  test(`${judges} 位评委的全流程在四种投屏尺寸同步显示`, async ({ browser }) => {
    test.setTimeout(90000);
    let stop;
    const f = await fixture({ after: (cleanup) => { stop = cleanup; } });
    const screens = [];
    try {
      await f.login();
      await f.configure({ title: "警务实战技能比武", judgeCount: judges, projectCount: 8, rounds: 1, prizes: [1, 2, 5] });
      const teams = (await f.state()).projects;
      for (const [i, team] of teams.entries()) {
        await f.ok(`/admin/projects/${team.id}`, "PUT", {
          name: "警务实战", team: `第${"一二三四五六七八"[i]}代表队`,
          position: i + 1, members: "陈志远、王晓峰、刘文静",
        });
      }
      const recipients = ["王晓峰", "陈志远", "刘文静"];
      if (judges === 30) recipients.push("李明", "赵晓", "孙宁", "林涛");
      for (const name of recipients) {
        await f.ok("/admin/awards", "POST", { name: "特警支队", recipient: name });
      }
      const tokens = await f.tokens();
      const state = async () => (await f.request("/admin/presenter/state")).data;
      const next = async () => f.ok("/admin/presenter/next", "POST", { key: (await state()).presenter.next.key });
      await f.ok("/admin/presenter/start");
      for (const [width, height] of sizes) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
        screens.push(page);
        await page.goto(new URL("/screen", f.base).href);
      }
      async function check(label, verify) {
        await Promise.all(screens.map(async (page) => {
          await verify(page);
          const { width, height } = page.viewportSize();
          const fits = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth <= innerWidth,
            height: document.documentElement.scrollHeight <= innerHeight,
          }));
          expect(fits.width, `${label} ${width}px 横向溢出`).toBe(true);
          if (width > 680) expect(fits.height, `${label} ${width}px 纵向溢出`).toBe(true);
          if (process.env.CAPTURE_PROJECTION === "1") await page.screenshot({
            path: `artifacts/展示验收/${judges}席/${width}x${height}/${label}.png`,
            fullPage: true,
          });
        }));
      }
      async function submit(team, firstJudge, teamOffset) {
        const settings = (await state()).settings;
        await Promise.all(tokens.slice(firstJudge).map(async (token, index) => {
          const r = await f.request("/judge/scores", "POST", {
            projectId: team.id, score: 90 + teamOffset - (firstJudge + index) / 10,
            phase: settings.mode, round: settings.currentRound, epoch: settings.epoch, revision: 0,
          }, token);
          expect(r.status).toBe(201);
        }));
      }
      await next(); // Rehearsal
      await next();
      await check("测试评分", (page) => expect(page.locator(".screen-tools")).toContainText("测试评分"));
      const phases = screens[0].locator(".stage-score").evaluate((panel) => new Promise((resolve) => {
        const seen = [];
        const observer = new MutationObserver(() => {
          const step = panel.dataset.revealStep;
          if (step !== "waiting" && step !== seen.at(-1)) seen.push(step);
          if (step === "3") { observer.disconnect(); resolve(seen); }
        });
        observer.observe(panel, { attributes: true, attributeFilter: ["data-reveal-step"] });
      }));
      await submit(teams[0], 0, 0);
      await check("测试亮分", (page) => expect(page.locator(".final-score")).toBeVisible({ timeout: 8000 }));
      expect(await phases).toEqual(["0", "1", "2", "3"]);
      await expect(screens[0].locator(".final-score")).toHaveCSS("animation-name", "none");
      await next(); // End rehearsal
      await next(); // Start official competition
      for (const [i, team] of teams.entries()) {
        await next(); // Open this team
        if (i === 0) {
          await f.submit(tokens[0], team.id, 90);
          await check("正式评分", async (page) => {
            await expect(page.locator(".judge-score.submitted")).toHaveCount(1);
            await expect(page.locator(".judge-value")).toHaveCount(0);
            await expect(page.locator(".screen-tools")).toBeEmpty();
            await expect(page.locator(".screen-event")).toHaveText("警务实战技能比武");
            const title = await page.locator(".screen-event").boundingBox();
            expect(Math.abs(title.x + title.width / 2 - page.viewportSize().width / 2)).toBeLessThan(1);
          });
        }
        await submit(team, i === 0 ? 1 : 0, i);
        if (i === 0) await check("评分结果", async (page) => {
          await expect(page.locator(".final-score")).toBeVisible({ timeout: 8000 });
          await expect(page.locator(".excluded")).toHaveCount(2);
          await expect(page.locator(".judge-value")).toHaveCount(judges);
          await checkTextContrast(page.locator(".excluded small"));
          await checkTextContrast(page.locator(".excluded .judge-value"), 3);
        });
        await next(); // Prepare next team or publish final ranking
      }
      await check("得分排名", async (page) => {
        await expect(page.locator(".standing-row")).toHaveCount(8);
        await expect(page.locator(".prize-label")).toHaveCount(8);
      });
      for (const [level, count] of [["三等奖", 4], ["三等奖", 1], ["二等奖", 2], ["一等奖", 1]]) {
        await next();
        await check(level + "-" + count, async (page) => {
          await expect(page.locator(".honor-heading")).toHaveText(level);
          await expect(page.locator(".honor-winner")).toHaveCount(count);
          for (const selector of [".screen-event", ".screen-tools h1", ".honor-heading", ".honor-winner h3", ".winner-members", ".screen-pagination span"])
            await checkTextContrast(page.locator(selector));
        });
      }
      await next();
      await check("个人奖项", async (page) => {
        await expect(page.locator(".personal-honor h3")).toHaveText(recipients.slice(0, 6));
        for (const selector of [".personal-award-title", ".personal-honor h3"])
          await checkTextContrast(page.locator(selector));
      });
      if (recipients.length > 6) {
        await next();
        await check("个人奖末页", (page) => expect(page.locator(".personal-honor h3")).toHaveText(["林涛"]));
      }
    } finally {
      await Promise.all(screens.map((page) => page.close()));
      await stop();
    }
  });
}
