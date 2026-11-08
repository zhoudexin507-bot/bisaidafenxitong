import { once } from "node:events";
import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { getSettings, saveSettings } from "../../server/db.js";

test("30 independent judge sessions submit together and reveal on one screen", async ({ browser }, info) => {
  test.setTimeout(180000);
  const base = "http://localhost:3002";
  const service = createApp({
    dbPath: info.outputPath("competition.sqlite"),
    adminPassword: "thirty-judges-test",
    tokenSecret: "thirty-judges-browser-test-only-token-secret",
    publicUrl: base,
  });
  const db = service.db;
  saveSettings(db, { ...getSettings(db), status: "running", testCompleted: true });
  for (let i = 1; i <= 3; i++)
    db.prepare("INSERT INTO projects(id,name,team,position) VALUES (?,?,?,?)")
      .run(String(i), "现场评分", `第 ${i} 队`, i);
  for (let i = 1; i <= 30; i++)
    db.prepare("INSERT INTO judges(id,name,expires_at) VALUES (?,?,?)")
      .run(String(i), `评委 ${i}`, Date.now() + 3600000);

  const server = service.app.listen(3002, "127.0.0.1");
  await once(server, "listening");
  const contexts = [];
  async function newPage(width, height) {
    const context = await browser.newContext({ viewport: { width, height } });
    contexts.push(context);
    return context.newPage();
  }
  try {
    const screen = await newPage(1366, 768);
    const admin = await newPage(1440, 900);
    const request = admin.context().request;
    const post = async (path, data) => {
      const response = await request.post(base + "/api" + path, { headers: { Origin: base }, data });
      expect(response.ok(), await response.text()).toBeTruthy();
    };
    await post("/login", { password: "thirty-judges-test" });
    await admin.goto(base + "/admin");
    await screen.goto(base + "/screen");
    const judges = db.prepare("SELECT * FROM judges ORDER BY rowid").all();
    const phones = [];
    for (let i = 0; i < judges.length; i += 5) {
      phones.push(...await Promise.all(judges.slice(i, i + 5).map(async (judge) => {
        const phone = await newPage(390, 844);
        await phone.goto(base + "/judge#" + service.tokenFor(judge));
        await expect(phone.getByText("实时连接正常")).toBeVisible();
        return phone;
      })));
    }

    const latencies = [];
    for (let team = 1; team <= 3; team++) {
      await post(`/admin/projects/${team}/status`, { status: "open" });
      await expect(screen.locator(".current-info h2")).toContainText(`第 ${team} 队`);
      await Promise.all(phones.map(async (phone, i) => {
        await expect(phone.locator(".judge-form-panel h2")).toHaveText(`第 ${team} 队`);
        await phone.getByLabel("总分（满分 100 分）").fill(String(70 + i));
      }));
      const reveal = screen.evaluate(() => new Promise((resolve) => {
        let first;
        const observer = new MutationObserver(() => {
          if (!first && document.querySelector(".stage-score.revealed")) first = Date.now();
          if (document.querySelector(".final-score")) {
            observer.disconnect();
            resolve([first, Date.now()]);
          }
        });
        observer.observe(document.querySelector(".stage-score"), { attributes: true, childList: true, subtree: true });
      }));
      const start = Date.now();
      await Promise.all(phones.map(async (phone) => {
        const [response] = await Promise.all([
          phone.waitForResponse((r) => r.url().endsWith("/api/judge/scores")),
          phone.locator("form").evaluate((form) => form.requestSubmit()),
        ]);
        expect(response.status()).toBe(201);
        await expect(phone.getByRole("heading", { name: "评分已提交" })).toBeVisible();
        const elapsed = await phone.evaluate(() => performance.getEntriesByName(location.origin + "/api/judge/scores").at(-1).duration);
        latencies.push(elapsed);
      }));
      await expect(screen.locator(".final-score")).toHaveText("84.50分", { timeout: 15000 });
      const [first, final] = await reveal;
      console.log(`Team ${team}: batch to reveal ${first - start} ms, to final ${final - start} ms`);
      expect(db.prepare("SELECT COUNT(*) AS count FROM entries WHERE project_id=?").get(String(team)).count).toBe(30);
      await expect(screen.locator(".judge-score")).toHaveCount(30);
      await expect(screen.locator(".judge-score.excluded")).toHaveCount(2);
      expect(await screen.locator(".judge-scores").evaluate((grid) => grid.getBoundingClientRect().bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await post(`/admin/projects/${team}/status`, { status: "closed" });
    }
    latencies.sort((a, b) => a - b);
    console.log(`90 score requests: p95 ${latencies[Math.ceil(latencies.length * 0.95) - 1].toFixed(0)} ms, max ${latencies.at(-1).toFixed(0)} ms`);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
