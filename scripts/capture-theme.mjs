// 临时验收脚本：同一套赛事数据分别套用两版配色，输出对比截图到 artifacts/主题对比。
import { chromium } from "@playwright/test";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { createApp } from "../server/app.js";
import { getSettings, saveSettings } from "../server/db.js";

const base = "http://127.0.0.1:3010";
const password = "theme-preview-password";
const outDir = "artifacts/主题对比";
mkdirSync(outDir, { recursive: true });

const service = createApp({
  dbPath: ":memory:",
  adminPassword: password,
  tokenSecret: "theme-preview-signing-secret-at-least-32-chars",
  publicUrl: base,
});
const db = service.db;
const judges = [
  ["j1", "张海峰"],
  ["j2", "李国栋"],
  ["j3", "王振华"],
  ["j4", "陈立群"],
  ["j5", "周文斌"],
  ["j6", "赵永强"],
  ["j7", "孙建明"],
];
const teams = [
  ["合肥市局经侦支队", "第一代表队", "涉税犯罪侦查与数据穿透"],
  ["芜湖市局经侦支队", "第二代表队", "非法集资线索研判"],
  ["蚌埠市局经侦支队", "第三代表队", "合同诈骗资金流向还原"],
  ["安庆市局经侦支队", "第四代表队", "虚开发票团伙识别"],
  ["马鞍山市局经侦支队", "第五代表队", "跨境资金异常监测"],
  ["滁州市局经侦支队", "第六代表队", "网络传销组织架构分析"],
];
const scoreMatrix = [
  [94.5, 92.0, 95.5, 91.0, 93.5, 96.0, 92.5],
  [91.0, 89.5, 92.5, 88.0, 90.5, 91.5, 89.0],
  [88.5, 90.0, 87.5, 89.0, 91.0, 88.0, 90.5],
  [85.0, 86.5, 84.0, 87.5, 85.5, 86.0, 84.5],
  [82.5, 83.0, 81.5, 84.0, 82.0, 83.5, 81.0],
  [79.0, 80.5, 78.5, 81.0, 79.5, 80.0, 78.0],
];
const now = new Date(Date.now() - 3600_000).toISOString();

db.exec("BEGIN");
judges.forEach(([id, name], index) =>
  db.prepare("INSERT INTO judges(id,name,title,enabled,token_version,expires_at) VALUES (?,?,?,?,?,?)").run(
    id,
    name,
    `评委 ${String(index + 1).padStart(2, "0")}`,
    1,
    1,
    Date.now() + 86_400_000,
  ),
);
teams.forEach(([name, team, description], index) => {
  const id = `p${index + 1}`;
  db.prepare(
    "INSERT INTO projects(id,name,team,description,position,status,members) VALUES (?,?,?,?,?,?,?)",
  ).run(id, name, team, description, index + 1, index === 0 ? "open" : "closed", "");
  judges.forEach(([judgeId], judgeIndex) => {
    db.prepare(
      "INSERT INTO entries(phase,round,project_id,judge_id,total,submitted_at) VALUES (?,?,?,?,?,?)",
    ).run("official", 1, id, judgeId, Math.round(scoreMatrix[index][judgeIndex] * 100), now);
    db.prepare(
      "INSERT INTO scores(project_id,judge_id,total,details,submitted_at) VALUES (?,?,?,?,?)",
    ).run(id, judgeId, Math.round(scoreMatrix[index][judgeIndex] * 100), "{}", now);
  });
});
[
  ["a1", "个人一等奖", "张海峰"],
  ["a2", "个人二等奖", "李国栋"],
  ["a3", "个人二等奖", "王振华"],
].forEach(([id, name, recipient]) =>
  db.prepare("INSERT INTO awards(id,name,recipient,note) VALUES (?,?,?,?)").run(id, name, recipient, ""),
);
db.exec("COMMIT");

