#!/usr/bin/env node
// 虚拟评委模拟器：不需要真机扫码，模拟 N 位评委客户端走完整评分流程。
//
// 原理：评委二维码内容就是 `{PUBLIC_URL}/judge#{HMAC 凭证}`，凭证可通过管理端
// API 获取（/api/admin/judges/test-links 或 /api/admin/judges/:id/link）。
// 本脚本为每位虚拟评委完整复刻真实手机行为（src/main.jsx 的 useLive）：
// 每人一条 SSE 订阅 + 15 秒轮询兜底 + 认证状态请求（建立管理台在线状态），
// 项目开放后按人类节奏错峰提交真实分布的分数。
//
// 两种模式：
//   纯评委模式（默认）——你当主持人操作 /admin/present 与大屏，虚拟评委只打分；
//   --solo 无人值守——脚本同时扮演管理员，按剧本推进全程并逐步执行不变式断言。
//
// 示例：
//   npm run simulate -- --dry-run
//   npm run simulate -- --kind test --speed 10          # 测试评分阶段彩排
//   npm run simulate -- --kind official --profile chaos --seed 7
//   npm run simulate -- --solo --speed 20               # 无人值守跑完整场
//   npm run simulate -- --solo --speed 20 --force-tie 2,3
//
// 彩排请使用独立数据库（DB_PATH=./data/rehearsal.sqlite），详见 docs/REHEARSAL.md。

const USAGE = `用法: npm run simulate -- [选项]
  --url <地址>        服务器地址，默认 http://localhost:3001（须与 PUBLIC_URL 同源）
  --password <密码>   管理员密码，默认读环境变量 ADMIN_PASSWORD
  --kind <类型>       test=测试码 | official=正式码（默认 test；solo 固定用正式码）
  --speed <倍率>      时间压缩倍率，默认 1（真实节奏）；10 表示人类延迟÷10
  --profile <风格>    realistic=错峰拟真（默认）| chaos=异常行为 | stress=同刻齐发
  --only <序号>       只扮演指定评委，如 1,5,9（管理台席位号）
  --count <数量>      只扮演前 N 位评委
  --seed <数字>       随机种子，固定后行为可复现（默认按时间，会打印实际值）
  --solo              无人值守全自动：脚本自己推进赛程并执行不变式断言
  --force-tie <位>    solo 专用：让指定两个出场位的项目精确同分，如 2,3
  --allow-remote      允许目标是非本机地址（默认仅 localhost）
  --dry-run           只打印评委名单与行为计划，不发送任何评分请求`;

// ---------------- 参数解析 ----------------
function parseArgs(argv) {
  const args = { url: "http://localhost:3001", kind: "test", speed: 1, profile: "realistic" };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split("=");
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (key) {
      case "--url": args.url = next(); break;
      case "--password": args.password = next(); break;
      case "--kind": args.kind = next(); break;
      case "--speed": args.speed = Number(next()); break;
      case "--profile": args.profile = next(); break;
      case "--only": args.only = next(); break;
      case "--count": args.count = Number(next()); break;
      case "--seed": args.seed = Number(next()); break;
      case "--solo": args.solo = true; break;
      case "--force-tie": args.forceTie = next(); break;
      case "--allow-remote": args.allowRemote = true; break;
      case "--dry-run": args.dryRun = true; break;
      case "--help": case "-h": console.log(USAGE); process.exit(0);
      default: console.error(`未知选项 ${key}\n\n${USAGE}`); process.exit(2);
    }
  }
  if (!["test", "official"].includes(args.kind)) throw new Error("--kind 只能是 test 或 official");
  if (!["realistic", "chaos", "stress"].includes(args.profile)) throw new Error("--profile 只能是 realistic、chaos 或 stress");
  if (!Number.isFinite(args.speed) || args.speed <= 0) throw new Error("--speed 需为正数");
  if (args.forceTie && !args.solo) throw new Error("--force-tie 仅在 --solo 模式可用");
  if (args.solo) args.kind = "official"; // 正式码测试、正式两阶段通用
  args.seed ??= (Date.now() ^ (process.pid << 8)) >>> 0;
  if (args.forceTie) {
    args.tiePositions = args.forceTie.split(",").map(Number);
    if (args.tiePositions.length !== 2 || args.tiePositions.some((n) => !Number.isInteger(n) || n < 1))
      throw new Error("--force-tie 需要两个出场位序号，如 2,3");
  }
  return args;
}

