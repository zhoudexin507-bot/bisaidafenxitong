import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { z } from "zod";
import {
  openDatabase,
  getSettings,
  saveSettings,
  transaction,
  audit,
} from "./db.js";
import { calculate, rankProjects, csvCell } from "./scoring.js";
import { nextSlide, pageCount } from "./presentation.js";
import { resultViews } from "../shared/slides.js";
import { displayLayouts } from "../shared/display-layout.js";
import { defaultStage, changeStage, isScoreReleased, scoreReleaseKey } from "./stage.js";

const name = z.string().trim().min(1).max(100);
const text = z.string().trim().max(500);
const projectSchema = z.object({
  name,
  team: name,
  description: text.default(""),
  members: z.string().trim().max(2000).default(""),
  position: z.number().int().min(1).max(1000),
});
const judgeSchema = z.object({
  name,
  title: text.default(""),
});
const settingsSchema = z.object({
  title: name,
  subtitle: z.string().trim().max(500).default(""),
  trimEnabled: z.boolean(),
  trimSymmetric: z.boolean(),
  trimHigh: z.number().int().min(0).max(99),
  trimLow: z.number().int().min(0).max(99),
  judgeCount: z.number().int().min(1).max(100),
  projectCount: z.number().int().min(1).max(200),
  rounds: z.number().int().min(1).max(20),
  prizes: z.array(z.number().int().min(0).max(200)).length(3),
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
// 评委二维码默认有效期：比赛当天领码 + 前后筹备余量，7 天远超单场赛事时长。
const DEFAULT_QR_DAYS = 7;
const qrExpiry = (days = DEFAULT_QR_DAYS) => Date.now() + days * 86400000;
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function equal(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(config) {
  if (
    !config.adminPassword ||
    config.adminPassword.length < 12 ||
    config.adminPassword.includes("replace-with")
  )
    throw new Error("ADMIN_PASSWORD 需要至少 12 位，请先运行 npm run setup");
  if (
    !config.tokenSecret ||
    config.tokenSecret.length < 32 ||
    config.tokenSecret.includes("replace-with")
  )
    throw new Error("TOKEN_SECRET 需要至少 32 位随机密钥");
  const publicUrl = new URL(config.publicUrl || "http://localhost:3001");
  if (config.production && publicUrl.protocol !== "https:")
    throw new Error("生产环境 PUBLIC_URL 必须为 HTTPS");
  const db = openDatabase(config.dbPath || "./data/competition.sqlite");
  const app = express();
  const streams = new Set();
  const judgePresence = new Map();
  let cachedSnapshot = null;
  const passwordSalt = randomBytes(16);
  const passwordHash = scryptSync(config.adminPassword, passwordSalt, 64);
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:"],
          "script-src": ["'self'"],
          "connect-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  // Backgrounds are public, immutable per version and served with caching so
  // the projector does not re-download megabytes on every SSE refresh.
  app.get("/api/backgrounds/:kind", (req, res) => {
    const row = db
      .prepare("SELECT mime,data,version FROM backgrounds WHERE kind=?")
      .get(req.params.kind);
    if (!row) return res.status(404).json({ error: "背景图未设置" });
    res.set("Cache-Control", req.query.v === String(row.version)
      ? "public, max-age=86400, immutable" : "no-cache");
    res.type(row.mime).send(row.data);
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      const allowed = new Set([
        publicUrl.origin,
        ...(!config.production
          ? [
              "http://localhost:5173",
              "http://127.0.0.1:5173",
              "http://localhost:3001",
              "http://127.0.0.1:3001",
            ]
          : []),
      ]);
      if (!allowed.has(req.headers.origin))
        return res
          .status(403)
          .json({ error: "请求来源不可信，请从系统页面操作" });
      if (!req.is("application/json") && !req.is("image/*"))
        return res.status(415).json({ error: "请使用 JSON 请求" });
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 3000,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "请求过于频繁，请稍后重试" },
    }),
  );
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: !!config.production,
    path: "/",
  };
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("jh_session="))
      ?.slice(11);
    if (!token) return null;
    return db
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(hash(token), Date.now());
  }
  function admin(req, res, next) {
    if (!session(req))
      return res.status(401).json({ error: "请先登录管理员账号" });
    next();
  }
  function tokenFor(judge, kind = "official") {
    const payload =
      kind === "test"
        ? `${judge.id}.${judge.token_version}.test`
        : `${judge.id}.${judge.token_version}`;
    return `${payload}.${createHmac("sha256", config.tokenSecret).update(payload).digest("base64url")}`;
  }
  function judgeAuth(req, res, next) {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (token.length > 200)
      return res.status(401).json({ error: "评分凭证无效" });
    const parts = token.split(".");
    const kind = parts.length === 4 && parts[2] === "test" ? "test" : "official";
    const judge = db
      .prepare("SELECT * FROM judges WHERE id=?")
      .get(parts[0]);
    if (!judge || !equal(tokenFor(judge, kind), token))
      return res
        .status(401)
        .json({ error: "评分链接已失效，请联系管理员重新领取二维码" });
    if (kind === "test" && getSettings(db).mode !== "test")
      return res.status(403).json({
        error:
          "测试二维码仅在测试评分阶段可用，正式评分请使用评委专属二维码",
      });
    if (!judge.enabled || judge.expires_at <= Date.now())
      return res
        .status(403)
        .json({ error: "评分权限已停用或链接已过期，请联系管理员" });
    req.judge = judge;
    next();
  }
  function draftOnly() {
    if (
      getSettings(db).status !== "draft" ||
      db.prepare("SELECT 1 FROM entries WHERE phase='official'").get()
    )
      fail(409, "比赛已开始，名单和评分规则已锁定");
  }
  function findProject(id) {
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!project) fail(404, "项目不存在");
    return project;
  }
  function checkPosition(position, id = "") {
    if (
      db
        .prepare("SELECT id FROM projects WHERE position=? AND id<>?")
        .get(position, id)
    )
      fail(400, "出场序号已被使用，请选择其他序号");
  }
  function changed(actor, action, detail, fn) {
    const result = transaction(db, () => {
      const value = fn();
      if (
        ["新增项目", "编辑项目", "删除项目", "新增评委", "删除评委"].includes(
          action,
        )
      )
        invalidateTest();
      audit(db, actor, action, detail);
      return value;
    });
    cachedSnapshot = null;
    for (const res of streams) {
      if (res.writableLength > 64 * 1024) {
        res.end();
        streams.delete(res);
      } else res.write("event: update\ndata: {}\n\n");
    }
    return result;
  }
  function snapshot() {
    if (cachedSnapshot) return structuredClone(cachedSnapshot);
    const settings = getSettings(db);
    const judges = db
      .prepare("SELECT id,name,title,enabled FROM judges ORDER BY rowid")
      .all()
      .map((j, i) => ({ ...j, number: i + 1 }));
    const all = db.prepare("SELECT * FROM entries ORDER BY submitted_at").all();
    const groups = new Map();
    for (const entry of all) {
      const key = `${entry.phase}:${entry.round}:${entry.project_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const projects = db
      .prepare("SELECT * FROM projects ORDER BY position,rowid")
      .all()
      .map((p) => {
        const scores =
          groups.get(`${settings.mode}:${settings.currentRound}:${p.id}`) || [];
        const roundResults = Array.from({ length: settings.rounds }, (_, i) =>
          calculate(
            groups.get(`official:${i + 1}:${p.id}`) || [],
            settings,
            judges.length,
          ),
        );
        const complete = roundResults.every((r) => r.complete);
        const sum = roundResults.reduce((n, r) => n + r.sum, 0),
          count = roundResults.reduce((n, r) => n + r.count, 0);
        const overall = {
          complete,
          sum,
          count,
          average: complete ? sum / count / 100 : null,
          dropped: [],
        };
        const project = { ...p, scores };
        return {
          ...p,
          scores,
          released: isScoreReleased(settings, project),
          releaseKey: scoreReleaseKey(settings, project),
          result: calculate(scores, settings, judges.length),
          roundResults,
          overall,
        };
      });
    cachedSnapshot = {
      settings: {
        ...settings,
        judgeCount: judges.length,
        projectCount: projects.length,
      },
      backgrounds: Object.fromEntries(
        db
          .prepare("SELECT kind,version FROM backgrounds")
          .all()
          .map((row) => [row.kind, row.version]),
      ),
      judges,
      projects,
      // 测试阶段排名按测试分计算，供收官预演与同分裁定；正式阶段不变。
      ranking: rankProjects(
        projects.map((p) => ({
          ...p,
          result: settings.mode === "test" ? p.result : p.overall,
        })),
        settings,
      ),
      awards: db.prepare("SELECT * FROM awards ORDER BY rowid").all(),
      serverTime: new Date().toISOString(),
    };
    return structuredClone(cachedSnapshot);
  }
  function invalidateTest() {
    const s = getSettings(db);
    saveSettings(db, { ...s, testCompleted: false, epoch: s.epoch + 1 });
  }
  function validateReady() {
    const d = snapshot(),
      s = d.settings;
    if (!d.projects.length || !d.judges.length)
      fail(400, "请先设置项目和评委数量");
    if (s.trimEnabled && s.trimHigh + s.trimLow >= d.judges.length)
      fail(400, "去分后至少保留一位评委");
    if (s.prizes.reduce((a, b) => a + b, 0) > d.projects.length)
      fail(400, "奖项名额不能超过项目数量");
    if (
      db
        .prepare("SELECT id FROM judges WHERE enabled=0 OR expires_at<=?")
        .get(Date.now())
    )
      fail(400, "请启用所有评委并为过期链接换码");
    return d;
  }

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  function publicSnapshot() {
    const data = snapshot();
    // 收官画面（排名/颁奖）在正式发布后，或测试阶段收官预演中对外可见
    const ceremony =
      data.settings.status === "final" ||
      (data.settings.mode === "test" &&
        data.settings.presentation.view !== "project");
    const chosen =
      data.projects.find(
        (p) => p.id === data.settings.presentation.projectId,
      ) ||
      data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
      data.projects[0];
    data.judges = data.judges.map(({ id, number }) => ({ id, number }));
    data.currentTeamNumber = chosen ? data.projects.indexOf(chosen) + 1 : null;
    data.projects = chosen
      ? [chosen].map(({ roundResults, overall, tie_order, releaseKey, ...p }) =>
          p.result.complete && p.released
            ? p
            : {
                ...p,
                scores: p.scores.map(
                  ({ judge_id, project_id, submitted_at }) => ({
                    judge_id,
                    project_id,
                    submitted_at,
                  }),
                ),
                result: { complete: false, awaitingReveal: p.result.complete, average: null, dropped: [] },
              },
        )
      : [];
    data.ranking =
      ceremony &&
      ["ranking", "teamAwards"].includes(data.settings.presentation.view)
        ? data.ranking.map(
            ({ id, name, team, members, rank, prize, result }) => ({
              id,
              name,
              team,
              members,
              rank,
              prize,
              result,
            }),
          )
        : [];
    data.awards =
      ceremony && data.settings.presentation.view === "individualAwards"
        ? data.awards
        : [];
    delete data.settings.releasedScores;
    data.serverTime = new Date().toISOString();
    return data;
  }
  app.get("/api/state", (_req, res) => res.json(publicSnapshot()));
  function presenterState() {
    const data = snapshot(),
      next = nextSlide(data);
    return { data, next, key: hash(JSON.stringify(data)) };
  }
  app.get("/api/admin/presenter/state", admin, (_req, res) => {
    const { data, next, key } = presenterState();
    res.json({
      ...publicSnapshot(),
      presenter: {
        next: { ...next, key },
        ties:
          next.type === "tie"
            ? data.ranking.map((p) => ({
                id: p.id,
                team: p.team,
                position: p.position,
                score: p.result.average,
              }))
            : [],
      },
    });
  });
  app.post("/api/admin/presenter/start", admin, (_req, res) => {
    const data = snapshot(),
      s = data.settings;
    if (!s.presentation.manual)
      changed("管理员", "进入投屏演示", {}, () => {
        const current =
          data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
          data.projects.find((p) => p.status === "pending") ||
          data.projects.at(-1);
        saveSettings(db, {
          ...s,
          presentation: {
            ...s.presentation,
            manual: true,
            page: 0,
            ...(s.presentation.view === "project"
              ? { projectId: current?.id || null }
              : {}),
          },
        });
      });
    res.json({ ok: true });
  });
  app.post("/api/admin/presenter/next", admin, (req, res) => {
    const { key } = z.object({ key: z.string() }).parse(req.body),
      state = presenterState();
    if (key !== state.key) fail(409, "演示状态已更新，请按当前页面继续");
    const { data, next } = state,
      s = data.settings;
    if (!next.enabled || next.type === "tie") fail(409, next.label);
    if (["startTest", "startOfficial", "resume"].includes(next.type))
      validateReady();
    changed(
      "管理员",
      "演示下一步",
      { type: next.type, from: s.presentation },
      () => {
        let updated = { ...s };
        const show = (view, projectId = null, page = 0) => {
          updated.presentation = { view, projectId, page, manual: true };
        };
        const ready = (id) => {
          db.prepare("UPDATE projects SET status='ready' WHERE id=?").run(id);
          show("project", id);
        };
        if (next.closeId)
          db.prepare("UPDATE projects SET status='closed' WHERE id=?").run(
            next.closeId,
          );
        switch (next.type) {
          case "returnStage":
            updated = changeStage(updated, { action: "scene", scene: "live" });
            break;
          case "reveal": {
            const project = data.projects.find((p) => p.id === next.projectId);
            updated.releasedScores = { ...s.releasedScores, [project.id]: project.releaseKey };
            break;
          }
          case "startTest":
            db.exec(
              "DELETE FROM entries WHERE phase='test'; DELETE FROM revisions WHERE phase='test'; UPDATE projects SET status='pending',tie_order=NULL",
            );
            updated = {
              ...updated,
              mode: "test",
              status: "running",
              currentRound: 1,
              testCompleted: false,
              epoch: s.epoch + 1,
            };
            ready(data.projects[0].id);
            break;
          case "publishTest":
            // 测试收官预演：封存末队并展示测试分排名，不改比赛状态、不锁定任何内容
            if (data.projects.some((p) => !p.result.complete))
              fail(409, "请先完成全部测试评分");
            show("ranking");
            break;
          case "finishTest":
            db.exec("UPDATE projects SET status='pending',tie_order=NULL");
            updated = {
              ...updated,
              mode: "official",
              status: "draft",
              currentRound: 1,
              testCompleted: true,
              epoch: s.epoch + 1,
            };
            show("project", data.projects[0].id);
            break;
          case "startOfficial":
            if (!s.testCompleted) fail(409, "请先完成测试评分");
            updated.status = "running";
            ready(data.projects[0].id);
            break;
          case "resume":
            updated.status = "running";
            break;
          case "open":
            db.prepare("UPDATE projects SET status='open' WHERE id=?").run(
              next.projectId,
            );
            show("project", next.projectId);
            break;
          case "prepare":
            ready(next.projectId);
            break;
          case "round":
            db.exec("UPDATE projects SET status='pending',tie_order=NULL");
            updated = {
              ...updated,
              currentRound: s.currentRound + 1,
              epoch: s.epoch + 1,
            };
            ready(data.projects[0].id);
            break;
          case "publish":
            if (
              data.ranking.length !== data.projects.length ||
              data.projects.some((p) => !p.overall.complete)
            )
              fail(409, "请完成全部轮次评分");
            db.exec("UPDATE projects SET status='closed'");
            updated.status = "final";
            show("ranking");
            break;
          case "view":
            show(next.view, null, next.page);
            break;
          default:
            fail(409, "当前无法继续");
        }
        saveSettings(db, updated);
      },
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/presenter/previous", admin, (req, res) => {
    const { key } = z.object({ key: z.string() }).parse(req.body),
      { data, key: currentKey } = presenterState(),
      s = data.settings;
    if (key !== currentKey) fail(409, "演示状态已更新，请按当前页面继续");
    // 测试收官预演与正式发布后都允许回看颁奖页面
    if (
      s.status !== "final" &&
      !(s.mode === "test" && s.presentation.view !== "project")
    )
      fail(409, "评分阶段不能倒退");
    const views = resultViews(data);
    let view = s.presentation.view,
      page = s.presentation.page || 0;
    if (page > 0) page--;
    else {
      const index = views.indexOf(view);
      if (index <= 0) fail(409, "已经是第一页");
      view = views[index - 1];
      page = pageCount(data, view) - 1;
    }
    changed("管理员", "演示上一页", { view, page }, () =>
      saveSettings(db, {
        ...s,
        presentation: { view, projectId: null, page, manual: true, reviewing: true },
      }),
    );
    res.json({ ok: true });
  });
  app.get("/api/events", (req, res) => {
    if (streams.size >= 1000) return res.status(503).end();
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 2500\nevent: update\ndata: {}\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
  });
  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(": heartbeat\n\n");
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  }, 20_000);
  heartbeat.unref();

  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "登录失败次数过多，请 15 分钟后重试" },
  });
  app.post("/api/login", loginLimit, (req, res) => {
    const { password } = z
      .object({ password: z.string().min(1).max(256) })
      .parse(req.body);
    if (!timingSafeEqual(scryptSync(password, passwordSalt, 64), passwordHash))
      fail(401, "管理员密码不正确");
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?)").run(
      hash(token),
      Date.now() + 12 * 60 * 60_000,
    );
    audit(db, "管理员", "登录", {});
    res
      .cookie("jh_session", token, {
        ...cookieOptions,
        maxAge: 12 * 60 * 60_000,
      })
      .json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    const current = session(req);
    if (current)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        current.token_hash,
      );
    res.clearCookie("jh_session", cookieOptions).json({ ok: true });
  });
  app.get("/api/admin/state", admin, (_req, res) =>
    res.json({
      ...snapshot(),
      serverTime: new Date().toISOString(),
      judges: db.prepare("SELECT * FROM judges ORDER BY rowid").all().map((j, i) => {
        const seen = judgePresence.get(j.id);
        const valid = j.enabled && j.expires_at > Date.now() && seen?.version === j.token_version;
        return { ...j, number: i + 1, lastSeen: valid ? seen.at : null,
          online: !!(valid && Date.now() - seen.at < 45000) };
      }),
      audit: db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100").all(),
      publicUrl: publicUrl.origin,
      archives: db
        .prepare(
          "SELECT id,title,created_at FROM archives ORDER BY created_at DESC",
        )
        .all(),
    }),
  );
  app.put("/api/admin/display-options", admin, (req, res) => {
    const options = z.object({ showTeamNumber: z.boolean() })
      .partial().strict().refine(v => Object.keys(v).length > 0).parse(req.body);
    changed("管理员", "设置大屏文字显示", options, () =>
      saveSettings(db, { ...getSettings(db), ...options }));
    res.json({ ok: true });
  });
  app.put("/api/admin/display-layout/:view/:layer", admin, (req, res) => {
    const { view, layer } = req.params;
    if (!Object.hasOwn(displayLayouts, view) || !Object.hasOwn(displayLayouts[view], layer))
      fail(404, "画面或文字项不存在");
    const style = z.object({
      size: z.number().int().min(12).max(160),
      x: z.number().int().min(1).max(99),
      y: z.number().int().min(1).max(99),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
      hidden: z.boolean().optional(),
    }).strict().parse(req.body);
    changed("管理员", "保存大屏文字排版", { view, layer, ...style }, () => {
      const settings = getSettings(db);
      const layouts = settings.displayLayouts || {};
      saveSettings(db, { ...settings, displayLayouts: {
        ...layouts, [view]: { ...layouts[view], [layer]: style },
      } });
    });
    res.json({ ok: true });
  });
  const backgroundKinds = new Set(["home", "awards"]);
  const imageMimes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  function sniffImage(buffer) {
    const text = (start, end) => buffer.subarray(start, end).toString("latin1");
    if (buffer.length >= 8 && buffer[0] === 0x89 && text(1, 4) === "PNG")
      return "image/png";
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return "image/jpeg";
    if (buffer.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP")
      return "image/webp";
    if (buffer.length >= 6 && text(0, 3) === "GIF") return "image/gif";
    return null;
  }
  app.put(
    "/api/admin/backgrounds/:kind",
    admin,
    express.raw({ type: imageMimes, limit: "10mb" }),
    (req, res) => {
      if (!backgroundKinds.has(req.params.kind))
        fail(404, "背景图类型不存在");
      const image = req.body;
      if (!Buffer.isBuffer(image) || !image.length)
        fail(400, "请选择 PNG、JPG、WebP 或 GIF 图片");
      const mime = sniffImage(image);
      if (!mime) fail(400, "图片内容无法识别，请使用 PNG、JPG、WebP 或 GIF");
      changed(
        "管理员",
        "设置背景图",
        { kind: req.params.kind, size: image.length, mime },
        () =>
          db
            .prepare(
              `INSERT INTO backgrounds VALUES (?,?,?,?,?)
               ON CONFLICT(kind) DO UPDATE SET mime=excluded.mime, data=excluded.data, version=excluded.version, updated_at=excluded.updated_at`,
            )
            .run(req.params.kind, mime, image, Date.now(), new Date().toISOString()),
      );
      res.json({ ok: true });
    },
  );
  app.delete("/api/admin/backgrounds/:kind", admin, (req, res) => {
    if (!backgroundKinds.has(req.params.kind)) fail(404, "背景图类型不存在");
    if (db.prepare("SELECT 1 FROM backgrounds WHERE kind=?").get(req.params.kind))
      changed("管理员", "清除背景图", { kind: req.params.kind }, () =>
        db.prepare("DELETE FROM backgrounds WHERE kind=?").run(req.params.kind),
      );
    res.json({ ok: true });
  });
  app.put("/api/admin/reveal-mode", admin, (req, res) => {
    const { mode } = z.object({ mode: z.enum(["auto", "manual"]) }).parse(req.body);
    draftOnly();
    const s = getSettings(db);
    changed("管理员", "设置亮分方式", { mode }, () =>
      saveSettings(db, { ...s, revealMode: mode }));
    res.json({ ok: true });
  });
  app.post("/api/admin/reveal", admin, (req, res) => {
    const { projectId, releaseKey } = z.object({ projectId: z.string(), releaseKey: z.string() }).parse(req.body);
    const d = snapshot(), p = d.projects.find((p) => p.id === projectId);
    if (!p || p.status !== "open" || !p.result.complete || d.settings.status === "final")
      fail(409, "请先收齐当前队伍的全部评分");
    if (releaseKey !== p.releaseKey) fail(409, "评分已更新，请核对后重新公布");
    if (!p.released) changed("管理员", "公布成绩", { projectId, round: d.settings.currentRound }, () =>
      saveSettings(db, { ...d.settings, releasedScores: { ...d.settings.releasedScores, [p.id]: releaseKey } }));
    res.json({ ok: true });
  });
  app.post("/api/admin/stage", admin, (req, res) => {
    const command = z.discriminatedUnion("action", [
      z.object({ action: z.literal("scene"), scene: z.enum(["live", "home", "standby", "break"]), message: z.string().trim().max(100).default(""), seconds: z.number().int().min(0).max(7200).default(0), version: z.number().int() }),
      ...["start", "pause"].map((action) => z.object({ action: z.literal(action), version: z.number().int() })),
      z.object({ action: z.literal("reset"), seconds: z.number().int().min(0).max(7200), version: z.number().int() }),
    ]).parse(req.body);
    const s = getSettings(db);
    if (command.version !== (s.stage?.version || 0)) fail(409, "大屏状态已更新，请重试");
    changed("管理员", "控制候场画面", command, () => saveSettings(db, changeStage(s, command)));
    res.json({ ok: true });
  });
  app.put("/api/admin/settings", admin, (req, res) => {
    const current = snapshot().settings;
    if (current.status === "final")
      fail(409, "成绩已发布，请归档并新建比赛后设置");
    const value = settingsSchema.parse(req.body);
    if (value.trimSymmetric) value.trimLow = value.trimHigh;
    const coreChanged = [
      "judgeCount",
      "projectCount",
      "rounds",
      "trimEnabled",
      "trimSymmetric",
      "trimHigh",
      "trimLow",
    ].some((key) => value[key] !== current[key]);
    if (coreChanged) draftOnly();
    if (value.trimEnabled && value.trimHigh + value.trimLow >= value.judgeCount)
      fail(400, "去分后至少保留一位评委");
    if (value.prizes.reduce((a, b) => a + b, 0) > value.projectCount)
      fail(400, "奖项名额不能超过项目数量");
    changed("管理员", "修改赛事设置", value, () => {
      for (const [table, count] of [
        ["judges", value.judgeCount],
        ["projects", value.projectCount],
      ]) {
        const rows = db.prepare(`SELECT id FROM ${table} ORDER BY rowid`).all();
        for (const row of rows.slice(count))
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);
        for (let i = rows.length; i < count; i++) {
          const label = String(i + 1).padStart(2, "0");
          if (table === "judges")
            db.prepare(
              "INSERT INTO judges(id,name,expires_at) VALUES (?,?,?)",
            ).run(randomUUID(), `评委 ${label}`, qrExpiry());
          else {
            let position = i + 1;
            while (
              db
                .prepare("SELECT id FROM projects WHERE position=?")
                .get(position)
            )
              position++;
            db.prepare(
              "INSERT INTO projects(id,name,team,position) VALUES (?,?,?,?)",
            ).run(randomUUID(), `项目 ${label}`, `第 ${label} 队`, position);
          }
        }
      }
      saveSettings(db, {
        ...getSettings(db),
        ...value,
        testCompleted: coreChanged ? false : current.testCompleted,
        epoch: current.epoch + (coreChanged ? 1 : 0),
      });
    });
    res.json({ ok: true });
  });
  app.put("/api/admin/prizes", admin, (req, res) => {
    const settings = getSettings(db);
    if (settings.status === "final") fail(409, "成绩已发布，奖项已锁定");
    const { prizes } = z
      .object({ prizes: settingsSchema.shape.prizes })
      .parse(req.body);
    if (
      prizes.reduce((a, b) => a + b, 0) >
      db.prepare("SELECT COUNT(*) n FROM projects").get().n
    )
      fail(400, "奖项名额不能超过项目数量");
    changed("管理员", "修改奖项名额", { prizes }, () =>
      saveSettings(db, { ...settings, prizes }),
    );
    res.json({ ok: true });
  });
  app.get("/api/admin/archives/:id", admin, (req, res) => {
    const record = db
      .prepare("SELECT payload FROM archives WHERE id=?")
      .get(req.params.id);
    if (!record) fail(404, "归档不存在");
    res
      .attachment(`competition-${req.params.id}.json`)
      .type("application/json")
      .send(record.payload);
  });
  app.post("/api/admin/competitions/new", admin, (req, res) => {
    const { epoch } = z.object({ epoch: z.number().int() }).parse(req.body),
      settings = getSettings(db);
    if (epoch !== settings.epoch) fail(409, "赛事已变化，请刷新后操作");
    const id = randomUUID();
    changed("管理员", "归档并新建比赛", { archiveId: id }, () => {
      const payload = { version: 1, settings, results: snapshot() };
      payload.backgrounds = db.prepare("SELECT * FROM backgrounds").all()
        .map(({ data, ...metadata }) => ({ ...metadata, dataBase64: Buffer.from(data).toString("base64") }));
      for (const table of [
        "projects",
        "judges",
        "entries",
        "revisions",
        "scores",
        "score_revisions",
        "awards",
        "audit",
      ])
        payload[table] = db.prepare(`SELECT * FROM ${table}`).all();
      db.prepare("INSERT INTO archives VALUES (?,?,?,?)").run(
        id,
        settings.title,
        new Date().toISOString(),
        JSON.stringify(payload),
      );
      db.exec(
        "DELETE FROM scores; DELETE FROM score_revisions; DELETE FROM entries; DELETE FROM revisions; DELETE FROM awards; UPDATE projects SET status='pending',tie_order=NULL;",
      );
      db.prepare(
        "UPDATE judges SET token_version=token_version+1, enabled=1, expires_at=?",
      ).run(qrExpiry());
      saveSettings(db, {
        ...settings,
        status: "draft",
        mode: "official",
        currentRound: 1,
        epoch: settings.epoch + 1,
        releasedScores: {},
        stage: { ...defaultStage },
        testCompleted: false,
        demo: false,
        presentation: { view: "project", projectId: null },
      });
    });
    res.json({ ok: true, archiveId: id });
  });
  app.post("/api/admin/test/start", admin, (req, res) => {
    draftOnly();
    validateReady();
    const s = getSettings(db);
    changed("管理员", "开始测试评分", {}, () => {
      db.exec(
        "DELETE FROM entries WHERE phase='test'; DELETE FROM revisions WHERE phase='test'; UPDATE projects SET status='pending',tie_order=NULL",
      );
      saveSettings(db, {
        ...s,
        mode: "test",
        status: "running",
        testCompleted: false,
        currentRound: 1,
        epoch: s.epoch + 1,
        presentation: { view: "project", projectId: null },
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/test/finish", admin, (req, res) => {
    const s = getSettings(db);
    if (s.mode !== "test" || s.status !== "running")
      fail(409, "当前不在测试评分阶段");
    changed("管理员", "完成测试评分", {}, () => {
      db.exec("UPDATE projects SET status='pending',tie_order=NULL");
      saveSettings(db, {
        ...s,
        mode: "official",
        status: "draft",
        testCompleted: true,
        currentRound: 1,
        epoch: s.epoch + 1,
        presentation: { view: "project", projectId: null },
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/round/next", admin, (req, res) => {
    const d = snapshot(),
      s = d.settings;
    if (
      s.mode !== "official" ||
      !["running", "paused"].includes(s.status) ||
      s.currentRound >= s.rounds ||
      d.projects.some((p) => !p.result.complete || p.status !== "closed")
    )
      fail(409, "请先收齐并封存本轮全部项目");
    changed("管理员", "进入下一轮", { round: s.currentRound + 1 }, () => {
      db.exec("UPDATE projects SET status='pending',tie_order=NULL");
      saveSettings(db, {
        ...s,
        currentRound: s.currentRound + 1,
        epoch: s.epoch + 1,
        presentation: { view: "project", projectId: null },
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/tiebreak", admin, (req, res) => {
    const { projectIds, reason } = z
        .object({ projectIds: z.array(z.string()), reason: name })
        .parse(req.body),
      d = snapshot();
    if (d.settings.status === "final" || d.ranking.length !== d.projects.length)
      fail(409, "请完成全部轮次后确认同分顺序");
    if (
      new Set(projectIds).size !== d.projects.length ||
      projectIds.length !== d.projects.length ||
      projectIds.some((id) => !d.projects.some((p) => p.id === id))
    )
      fail(400, "请提供所有项目的完整顺序");
    changed("管理员", "确认同分顺序", { projectIds, reason }, () =>
      projectIds.forEach((id, i) =>
        db.prepare("UPDATE projects SET tie_order=? WHERE id=?").run(i, id),
      ),
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/projects", admin, (req, res) => {
    draftOnly();
    const p = projectSchema.parse(req.body);
    checkPosition(p.position);
    if (db.prepare("SELECT COUNT(*) AS n FROM projects").get().n >= 200)
      fail(400, "单场最多支持 200 个项目");
    const id = randomUUID();
    changed("管理员", "新增项目", p, () =>
      db
        .prepare(
          "INSERT INTO projects(id,name,team,description,position,members) VALUES (?,?,?,?,?,?)",
        )
        .run(id, p.name, p.team, p.description, p.position, p.members),
    );
    res.status(201).json({ id });
  });
  app.put("/api/admin/projects/:id", admin, (req, res) => {
    draftOnly();
    findProject(req.params.id);
    const p = projectSchema.parse(req.body);
    checkPosition(p.position, req.params.id);
    changed("管理员", "编辑项目", p, () =>
      db
        .prepare(
          "UPDATE projects SET name=?,team=?,description=?,position=?,members=? WHERE id=?",
        )
        .run(
          p.name,
          p.team,
          p.description,
          p.position,
          p.members,
          req.params.id,
        ),
    );
    res.json({ ok: true });
  });
  app.delete("/api/admin/projects/:id", admin, (req, res) => {
    draftOnly();
    findProject(req.params.id);
    changed("管理员", "删除项目", { id: req.params.id }, () =>
      db.prepare("DELETE FROM projects WHERE id=?").run(req.params.id),
    );
    res.json({ ok: true });
  });
  app.put("/api/admin/projects/:id/members", admin, (req, res) => {
    if (getSettings(db).status === "final") fail(409, "成绩已发布，名单已锁定");
    const p = findProject(req.params.id);
    const { members } = z
      .object({ members: z.string().trim().max(2000) })
      .parse(req.body);
    changed("管理员", "更新队员名单", { projectId: p.id, members }, () =>
      db.prepare("UPDATE projects SET members=? WHERE id=?").run(members, p.id),
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/presentation", admin, (req, res) => {
    const presentation = z
      .object({
        view: z.enum(["project", "ranking", "teamAwards", "individualAwards"]),
        projectId: z.string().nullable().default(null),
      })
      .parse(req.body);
    const settings = getSettings(db);
    // 正式发布后可切颁奖画面；测试阶段收齐全部测试分后也可切（收官预演）
    const testCeremonyReady =
      settings.mode === "test" &&
      snapshot().projects.every((p) => p.result.complete);
    if (presentation.view !== "project" && settings.status !== "final" && !testCeremonyReady)
      fail(409, settings.mode === "test" ? "请先收齐全部测试评分" : "请先收齐并发布全部成绩");
    if (presentation.view === "project") {
      if (!presentation.projectId) fail(400, "请选择展示队伍");
      findProject(presentation.projectId);
    } else presentation.projectId = null;
    changed("管理员", "切换大屏", presentation, () =>
      saveSettings(db, { ...settings,
        stage: presentation.view !== "project" && settings.stage.scene !== "live"
          ? changeStage(settings, { action: "scene", scene: "live" }).stage : settings.stage,
        presentation: { ...presentation, startedAt: Date.now() } }),
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/judges", admin, (req, res) => {
    draftOnly();
    const j = judgeSchema
      .extend({
        days: z.number().int().min(1).max(30).default(DEFAULT_QR_DAYS),
      })
      .parse(req.body);
    if (db.prepare("SELECT COUNT(*) AS n FROM judges").get().n >= 100)
      fail(400, "单场最多支持 100 位评委");
    const id = randomUUID();
    changed("管理员", "新增评委", { name: j.name, days: j.days }, () =>
      db
        .prepare(
          "INSERT INTO judges(id,name,title,expires_at) VALUES (?,?,?,?)",
        )
        .run(id, j.name, j.title, qrExpiry(j.days)),
    );
    res.status(201).json({ id });
  });
  // 以下两个批量端点必须先于 /judges/:id 注册，避免 "renew-all"/"test-links" 被当成评委 id。
  app.post("/api/admin/judges/renew-all", admin, (req, res) => {
    const { days } = z
      .object({ days: z.number().int().min(1).max(30).default(DEFAULT_QR_DAYS) })
      .parse(req.body || {});
    const rows = db.prepare("SELECT id FROM judges").all();
    changed(
      "管理员",
      "批量续期评委二维码",
      { days, count: rows.length },
      () =>
        db
          .prepare("UPDATE judges SET expires_at=MAX(expires_at,?)")
          .run(qrExpiry(days)),
    );
    res.json({ ok: true, count: rows.length });
  });
  app.get("/api/admin/judges/test-links", admin, (_req, res) => {
    const judges = db
      .prepare("SELECT id,name,token_version,expires_at FROM judges ORDER BY rowid")
      .all();
    res.json({
      judges: judges.map((j, i) => ({
        id: j.id,
        number: i + 1,
        name: j.name,
        expires_at: j.expires_at,
        token_version: j.token_version,
        url: `${publicUrl.origin}/judge#${tokenFor(j, "test")}`,
      })),
    });
  });
  app.put("/api/admin/judges/:id", admin, (req, res) => {
    draftOnly();
    const j = judgeSchema.parse(req.body);
    if (!db.prepare("SELECT id FROM judges WHERE id=?").get(req.params.id))
      fail(404, "评委不存在");
    changed("管理员", "编辑评委", { id: req.params.id, name: j.name }, () =>
      db
        .prepare("UPDATE judges SET name=?,title=? WHERE id=?")
        .run(j.name, j.title, req.params.id),
    );
    res.json({ ok: true });
  });
  app.delete("/api/admin/judges/:id", admin, (req, res) => {
    draftOnly();
    changed("管理员", "删除评委", { id: req.params.id }, () =>
      db.prepare("DELETE FROM judges WHERE id=?").run(req.params.id),
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/judges/:id/access", admin, (req, res) => {
    const v = z
      .object({
        enabled: z.boolean().optional(),
        rotate: z.boolean().optional(),
        renew: z.boolean().optional(),
        days: z.number().int().min(1).max(30).optional(),
      })
      .parse(req.body);
    const j = db.prepare("SELECT * FROM judges WHERE id=?").get(req.params.id);
    if (!j) fail(404, "评委不存在");
    if (v.enabled === undefined && !v.rotate && !v.renew)
      fail(400, "请指定要执行的操作");
    const days = v.days ?? DEFAULT_QR_DAYS;
    let expiresAt = j.expires_at;
    if (v.rotate) expiresAt = qrExpiry(days);
    else if (v.renew) expiresAt = Math.max(expiresAt, qrExpiry(days));
    changed(
      "管理员",
      v.renew && !v.rotate ? "续期评委二维码" : "更新评委权限",
      { id: j.id, ...v, days },
      () =>
        db
          .prepare(
            "UPDATE judges SET enabled=?,token_version=?,expires_at=? WHERE id=?",
          )
          .run(
            v.enabled === undefined ? j.enabled : Number(v.enabled),
            j.token_version + (v.rotate ? 1 : 0),
            expiresAt,
            j.id,
          ),
    );
    res.json({ ok: true });
  });
  app.get("/api/admin/judges/:id/link", admin, (req, res) => {
    const j = db.prepare("SELECT * FROM judges WHERE id=?").get(req.params.id);
    if (!j) fail(404, "评委不存在");
    const kind = req.query.kind === "test" ? "test" : "official";
    res.json({
      url: `${publicUrl.origin}/judge#${tokenFor(j, kind)}`,
      expires_at: j.expires_at,
      kind,
      mode: kind === "test" ? "test" : "official",
    });
  });
  app.get("/api/admin/judges/:id/qr", admin, async (req, res) => {
    const j = db.prepare("SELECT * FROM judges WHERE id=?").get(req.params.id);
    if (!j) fail(404, "评委不存在");
    const kind = req.query.kind === "test" ? "test" : "official";
    const svg = await QRCode.toString(
      `${publicUrl.origin}/judge#${tokenFor(j, kind)}`,
      { type: "svg", width: 280, margin: 3, errorCorrectionLevel: "M" },
    );
    res.type("image/svg+xml").send(svg);
  });
  app.post("/api/admin/status", admin, (req, res) => {
    const { status } = z
      .object({ status: z.enum(["running", "paused", "final"]) })
      .parse(req.body);
    const s = getSettings(db);
    const allowed = {
      draft: ["running"],
      running: ["paused", "final"],
      paused: ["running", "final"],
      final: [],
    };
    if (!allowed[s.status].includes(status))
      fail(409, "当前比赛状态不允许此操作");
    const data = snapshot();
    if (status === "running") {
      if (s.mode === "official" && !s.testCompleted)
        fail(409, "正式比赛前请先完成测试评分");
      validateReady();
      if (!data.projects.length || !data.judges.length)
        fail(400, "请先添加项目和评委");
      if (s.trimEnabled && s.trimHigh + s.trimLow >= data.judges.length)
        fail(400, "去除最高最低分后至少需保留一位评委");
      if (data.judges.some((j) => !j.enabled) && s.status === "draft")
        fail(400, "开赛前请启用全部评委，或删除不参与的评委");
      if (
        db.prepare("SELECT id FROM judges WHERE expires_at<=?").get(Date.now())
      )
        fail(400, "存在过期评委链接，请先换码续期");
    }
    if (
      status === "final" &&
      data.projects.some((p) => !p.result.complete || p.status !== "closed")
    )
      fail(409, "请收齐全部评分并封存所有项目后再发布最终成绩");
    if (
      status === "final" &&
      (s.mode !== "official" ||
        s.currentRound !== s.rounds ||
        data.ranking.length !== data.projects.length ||
        data.ranking.some((p) => p.tieUnresolved))
    )
      fail(409, "请完成所有轮次，并在成绩排名中确认同分顺序");
    changed("管理员", "切换比赛状态", { from: s.status, to: status }, () =>
      saveSettings(db, {
        ...s,
        status,
        ...(status === "final"
          ? { presentation: { view: "ranking", projectId: null, startedAt: Date.now() } }
          : {}),
      }),
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/projects/:id/status", admin, (req, res) => {
    const { status } = z
      .object({ status: z.enum(["ready", "open", "closed"]) })
      .parse(req.body);
    const s = getSettings(db);
    const p = findProject(req.params.id);
    if (!["running", "paused"].includes(s.status))
      fail(409, "比赛尚未开始或已结束");
    if (p.status === "closed" && status === "open" && s.status !== "paused")
      fail(409, "请先暂停比赛，再重新开放项目");
    if (
      status === "ready" &&
      db
        .prepare(
          "SELECT 1 FROM entries WHERE phase=? AND round=? AND project_id=?",
        )
        .get(s.mode, s.currentRound, p.id)
    )
      fail(409, "已有评分，请使用重新评分");
    if (
      status === "closed" &&
      !snapshot().projects.find((x) => x.id === p.id).result.complete
    )
      fail(409, "评分尚未收齐，不能封存");
    if (status === "closed" && !snapshot().projects.find((x) => x.id === p.id).released)
      fail(409, "请先公布本队成绩，再封存");
    if (
      ["ready", "open"].includes(status) &&
      db
        .prepare(
          "SELECT id FROM projects WHERE id<>? AND status IN ('open','ready')",
        )
        .get(p.id)
    )
      fail(409, "请先封存当前项目，再开放下一项目");
    changed("管理员", "切换项目状态", { id: p.id, status }, () => {
      db.prepare("UPDATE projects SET status=? WHERE id=?").run(status, p.id);
      saveSettings(db, {
        ...s,
        presentation: { view: "project", projectId: p.id },
      });
    });
    res.json({ ok: true });
  });

  app.post("/api/admin/scores/rejudge", admin, (req, res) => {
    const v = z
      .object({
        projectId: z.string(),
        judgeIds: z.array(z.string()).min(1).max(100),
        reason: z.string().trim().max(500).default(""),
      })
      .parse(req.body);
    const settings = getSettings(db);
    if (!["running", "paused"].includes(settings.status))
      fail(409, "当前不能重评");
    const p = findProject(v.projectId);
    if (
      db
        .prepare(
          "SELECT id FROM projects WHERE id<>? AND status IN ('open','ready')",
        )
        .get(p.id)
    )
      fail(409, "请先封存当前项目");
    const ids = [...new Set(v.judgeIds)];
    if (p.status === "pending" || p.status === "ready")
      fail(409, "项目尚未开始评分");
    for (const id of ids)
      if (!db.prepare("SELECT id FROM judges WHERE id=?").get(id))
        fail(400, "评委不存在");
    const originals = db
      .prepare(
        "SELECT * FROM entries WHERE phase=? AND round=? AND project_id=?",
      )
      .all(settings.mode, settings.currentRound, p.id)
      .filter((s) => ids.includes(s.judge_id));
    changed("管理员", "重新评分", { ...v, judgeIds: ids, originals }, () => {
      for (const id of ids) {
        db.prepare(
          "DELETE FROM entries WHERE phase=? AND round=? AND project_id=? AND judge_id=?",
        ).run(settings.mode, settings.currentRound, p.id, id);
        db.prepare(
          "INSERT INTO revisions VALUES (?,?,?,?,1) ON CONFLICT(phase,round,project_id,judge_id) DO UPDATE SET revision=revision+1",
        ).run(settings.mode, settings.currentRound, p.id, id);
      }
      db.prepare("UPDATE projects SET status='open' WHERE id=?").run(p.id);
      db.exec("UPDATE projects SET tie_order=NULL");
      saveSettings(db, {
        ...settings,
        releasedScores: { ...settings.releasedScores, [p.id]: null },
        presentation: {
          ...settings.presentation,
          view: "project",
          projectId: p.id,
          page: 0,
        },
      });
    });
    res.json({ ok: true, reset: ids.length });
  });
  app.post("/api/admin/awards", admin, (req, res) => {
    if (getSettings(db).status === "final")
      fail(409, "最终成绩已发布，奖项已锁定");
    const v = z
      .object({ name, recipient: name })
      .parse(req.body);
    const id = randomUUID();
    changed("管理员", "新增个人奖项", v, () =>
      db
        .prepare("INSERT INTO awards VALUES (?,?,?,'')")
        .run(id, v.name, v.recipient),
    );
    res.status(201).json({ id });
  });
  app.post("/api/admin/awards/bulk", admin, (req, res) => {
    if (getSettings(db).status === "final")
      fail(409, "最终成绩已发布，奖项已锁定");
    const v = z
      .object({
        replace: z.boolean().default(false),
        awards: z
          .array(z.object({ name, recipient: name }))
          .min(1)
          .max(500),
      })
      .parse(req.body);
    const rows = v.awards.map((a) => [randomUUID(), a.name, a.recipient]);
    changed(
      "管理员",
      "批量导入个人奖项",
      { count: rows.length, replace: v.replace },
      () => {
        if (v.replace) db.exec("DELETE FROM awards");
        const insert = db.prepare("INSERT INTO awards VALUES (?,?,?,'')");
        for (const row of rows) insert.run(...row);
      },
    );
    res.status(201).json({ ok: true, count: rows.length });
  });
  app.delete("/api/admin/awards/:id", admin, (req, res) => {
    if (getSettings(db).status === "final")
      fail(409, "最终成绩已发布，奖项已锁定");
    changed("管理员", "删除个人奖项", { id: req.params.id }, () =>
      db.prepare("DELETE FROM awards WHERE id=?").run(req.params.id),
    );
    res.json({ ok: true });
  });
  const judgeProjects = db.prepare(`
    SELECT p.id, p.name, p.team, p.position, p.status,
           COALESCE(r.revision, 0) AS revision, e.total, e.submitted_at
    FROM projects p
    LEFT JOIN revisions r ON r.project_id=p.id AND r.phase=:phase AND r.round=:round AND r.judge_id=:judge
    LEFT JOIN entries e ON e.project_id=p.id AND e.phase=:phase AND e.round=:round AND e.judge_id=:judge
    ORDER BY p.position, p.rowid
  `);
  app.get("/api/judge/state", judgeAuth, (req, res) => {
    judgePresence.set(req.judge.id, { at: Date.now(), version: req.judge.token_version });
    const s = getSettings(db);
    const judges = db.prepare("SELECT id FROM judges ORDER BY rowid").all();
    const projects = judgeProjects.all({ phase: s.mode, round: s.currentRound, judge: req.judge.id });
    res.json({
      settings: { ...s, judgeCount: judges.length, projectCount: projects.length, releasedScores: undefined },
      judge: {
        id: req.judge.id,
        number: judges.findIndex((j) => j.id === req.judge.id) + 1,
      },
      projects: projects.map(({ total, submitted_at, ...project }) => ({
        ...project,
        ownScore: total == null ? null : {
          phase: s.mode, round: s.currentRound, project_id: project.id,
          judge_id: req.judge.id, total, submitted_at,
        },
      })),
    });
  });
  app.post("/api/judge/scores", judgeAuth, (req, res) => {
    const v = z
        .object({
          projectId: z.string(),
          score: z.number().finite().min(0).max(100),
          phase: z.enum(["test", "official"]),
          round: z.number().int(),
          epoch: z.number().int(),
          revision: z.number().int().min(0),
        })
        .parse(req.body),
      s = getSettings(db);
    if (v.phase !== s.mode || v.round !== s.currentRound || v.epoch !== s.epoch)
      fail(409, "赛程已更新，请刷新后重新填写");
    const revision =
      db
        .prepare(
          "SELECT revision FROM revisions WHERE phase=? AND round=? AND project_id=? AND judge_id=?",
        )
        .get(s.mode, s.currentRound, v.projectId, req.judge.id)?.revision || 0;
    if (v.revision !== revision) fail(409, "评分已重置，请重新填写");
    if (Math.abs(v.score * 100 - Math.round(v.score * 100)) > 0.00001)
      fail(400, "总分最多两位小数");
    const total = Math.round(v.score * 100),
      p = findProject(v.projectId);
    const existing = db
      .prepare(
        "SELECT total FROM entries WHERE phase=? AND round=? AND project_id=? AND judge_id=?",
      )
      .get(s.mode, s.currentRound, p.id, req.judge.id);
    if (existing) {
      if (existing.total === total)
        return res.json({ ok: true, duplicate: true, total: v.score });
      fail(409, "已经提交，如需修改请联系管理员重评");
    }
    if (s.status !== "running" || p.status !== "open")
      fail(409, "当前项目尚未开放评分或比赛已暂停");
    changed(
      `评委 ${req.judge.id}`,
      "提交评分",
      { ...v, judgeId: req.judge.id },
      () =>
        db
          .prepare("INSERT INTO entries VALUES (?,?,?,?,?,?)")
          .run(
            s.mode,
            s.currentRound,
            p.id,
            req.judge.id,
            total,
            new Date().toISOString(),
          ),
    );
    res.status(201).json({ ok: true, total: v.score });
  });
  app.get("/api/admin/export.csv", admin, (req, res) => {
    const d = snapshot(),
      rows = [
        ["赛事", d.settings.title],
        ["汇总方式", "各轮平均分"],
        ["项目", "队伍", "最终排名", "奖项", "各轮平均分", "队员"],
      ];
    for (const p of d.projects) {
      const r = d.ranking.find((r) => r.id === p.id);
      rows.push([
        p.name,
        p.team,
        r?.rank,
        r?.prize ? ["", "一等奖", "二等奖", "三等奖"][r.prize] : "",
        r?.result.average.toFixed(2) ?? "未完成",
        p.members,
      ]);
    }
    rows.push(
      [],
      ["项目", "轮次", "评委序号", "原始分", "处理", "该轮得分", "提交时间"],
    );
    const all = db
      .prepare(
        "SELECT * FROM entries WHERE phase='official' ORDER BY round,project_id,submitted_at",
      )
      .all();
    for (const e of all) {
      const p = d.projects.find((p) => p.id === e.project_id),
        r = p.roundResults[e.round - 1];
      rows.push([
        p.name,
        e.round,
        d.judges.find((j) => j.id === e.judge_id).number,
        e.total / 100,
        r.complete
          ? r.dropped.includes(e.judge_id)
            ? "剔除"
            : "保留"
          : "未收齐",
        r.complete ? r.average.toFixed(2) : "",
        e.submitted_at,
      ]);
    }
    rows.push(
      [],
      ["单位", "姓名"],
      ...d.awards.map((a) => [a.name, a.recipient]),
    );
    res
      .attachment("competition-results.csv")
      .type("text/csv; charset=utf-8")
      .send("\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));
  });
  app.get("/api/admin/audit.json", admin, (_req, res) =>
    res
      .attachment("audit.json")
      .json(db.prepare("SELECT * FROM audit ORDER BY id").all()),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error:
          "输入内容有误：" +
          error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("；"),
      });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "JSON 格式不正确" });
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : "服务暂时不可用，请稍后重试",
    });
  });
  return {
    app,
    db,
    snapshot,
    tokenFor,
    close: () => {
      clearInterval(heartbeat);
      for (const res of streams) res.end();
      db.close();
    },
  };
}