const settings = {
  ...getSettings(db),
  title: "全省公安机关经侦部门数智赋能比武竞赛决赛",
  subtitle: "2026年11月 · 安徽 · 合肥",
  status: "running",
  demo: false,
  testCompleted: true,
  rounds: 1,
  currentRound: 1,
  prizes: [1, 2, 3],
  trimEnabled: true,
  trimHigh: 1,
  trimLow: 1,
  revealMode: "auto",
  presentation: { view: "project", projectId: "p1" },
};
saveSettings(db, settings);

const server = service.app.listen(3010, "127.0.0.1");
await once(server, "listening");

const browser = await chromium.launch();
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const login = await adminContext.request.post(base + "/api/login", {
  headers: { Origin: base },
  data: { password },
});
if (!login.ok()) throw new Error("登录失败：" + (await login.text()));
const cookies = await adminContext.cookies();

const theme = (name) =>
  `try { localStorage.setItem("jingheng-theme", ${JSON.stringify(name)}); } catch (e) {}`;

async function shoot(themeName, url, file, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: !!options.mobile,
    hasTouch: !!options.mobile,
    reducedMotion: "reduce",
  });
  await context.addInitScript(theme(themeName));
  if (options.admin) await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(options.wait ?? 600);
  await page.screenshot({ path: `${outDir}/${file}`, fullPage: !!options.full });
  if (errors.length) console.log(`[${file}] 页面错误：`, errors);
  await context.close();
}

// 管理端写接口会主动失效服务端快照，直接改库不会。
async function adminPost(path, data = {}) {
  const response = await adminContext.request.post(base + "/api/admin" + path, {
    headers: { Origin: base },
    data,
  });
  if (!response.ok()) throw new Error(`${path} -> ${response.status()} ${await response.text()}`);
}

async function capture(themeName, suffix) {
  await shoot(themeName, base + "/admin", `admin-${suffix}.png`, {
    admin: true,
    viewport: { width: 1440, height: 1000 },
  });
  await shoot(themeName, base + "/admin/ranking", `admin-ranking-${suffix}.png`, {
    admin: true,
    viewport: { width: 1440, height: 1000 },
  });
  await shoot(themeName, base + "/screen", `stage-score-${suffix}.png`, { wait: 5200 });
  if (themeName === "police") {
    await shoot(themeName, base + "/screen", "stage-reveal-police.png", { wait: 1900 });
  }
  const state = await (await adminContext.request.get(base + "/api/admin/state")).json();
  const version = state.settings.stage?.version || 0;
  await adminPost("/stage", {
    action: "scene",
    scene: "standby",
    message: "请评委就座，比赛即将开始",
    seconds: 300,
    version,
  });
  await shoot(themeName, base + "/screen", `stage-cover-${suffix}.png`);
  await adminPost("/stage", {
    action: "scene",
    scene: "live",
    message: "",
    seconds: 0,
    version: version + 1,
  });
  await shoot(themeName, `${base}/judge#${service.tokenFor({ id: "j1", token_version: 1 })}`, `judge-${suffix}.png`, {
    viewport: { width: 390, height: 844 },
    mobile: true,
    full: true,
  });
}

await capture("default", "default");
await capture("police", "police");

await adminPost("/projects/p1/status", { status: "closed" });
await adminPost("/status", { status: "final" });
await adminPost("/presentation", { view: "ranking", projectId: null });
for (const [themeName, suffix] of [["default", "default"], ["police", "police"]])
  await shoot(themeName, base + "/screen", `stage-ranking-${suffix}.png`, { wait: 1800 });
await adminPost("/presentation", { view: "teamAwards", projectId: null });
for (const [themeName, suffix] of [["default", "default"], ["police", "police"]])
  await shoot(themeName, base + "/screen", `stage-awards-${suffix}.png`, { wait: 1800 });

await browser.close();
service.close();
await new Promise((resolve) => server.close(resolve));
console.log("截图完成：" + outDir);