// ---------------- 工具 ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    seed,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    normal: (mean, stddev) => {
      const u = Math.max(next(), 1e-9), v = next(); // Box-Muller 正态分布
      return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const pad = (s, n) => String(s).padEnd(n, " ");

// ---------------- HTTP 客户端 ----------------
class Api {
  constructor(base) {
    this.base = base.replace(/\/$/, "");
    this.cookie = "";
  }
  async request(method, path, { body, token } = {}) {
    const headers = { Origin: this.base }; // 写请求同源校验，与浏览器一致
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    let data = null;
    try { data = await response.json(); } catch { /* 非 JSON 响应 */ }
    return { status: response.status, data };
  }
}

// 每位评委一条独立 SSE 订阅（与真实手机相同的 /api/events 连接负载）
function connectEvents(base, onUpdate) {
  const controller = new AbortController();
  (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(base + "/api/events", {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (chunk.includes("event: update")) onUpdate();
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        await sleep(2500); // 与客户端 EventSource 相同的重连节奏
      }
    }
  })();
  return () => controller.abort();
}

// ---------------- 虚拟评委 ----------------
// 异常角色仅在 chaos 风格下分配：double 双击重复提交 / stale 旧页面旧 epoch /
// late 迟到逼出缺评提示 / offline 全程缺席（solo 下折算为 late，避免死等——
// 缺评与重评流程请用纯评委模式人工演练）。
const CHAOS_ROLES = ["double", "stale", "late", "offline"];
class VirtualJudge {
  constructor(seat, sim) {
    this.seat = seat; // { number, name, id, token }
    this.sim = sim;
    this.rng = makeRng(sim.rng.int(0, 2 ** 31 - 1) ^ seat.number);
    this.bias = this.rng.float(-2, 2); // 每位评委固定个人偏差，分数更像真人
    this.role = "normal";
    this.stopSse = null;
    this.lastSubmit = null; // 最近一次成功提交的完整请求体
    this.stats = { submitted: [], duplicates: 0, conflicts: 0, errors: [], latencies: [] };
    this.pending = null;
    this.dead = false;
    this.stopped = false;
  }
  scoreFor(project) {
    if (this.sim.phase === "official" && this.sim.tiePositions?.has(project.position))
      return 88.5; // 精确同分彩排：目标队全体评委统一分
    const raw = this.rng.normal(84 + this.bias, 3.5);
    return Math.round(Math.min(98, Math.max(60, raw)) * 2) / 2; // 0.5 步进，像真人
  }
  humanDelayMs() {
    let base = this.rng.float(30_000, 90_000);
    if (this.role === "late") base += this.rng.float(120_000, 240_000);
    return base / this.sim.speed;
  }
  async start() {
    this.stopSse = connectEvents(this.sim.api.base, () => this.refresh());
    this.refresh().catch(() => {});
  }
  stop() {
    this.stopped = true;
    this.stopSse?.();
    clearTimeout(this.debounce);
    clearTimeout(this.throttleRetry);
  }
  // 复刻 useLive：SSE 推送或 15 秒兜底轮询都会走到这里。
  // 真机在 WiFi 上不会秒级连刷，这里同样把突发合并成每秒至多一次。
  async refresh() {
    if (this.stopped || this.dead) return;
    const since = Date.now() - (this.lastRefreshAt || 0);
    if (since < 1000) {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.refresh(), 1000 - since);
      return;
    }
    this.lastRefreshAt = Date.now();
    try {
      const { status, data } = await this.sim.api.request("GET", "/api/judge/state", { token: this.seat.token });
      if (status === 429) return this.backoff("状态请求被限流");
      if (status === 401 || status === 403) {
        // 筹备阶段测试码尚未生效，等待管理员开始测试评分；
        // 进入正式阶段后被拒则属正常退场；其余凭证问题如实上报
        const notYet = this.sim.kind === "test" && this.sim.serverStatus === "draft" &&
          String(data?.error).includes("正式评分");
        if (notYet) {
          this.stats.waiting = true;
          if (++this.rejections > 40) return this.fail("测试码持续被拒，比赛始终未开始", data?.error, status);
          clearTimeout(this.throttleRetry);
          this.throttleRetry = setTimeout(() => this.refresh(), 3000);
          return;
        }
        this.stats.waiting = false;
        if (this.sim.kind === "test" && String(data?.error).includes("正式评分")) this.sim.judgePhaseEnded(this);
        else this.fail(`评委状态请求 ${status}`, data?.error || status, status);
        return;
      }
      this.rejections = 0;
      if (status !== 200) throw new Error(data?.error || `HTTP ${status}`);
      this.lastSeen = Date.now();
      this.sim.judgeCache.set(this.seat.id, data);
      this.onState(data);
    } catch (error) {
      this.fail("评委状态请求失败", error.message);
    }
  }
  // 限流退避：不是故障，稍等再试（真机用户就是等一会儿再刷新）
  backoff(reason) {
    this.stats.throttled = (this.stats.throttled || 0) + 1;
    clearTimeout(this.throttleRetry);
    this.throttleRetry = setTimeout(() => this.refresh(), 3000);
  }
  fail(message, detail, status) {
    this.stats.errors.push(`${message}: ${detail}`);
    if (status === 401 || status === 403) this.dead = true; // 凭证失效，席位退出
  }
  onState(data) {
    const { settings } = data;
    this.sim.round = settings.currentRound;
    this.sim.epoch = settings.epoch;
    this.sim.serverStatus = settings.status;
    // 正式码全程跟随服务端阶段（正式码可参加测试评分，见 README）
    if (this.sim.kind === "official") this.sim.phase = settings.mode;
    if (settings.mode !== this.sim.phase) {
      if (this.sim.kind === "test" && settings.mode === "official" && settings.status !== "draft")
        this.sim.judgePhaseEnded(this);
      return;
    }
    const open = data.projects.find((p) => p.status === "open");
    if (!open || open.ownScore || this.pending || this.role === "offline") return;
    const delay = this.sim.profile === "stress" ? 0 : this.humanDelayMs();
    this.pending = true;
    this.sim.logJudge(this.seat.number, open, delay ? `约${Math.round(delay / 1000)}秒后提交` : "立即提交");
    setTimeout(() => {
      this.pending = null;
      this.submit(open).catch((e) => this.fail("提交失败", e.message));
    }, delay);
  }
  buildBody(project, overrides = {}) {
    const cached = this.sim.judgeCache.get(this.seat.id);
    const revision = cached?.projects.find((p) => p.id === project.id)?.revision ?? 0;
    return {
      projectId: project.id,
      score: this.scoreFor(project),
      phase: this.sim.phase,
      round: cached?.settings.currentRound ?? this.sim.round,
      epoch: cached?.settings.epoch ?? this.sim.epoch,
      revision,
      ...overrides,
    };
  }
  async submit(project) {
    if (this.stopped || this.dead) return;
    // 提交前重拉一次状态，拿最新 epoch/revision 并确认仍开放（模拟真人盯着屏幕）
    const fresh = await this.sim.api.request("GET", "/api/judge/state", { token: this.seat.token });
    if (fresh.status === 429) {
      this.stats.throttled = (this.stats.throttled || 0) + 1;
      await sleep(3000);
      return this.submit(project);
    }
    if (fresh.status !== 200) return this.fail(`提交前状态 ${fresh.status}`, fresh.data?.error || "", fresh.status);
    this.sim.judgeCache.set(this.seat.id, fresh.data);
    const open = fresh.data.projects.find((p) => p.id === project.id);
    if (!open || open.status !== "open") return; // 项目已封存或赛程变化，不再提交
    if (open.ownScore) return this.sim.logJudge(this.seat.number, open, "此前已提交，跳过");
    // 旧页面手：先用过期 epoch 打一次，应当 409，然后按新状态正常提交
    if (this.role === "stale" && !this.stats.conflicts) {
      const stale = this.buildBody(open, { epoch: fresh.data.settings.epoch - 1, score: 55 });
      const r = await this.sim.api.request("POST", "/api/judge/scores", { token: this.seat.token, body: stale });
      this.sim.check(`旧 epoch 提交被拒（评委${this.seat.number}）`, r.status === 409, `HTTP ${r.status} ${r.data?.error || ""}`.trim());
      if (r.status === 409) this.stats.conflicts++;
    }
    const body = this.buildBody(open);
    const start = performance.now();
    let r = await this.sim.api.request("POST", "/api/judge/scores", { token: this.seat.token, body });
    if (r.status === 429) {
      // 限流退避后重发：分数体未变，服务端幂等保证不会重复记账
      this.stats.throttled = (this.stats.throttled || 0) + 1;
      await sleep(3000);
      r = await this.sim.api.request("POST", "/api/judge/scores", { token: this.seat.token, body });
    }
    const elapsed = performance.now() - start;
    if (r.status === 201 || (r.status === 200 && r.data?.duplicate)) {
      this.stats.latencies.push(elapsed);
      this.lastSubmit = body;
      if (r.data?.duplicate) {
        this.stats.duplicates++;
        this.sim.logJudge(this.seat.number, open, "幂等命中 duplicate");
      } else {
        this.stats.submitted.push({ project: open.id, score: body.score, ms: elapsed });
        this.sim.logJudge(this.seat.number, open, `提交 ${body.score.toFixed(1)} 分（${elapsed.toFixed(0)}ms）`);
      }
      // 双击手：立刻原样再发一次，应当幂等返回 duplicate
      if (this.role === "double" && r.status === 201) {
        const again = await this.sim.api.request("POST", "/api/judge/scores", { token: this.seat.token, body });
        this.sim.check(`重复提交幂等（评委${this.seat.number}）`, again.status === 200 && !!again.data?.duplicate,
          `HTTP ${again.status} ${JSON.stringify(again.data)}`);
        if (again.data?.duplicate) this.stats.duplicates++;
      }
      return;
    }
    if (r.status === 409 && String(r.data?.error).includes("赛程已更新")) {
      this.sim.logJudge(this.seat.number, open, "赛程已更新，刷新后重试");
      await sleep(500);
      return this.submit(project);
    }
    if (r.status === 409 && String(r.data?.error).includes("已经提交")) return this.sim.logJudge(this.seat.number, open, "已提交，冲突跳过");
    this.stats.errors.push(`提交 ${open.name}: HTTP ${r.status} ${r.data?.error || ""}`);
  }
}

// ---------------- 模拟主体 ----------------
class Simulation {
  constructor(args, api) {
    this.args = args;
    this.api = api;
    this.rng = makeRng(args.seed);
    this.speed = args.speed;
    this.profile = args.profile;
    this.kind = args.kind;
    this.tiePositions = args.tiePositions ? new Set(args.tiePositions) : null;
    this.judges = [];
    this.judgeCache = new Map();
    this.phase = null;
    this.round = 1;
    this.epoch = 0;
    this.checks = [];
    this.stopped = false;
    this.progressLine = "";
  }
  // ------- 席位与凭证 -------
  async loadSeats() {
    const seats = [];
    if (this.kind === "test") {
      const { status, data } = await this.api.request("GET", "/api/admin/judges/test-links");
      if (status !== 200) throw new Error(`获取测试码失败: HTTP ${status} ${data?.error || ""}`);
      for (const j of data.judges) seats.push({ number: j.number, name: j.name, id: j.id, token: j.url.split("#")[1] });
    } else {
      const { status: s0, data: d0 } = await this.api.request("GET", "/api/admin/state");
      if (s0 !== 200) throw new Error(`读取评委名单失败: HTTP ${s0} ${d0?.error || ""}`);
      for (const j of d0.judges) {
        const { status, data } = await this.api.request("GET", `/api/admin/judges/${j.id}/link?kind=official`);
        if (status !== 200) throw new Error(`获取 ${j.name} 正式码失败: HTTP ${status} ${data?.error || ""}`);
        seats.push({ number: j.number, name: j.name, id: j.id, token: data.url.split("#")[1] });
      }
    }
    let picked = seats;
    if (this.args.only) {
      const wanted = new Set(this.args.only.split(",").map(Number));
      picked = seats.filter((s) => wanted.has(s.number));
      if (!picked.length) throw new Error(`--only ${this.args.only} 未匹配到任何席位（现有 1-${seats.length}）`);
    } else if (this.args.count) picked = seats.slice(0, this.args.count);
    return { seats, picked };
  }
  // chaos：约四分之一席位拿异常角色（--seed 固定后可复现）
  assignRoles(seats) {
    if (this.profile !== "chaos" || seats.length < 2) return;
    const shuffled = [...seats].sort(() => this.rng.float(0, 1) - 0.5);
    for (let i = 0; i < Math.min(CHAOS_ROLES.length, Math.max(1, Math.floor(seats.length / 4))); i++) {
      const judge = this.judges.find((j) => j.seat.number === shuffled[i].number);
      judge.role = this.args.solo && CHAOS_ROLES[i] === "offline" ? "late" : CHAOS_ROLES[i];
    }
  }
  // ------- 进度与输出 -------
  check(name, pass, detail = "") {
    this.checks.push({ name, pass, detail });
    this.printLine(`  ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!pass) this.failed = true;
  }
  logJudge(number, project, note) {
    if (process.env.QUIET) return;
    this.printLine(`  [评委${pad(number, 2)}] ${project?.team || project?.name || ""} ${note}`);
  }
  printLine(line) {
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
    console.log(line);
    this.renderProgress(true);
  }
  renderProgress(force = false) {
    if (!process.stdout.isTTY) return;
    const total = this.judges.length;
    const done = this.judges.filter((j) => j.stats.submitted.length).length;
    const online = this.judges.filter((j) => j.lastSeen && Date.now() - j.lastSeen < 45_000).length;
    const errors = this.judges.reduce((n, j) => n + j.stats.errors.length, 0);
    const line = `  进度 ${done}/${total} 已交 · 在线 ${online} · 第 ${this.round} 轮 · 错误 ${errors}`;
    if (force || line !== this.progressLine) {
      this.progressLine = line;
      process.stdout.write("\r\x1b[2K" + line);
    }
  }
  startJudges() {
    if (process.stdout.isTTY) {
      this.progressTimer = setInterval(() => this.renderProgress(), 3000);
      this.progressTimer.unref?.();
    }
    // 错峰启动，避免 20 条 SSE 与状态请求同刻打出
    this.judges.forEach((judge, i) => setTimeout(() => judge.start(), i * 80));
    this.fallback = setInterval(() => this.judges.forEach((j) => j.refresh()), 15_000);
    this.fallback.unref?.();
  }
  judgePhaseEnded(judge) {
    judge.stop();
    this.printLine(`  [评委${pad(judge.seat.number, 2)}] 评分阶段已切换，测试码退场`);
    if (this.judges.every((j) => j.stopped || j.dead)) this.phaseEnded = true;
  }
  stopAll() {
    this.stopped = true;
    clearInterval(this.progressTimer);
    clearInterval(this.fallback);
    clearInterval(this.watcher);
    for (const judge of this.judges) judge.stop();
  }
  // ------- 管理端 -------
  async adminState() {
    const { status, data } = await this.api.request("GET", "/api/admin/state");
    if (status !== 200) throw new Error(`读取管理状态失败: HTTP ${status} ${data?.error || ""}`);
    return data;
  }
  async admin(method, path, body = {}) {
    const { status, data } = await this.api.request(method, path, { body });
    if (status >= 300) throw Object.assign(new Error(`${method} ${path}: HTTP ${status} ${data?.error || ""}`), { status, data });
    return data;
  }
  async expectReject(promise, name) {
    try { await promise; } catch (error) {
      return this.check(name, [400, 409].includes(error.status), `HTTP ${error.status} ${error.data?.error || ""}`.trim());
    }
    this.check(name, false, "请求意外成功");
  }
  // ------- 模式一：纯评委（人肉主持） -------
  async runFollow() {
    const state = await this.adminState();
    // 测试码锚定测试阶段（筹备期等待开始）；正式码在 onState 里动态跟随
    this.phase = this.kind === "test" ? "test" : state.settings.mode;
    this.round = state.settings.currentRound;
    this.serverStatus = state.settings.status;
    if (this.kind === "test" && this.phase !== "test" && this.serverStatus !== "draft")
      throw new Error(`当前是${this.phase === "official" ? "正式" : "未知"}阶段，测试码不可用。请先归档新建比赛，或改用 --kind official`);
    this.printLine(`▶ 纯评委模式：${this.judges.length} 位虚拟评委就位（${this.kind}码 · ${this.profile} 风格 · ${this.speed}x 速）` +
      (this.kind === "test" && this.serverStatus === "draft" ? " · 等待管理员「开始测试评分」" : ""));
    this.printLine("  请在浏览器操作 /admin/present 与大屏，评委将自动跟随赛程打分；Ctrl+C 结束并输出报告");
    this.startJudges();
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      // 主循环定时器保持事件循环存活：评委全部退场或 Ctrl+C 时收尾出报告
      this.watcher = setInterval(() => {
        if (this.phaseEnded || this.judges.every((j) => j.dead)) resolve();
      }, 1000);
    });
    this.stopAll();
    if (this.phaseEnded) this.printLine("评分阶段已切换，虚拟评委全部退场。");
  }
  // ------- 模式二：solo 无人值守 -------
  async runSolo() {
    const state = await this.adminState();
    const s = state.settings;
    if (s.status !== "draft")
      throw new Error(`solo 需要从筹备状态开始（当前 ${s.status}）。请先在管理台「归档并新建比赛」，或换独立 DB_PATH`);
    if (!state.projects.length || !state.judges.length)
      throw new Error("请先在 /admin/rules 设置评委与项目数量");
    this.printLine(`▶ solo 无人值守：${state.projects.length} 个项目 × ${state.judges.length} 位评委 × ${s.rounds} 轮` +
      `${this.tiePositions ? ` · 出场位 ${[...this.tiePositions].join("/")} 精确同分` : ""}`);
    this.startJudges();
    this.phase = "test";
    if (!s.testCompleted) {
      this.printLine("── 阶段一：测试评分 ──");
      await this.admin("POST", "/api/admin/test/start");
      await this.scorePhase(state.projects);
      await this.runTestCeremony();
    } else this.printLine("── 测试评分已完成，跳过 ──");
    this.phase = "official";
    await this.admin("POST", "/api/admin/status", { status: "running" });
    for (let round = 1; round <= s.rounds; round++) {
      this.printLine(`── 阶段二：正式比赛 第 ${round}/${s.rounds} 轮 ──`);
      this.round = round;
      await this.scorePhase(state.projects);
      if (round < s.rounds) await this.admin("POST", "/api/admin/round/next");
    }
    await this.finishSolo(state);
  }
  // 测试阶段收官预演：主持端逐步推进 展示测试排名 → 团体奖项 → 个人奖项 → 完成测试
  async runTestCeremony() {
    this.printLine("── 收官预演：排名 → 团体奖项 → 个人奖项 → 完成测试 ──");
    let finished = false;
    for (let guard = 0; guard < 80; guard++) {
      const { status, data } = await this.api.request("GET", "/api/admin/presenter/state");
      if (status !== 200) throw new Error(`读取演示状态失败: HTTP ${status} ${data?.error || ""}`);
      const next = data.presenter?.next;
      if (next?.type === "tie") {
        await this.admin("POST", "/api/admin/tiebreak", {
          projectIds: (await this.adminState()).projects.map((p) => p.id),
          reason: "solo 彩排自动裁定",
        });
        continue;
      }
      if (next?.type === "finishTest") {
        const r = await this.api.request("POST", "/api/admin/presenter/next", { body: { key: next.key } });
        this.check("预演推进（finishTest）", r.status === 200, `HTTP ${r.status} ${r.data?.error || ""}`.trim());
        if (r.status !== 200) throw new Error(`完成测试失败: HTTP ${r.status} ${r.data?.error || ""}`);
        finished = true;
        break;
      }
      if (!next?.enabled) break;
      const r = await this.api.request("POST", "/api/admin/presenter/next", { body: { key: next.key } });
      this.check(`预演推进（${next.type}）`, r.status === 200, `HTTP ${r.status} ${r.data?.error || ""}`.trim());
      if (r.status !== 200) throw new Error(`预演步骤 ${next.type} 失败: HTTP ${r.status} ${r.data?.error || ""}`);
      await sleep(250);
    }
    // 预演链意外中断时仍保证测试阶段闭环
    if (!finished) await this.admin("POST", "/api/admin/test/finish");
    const after = await this.adminState();
    this.check("预演后回到筹备态且测试完成", after.settings.status === "draft" && after.settings.testCompleted);
    this.check("预演不产生正式分", after.ranking.length === 0);
  }
  async scorePhase(projects) {
    for (const project of projects) {
      const fresh = (await this.adminState()).projects.find((p) => p.id === project.id);
      if (fresh.status !== "pending") {
        this.printLine(`▶ 跳过非待评项目：${fresh.team || fresh.name}（${fresh.status}）`);
        continue;
      }
      // 首队开放前探针：未开放先交应被拒
      if (!this.probedClosed) {
        const probe = this.judges.find((j) => !j.dead);
        await probe.refresh();
        const body = probe.buildBody(fresh);
        const r = await this.api.request("POST", "/api/judge/scores", { token: probe.seat.token, body });
        this.check("未开放评分时提交被拒", r.status === 409, `HTTP ${r.status} ${r.data?.error || ""}`.trim());
      }
      await this.admin("POST", `/api/admin/projects/${fresh.id}/status`, { status: "open" });
      this.printLine(`▶ 开放评分：${fresh.team || fresh.name}`);
      await this.collect(fresh);
    }
  }
  async collect(project) {
    const maxWait = ((this.profile === "stress" ? 60 : 420) * 1000) / this.speed + 30_000;
    const start = Date.now();
    for (;;) {
      await sleep(1000 + Math.random() * 500);
      const state = await this.adminState();
      const p = state.projects.find((x) => x.id === project.id);
      if (p.result.complete) return this.revealAndClose(p, state);
      if (this.judges.every((j) => j.dead)) throw new Error("全部虚拟评委凭证失效，无法继续");
      if (Date.now() - start > maxWait)
        throw new Error(`等待 ${project.team || project.name} 收齐超时（${Math.round(maxWait / 1000)}s）。已提交 ${p.scores.length}/${state.settings.judgeCount}`);
    }
  }
  async revealAndClose(p, state) {
    const manual = state.settings.revealMode === "manual";
    if (manual && !p.released) {
      // 收齐但未公布：公共接口不得泄漏任何分数
      const pub = (await this.api.request("GET", "/api/state")).data.projects.find((x) => x.id === p.id);
      const leak = pub?.scores?.some((e) => e.total != null) || pub?.result?.average != null;
      this.check(`收齐未公布时公共接口不泄漏分数（${p.team}）`, !leak, leak ? JSON.stringify(pub.result) : "");
      if (!this.probedClosed)
        await this.expectReject(this.admin("POST", `/api/admin/projects/${p.id}/status`, { status: "closed" }), "未公布成绩时封存被拒");
      await this.admin("POST", "/api/admin/reveal", { projectId: p.id, releaseKey: p.releaseKey });
    }
    this.probedClosed = true;
    const pub2 = (await this.api.request("GET", "/api/state")).data.projects.find((x) => x.id === p.id);
    this.check(`公布后公共接口返回成绩（${p.team}）`, pub2?.result?.average != null, `average=${pub2?.result?.average}`);
    this.printLine(`  收齐并公布：${pub2?.result.average?.toFixed(2)} 分`);
    // 首队封存后探针：本轮还有未封存项目时禁止进入下一轮
    if (!this.probedRound && this.phase === "official" && this.round === 1)
      await this.expectReject(this.admin("POST", "/api/admin/round/next"), "有未封存项目时禁止进入下一轮");
    this.probedRound = true;
    await this.admin("POST", `/api/admin/projects/${p.id}/status`, { status: "closed" });
  }
  async finishSolo(state) {
    const settings = (await this.adminState()).settings;
    const ranking = (await this.adminState()).ranking;
    if (ranking.some((p) => p.tieUnresolved)) {
      this.printLine("检测到未裁定同分项目，验证发布被拒后按出场位自动裁定…");
      await this.expectReject(this.admin("POST", "/api/admin/status", { status: "final" }), "同分未裁定时发布被拒");
      const ordered = (await this.adminState()).projects.map((p) => p.id);
      await this.admin("POST", "/api/admin/tiebreak", { projectIds: ordered, reason: "solo 彩排自动裁定" });
    }
    await this.admin("POST", "/api/admin/status", { status: "final" });
    const publicFinal = (await this.api.request("GET", "/api/state")).data;
    this.check("发布后大屏接口返回完整排名", publicFinal.ranking.length === state.projects.length,
      `${publicFinal.ranking.length}/${state.projects.length}`);
    const firstPrizes = publicFinal.ranking.filter((p) => p.prize === 1).length;
    this.check("一等奖名额不扩张", firstPrizes <= settings.prizes[0], `${firstPrizes}/${settings.prizes[0]}`);
    const csv = await fetch(this.api.base + "/api/admin/export.csv", { headers: { Cookie: this.api.cookie } });
    const text = csv.ok ? await csv.text() : "";
    this.check("CSV 导出包含全部项目", csv.ok && state.projects.every((p) => text.includes(p.name)),
      csv.ok ? `${text.length} 字节` : `HTTP ${csv.status}`);
  }
  // ------- 报告 -------
  report() {
    const latencies = this.judges.flatMap((j) => j.stats.latencies);
    console.log("\n════════ 虚拟评委报告 ════════");
    const submitted = this.judges.reduce((n, j) => n + j.stats.submitted.length, 0);
    const throttled = this.judges.reduce((n, j) => n + (j.stats.throttled || 0), 0);
    console.log(`提交 ${submitted} 次 · 幂等命中 ${this.judges.reduce((n, j) => n + j.stats.duplicates, 0)} 次 · 409 重试 ${this.judges.reduce((n, j) => n + j.stats.conflicts, 0)} 次 · 限流退避 ${throttled} 次`);
    if (latencies.length)
      console.log(`提交延迟: p50 ${percentile(latencies, 0.5).toFixed(0)}ms · p95 ${percentile(latencies, 0.95).toFixed(0)}ms · max ${Math.max(...latencies).toFixed(0)}ms`);
    for (const j of this.judges) {
      const flags = [j.role !== "normal" ? j.role : "", j.dead ? "凭证失效" : "", j.stats.errors.length ? `错误${j.stats.errors.length}` : ""]
        .filter(Boolean).join(" · ");
      console.log(`  评委${pad(j.seat.number, 2)} ${pad(j.seat.name, 8)} 交 ${j.stats.submitted.length} 次${flags ? ` · ${flags}` : ""}`);
    }
    const errors = this.judges.flatMap((j) => j.stats.errors.map((e) => `评委${j.seat.number}: ${e}`));
    if (errors.length) console.log(`\n错误明细:\n  ${errors.join("\n  ")}`);
    if (this.checks.length) {
      const failed = this.checks.filter((c) => !c.pass);
      console.log(`\n不变式断言: ${this.checks.length - failed.length}/${this.checks.length} 通过`);
      for (const c of failed) console.log(`  ✗ ${c.name} — ${c.detail}`);
    }
    return errors.length || this.checks.some((c) => !c.pass) ? 1 : 0;
  }
}

// ---------------- 入口 ----------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = new URL(args.url);
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(target.hostname);
  if (!local && !args.allowRemote)
    throw new Error(`目标是 ${target.hostname}（非本机）。确认无误后加 --allow-remote；请勿对正式比赛库运行`);
  const api = new Api(args.url);
  const password = args.password || process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("缺少管理员密码：--password 或环境变量 ADMIN_PASSWORD（.env）");
  console.log(`靶机 ${args.url} · 随机种子 ${args.seed}（--seed ${args.seed} 可复现）`);
  const login = await api.request("POST", "/api/login", { body: { password } });
  if (login.status !== 200) throw new Error(`管理员登录失败: HTTP ${login.status} ${login.data?.error || ""}`);
  const sim = new Simulation(args, api);
  const { seats, picked } = await sim.loadSeats();
  sim.judges = picked.map((seat) => new VirtualJudge(seat, sim));
  sim.assignRoles(picked);
  if (args.dryRun) {
    console.log("── 演习计划（未发送任何评分请求）──");
    console.log(`模式 ${args.solo ? "solo 无人值守" : "纯评委（人肉主持）"} · ${picked.length}/${seats.length} 席 · ${args.kind}码 · ${args.profile} 风格 · ${args.speed}x 速`);
    for (const j of sim.judges)
      console.log(`  评委${pad(j.seat.number, 2)} ${pad(j.seat.name, 8)} 个人偏差 ${j.bias >= 0 ? "+" : ""}${j.bias.toFixed(1)}${j.role !== "normal" ? ` · 角色 ${j.role}` : ""}`);
    if (args.tiePositions) console.log(`  精确同分彩排：出场位 ${[...args.tiePositions].join("、")} 全体评委统一 88.5 分`);
    return;
  }
  let exitCode = 0;
  try {
    if (args.solo) await sim.runSolo();
    else await sim.runFollow();
  } catch (error) {
    console.error(`\n✗ 彩排中断: ${error.message}`);
    exitCode = 1;
  } finally {
    sim.stopAll();
    exitCode = sim.report() || exitCode;
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
