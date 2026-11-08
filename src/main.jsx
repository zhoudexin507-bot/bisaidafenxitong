import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileCheck2,
  Flag,
  Image as ImageIcon,
  LayoutDashboard,
  ListOrdered,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  Pause,
  Play,
  Plus,
  Printer,
  QrCode,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  Users,
  X,
} from "lucide-react";
import { resultPages, resultViews } from "../shared/slides.js";
import "./styles.css";
import "./stages.css";
import { LiveDesk, StageControls, StageCover } from "./live-desk.jsx";
import { applyTheme, readTheme, THEMES } from "./theme.js";
import "./themes.css";
import { LayoutPreview, ProjectionBoard } from "./projection.jsx";

const statusNames = {
  draft: "筹备中",
  running: "比赛进行中",
  paused: "比赛已暂停",
  final: "比赛已结束",
  pending: "待开始",
  ready: "准备评分",
  open: "评分中",
  closed: "已封存",
};
const fmt = (value) => (value == null ? "—" : Number(value).toFixed(2));
const date = (value) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
const time = (value) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
let judgeToken = "";
if (location.pathname === "/judge") {
  judgeToken = location.hash.slice(1);
  try {
    if (judgeToken) {
      sessionStorage.setItem("jh_judge", judgeToken);
      history.replaceState(null, "", "/judge");
    } else {
      judgeToken = sessionStorage.getItem("jh_judge") || "";
    }
  } catch {
    // Keep the scanned link usable when the browser blocks session storage.
  }
}

async function api(path, method = "GET", body, signal) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(path.startsWith("/judge")
        ? { Authorization: `Bearer ${judgeToken}` }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "请求失败，请重试");
    error.status = response.status;
    throw error;
  }
  return value;
}

function useLive(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const refreshRef = useRef(null);
  useEffect(() => {
    let alive = true;
    let timer;
    let controller;
    let pending = Promise.resolve();
    let queued;
    function refresh() {
      if (queued) return queued;
      queued = pending.then(async () => {
        queued = null;
        if (!alive) return;
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const next = await api(path, "GET", undefined, controller.signal);
          if (alive) {
            setData(next);
            setError(null);
          }
        } catch (e) {
          if (alive) {
            setError(e.name === "AbortError" ? new Error("连接超时，正在重试") : e);
            if (e.status === 401 || e.status === 403) setData(null);
          }
        } finally {
          clearTimeout(timeout);
        }
      });
      pending = queued;
      return queued;
    }
    refreshRef.current = refresh;
    const update = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (alive) refresh();
      }, 80);
    };
    refresh();
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener("update", update);
    const poll = setInterval(refresh, 15000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      alive = false;
      refreshRef.current = null;
      controller?.abort();
      events.close();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [path]);
  return { data, error, connected: connected && !error, refresh: () => refreshRef.current?.() };
}

function Button({ children, icon: Icon, kind = "", ...props }) {
  return (
    <button className={`button ${kind}`} {...props}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
function Badge({ status, children }) {
  return (
    <span className={`badge ${status || ""}`}>
      <span className="status-dot" />
      {children || statusNames[status]}
    </span>
  );
}
function Empty({ title, children }) {
  return (
    <div className="empty">
      <ClipboardList size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
function ErrorBox({ error }) {
  return (
    error && (
      <div className="error" role="alert">
        {error.message || error}
      </div>
    )
  );
}
function PageTitle({ title, children }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Connection({ connected }) {
  return (
    <span className={`connection ${connected ? "" : "offline"}`}>
      <span className="status-dot" />
      {connected ? "实时连接正常" : "连接恢复中 · 自动重试"}
    </span>
  );
}

const navigation = [
  { label: "比赛控制台", path: "/admin", icon: LayoutDashboard },
  { label: "成绩排名", path: "/admin/ranking", icon: Trophy },
  { label: "大屏控制", path: "/admin/display", icon: Monitor },
  { label: "项目管理", path: "/admin/projects", icon: ClipboardList },
  { label: "评委与二维码", path: "/admin/judges", icon: Users },
  { label: "赛事设置", path: "/admin/rules", icon: Settings2 },
  { label: "奖项设置", path: "/admin/awards", icon: Award },
  { label: "操作记录", path: "/admin/logs", icon: FileCheck2 },
];
function ThemeSwitch() {
  const [theme, setTheme] = useState(readTheme);
  return (
    <div className="theme-switch" role="group" aria-label="配色主题">
      {THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          className="theme-option"
          aria-pressed={theme === option.id}
          title={option.hint}
          onClick={() => setTheme(applyTheme(option.id))}
        >
          <span
            className={`swatch swatch-${option.id}`}
            aria-hidden="true"
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}
function Shell({ children, data, connected, adminMode }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <a href="/admin" className="brand">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <span>竞衡</span>
        </a>
        <nav aria-label="赛事管理">
          {navigation.map((n, i) => (
            <a
              key={n.path}
              className={`${location.pathname === n.path || (location.pathname === "/admin" && i === 0) ? "active" : ""} ${i === 2 ? "nav-divider" : ""}`}
              href={n.path}
              aria-current={location.pathname === n.path ? "page" : undefined}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {location.pathname === n.path && <ChevronRight size={15} />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ThemeSwitch />
          <a className="account" href="/admin">
            <span className="avatar">
              <Users size={17} />
            </span>
            <span>
              {adminMode ? "赛事管理员" : "管理员登录"}
            </span>
            <ChevronRight size={16} />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="展开导航"
              aria-expanded={menu}
            >
              <Menu size={20} />
            </button>
            <Flag size={16} />
            <span>{data?.settings.title || "竞衡比赛评分系统"}</span>
            {data?.settings.demo && (
              <span className="demo-label">演示赛事</span>
            )}
          </div>
          <div className="topbar-right">
            <Connection connected={connected} />
            <a
              className="screen-link"
              href={adminMode ? "/admin/present" : "/screen"}
              target="_blank"
              rel="noreferrer"
            >
              <Monitor size={16} /> {adminMode ? "投屏演示" : "大屏展示"}{" "}
              <ExternalLink size={13} />
            </a>
            {adminMode && (
              <button
                className="icon-button"
                aria-label="退出登录"
                title="退出登录"
                onClick={async () => {
                  await api("/logout", "POST", {});
                  location.href = "/";
                }}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function scoreSignature(project, data) {
  return `${data.settings.epoch}:${data.settings.mode}:${data.settings.currentRound}:${project.id}:${project.result.complete ? project.scores.map((s) => `${s.judge_id}:${s.total}:${s.submitted_at}`).join("|") : "waiting"}`;
}

function ScorePanel({ project, data, onRevealChange }) {
  const complete = project.result.complete && project.released !== false;
  const awaitingReveal = project.result.awaitingReveal || (project.result.complete && !complete);
  const ready = ["pending", "ready"].includes(project.status);
  const signature = scoreSignature(project, data);
  const [animation, setAnimation] = useState({ key: "", step: 0 });
  const step = animation.key === signature ? animation.step : 0;
  const trims = complete && project.result.dropped.length > 0;
  const count = data.judges.length;
  const rows = count <= 5 ? 1 : count <= 12 ? 2 : Math.max(3, Math.ceil(count / 10));
  const columns = Math.max(1, Math.ceil(count / rows));
  const scoresByJudge = new Map(project.scores.map((score) => [score.judge_id, score]));
  useEffect(() => {
    setAnimation({ key: signature, step: 0 });
    if (!complete) return;
    const times = trims
      ? [
          [1500, 1],
          [3100, 2],
          [4300, 3],
        ]
      : [[1700, 3]];
    const timers = times.map(([delay, step]) =>
      setTimeout(() => setAnimation({ key: signature, step }), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [signature, complete, trims]);
  useEffect(() => {
    onRevealChange?.({ signature, ready: complete && step === 3 });
  }, [signature, complete, step, onRevealChange]);
  const phase = complete
    ? step === 3
      ? "评分结果"
      : step === 2
        ? "剔除极值"
        : step === 1
          ? "标记最高 / 最低分"
          : "全部亮分"
    : awaitingReveal
      ? "评分已收齐 · 等待公布"
    : ready
      ? "准备评分"
      : data.settings.status === "paused"
        ? "评分暂停"
        : "评委评分中";
  return (
    <section
      className={`score-panel stage-score ${count >= 13 ? "many-judges" : ""} ${complete ? "revealed" : "concealed"} reveal-step-${step}`}
      style={{ "--judge-cols": columns, "--judge-rows": rows, "--compact-cols": Math.min(columns, 8) }}
      data-reveal-step={complete ? step : "waiting"}
    >
      <div className="score-panel-top">
        <div className="current-info">
          <div className="inline-meta">
            <Badge status={complete ? "closed" : ready ? "ready" : "open"}>
              {phase}
            </Badge>
          </div>
          <h2>
            {data.settings.showTeamNumber !== false && (
              <span className="team-prefix">{String(project.position).padStart(2, "0")}</span>
            )}
            {project.team}
          </h2>
        </div>
        <div className="featured-score" aria-live="polite">
          <span>
            {complete
              ? step === 3
                ? data.settings.rounds > 1
                  ? "本轮得分"
                  : "最终得分"
                : ""
              : ready
                ? "请评委准备"
                : "已提交"}
          </span>
          {complete ? (
            step === 3 ? (
              <strong className="final-score" key={signature}>
                {fmt(project.result.average)}
                <small>分</small>
              </strong>
            ) : (
              <strong className="reveal-pending">—</strong>
            )
          ) : ready ? (
            <strong className="unrevealed-score" aria-label="分数未知">
              —
            </strong>
          ) : (
            <strong className="submission-count">
              {project.scores.length}
              <small>/ {data.judges.length}</small>
            </strong>
          )}
        </div>
      </div>
      {!complete && (
        <div className="score-progress" aria-hidden="true">
          {data.judges.map((judge) => <i key={judge.id} className={scoresByJudge.has(judge.id) ? "filled" : ""} />)}
        </div>
      )}
      <div className="judge-scores">
        {data.judges.map((j, i) => {
          const score = scoresByJudge.get(j.id),
            low = project.result.droppedLow?.includes(j.id),
            high = project.result.droppedHigh?.includes(j.id),
            drop = low || high;
          return (
            <div
              key={j.id}
              className={`judge-score ${score ? "submitted" : ""} ${complete && step >= 1 && drop ? "extreme" : ""} ${complete && step >= 2 && drop ? "excluded" : ""}`}
            >
              <div className="judge-seat">
                <span>评委</span>{" "}
                <b>{String(j.number || i + 1).padStart(2, "0")}</b>
              </div>
              {complete ? (
                <>
                  <strong className="judge-value" style={{ "--delay": Math.min(i * 40, 1160) + "ms" }}>{fmt(score?.total / 100)}</strong>
                  {step >= 1 && drop && (
                    <small>{high ? "最高分" : "最低分"}{step >= 2 && "已剔除"}</small>
                  )}
                </>
              ) : (
                <strong className="submission-state">
                  {score ? (
                    <>
                      <CheckCircle2 size={22} />
                      已打分
                    </>
                  ) : (
                    <>
                      <Clock3 size={22} />
                      {ready ? "待开始" : "未打分"}
                    </>
                  )}
                </strong>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProjectTable({ data, compact = false }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const filtered = data.projects.filter(
    (p) =>
      `${p.name} ${p.team}`.includes(query) &&
      (filter === "all" ||
        (filter === "done" ? p.result.complete : p.status === filter)),
  );
  return (
    <section className="panel">
      <div className="section-head">
        <h2>
          项目评分进度 <span className="count">{data.projects.length}</span>
        </h2>
        <label className="search">
          <Search size={15} />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目或参赛单位"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="tabs" role="group" aria-label="筛选项目">
        {[
          ["all", "全部项目"],
          ["open", "评分中"],
          ["done", "已完成"],
          ["pending", "待开始"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "selected" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="number-col">序号</th>
              <th>参赛项目</th>
              <th>评分进度</th>
              <th>状态</th>
              <th className="align-right">{compact ? "得分" : "项目得分"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <React.Fragment key={p.id}>
                <tr>
                  <td className="muted numeric">
                    {String(p.position).padStart(2, "0")}
                  </td>
                  <td>
                    <strong>{p.name}</strong>
                    <small className="table-sub">{p.team}</small>
                  </td>
                  <td>
                    <div className="progress-info">
                      <span className="numeric">
                        {p.scores.length}
                        <span className="muted"> / {data.judges.length}</span>
                      </span>
                      <div className="progress">
                        <span
                          style={{
                            width: `${data.judges.length ? (p.scores.length / data.judges.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge status={p.status} />
                  </td>
                  <td
                    className={`table-score align-right ${p.result.complete ? "complete-score" : ""}`}
                  >
                    {p.result.complete ? fmt(p.result.average) : "—"}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`查看${p.name}评分明细`}
                      onClick={() =>
                        setExpanded(expanded === p.id ? null : p.id)
                      }
                    >
                      <ChevronRight
                        className={expanded === p.id ? "rotate" : ""}
                        size={17}
                      />
                    </button>
                  </td>
                </tr>
                {expanded === p.id && (
                  <tr className="detail-row">
                    <td colSpan="6">
                      <div className="score-detail">
                        {data.judges.map((j) => {
                          const s = p.scores.find((x) => x.judge_id === j.id);
                          return (
                            <div key={j.id}>
                              <strong>
                                评委{" "}
                                {String(data.judges.indexOf(j) + 1).padStart(
                                  2,
                                  "0",
                                )}
                              </strong>
                              <span>
                                {s
                                  ? p.result.complete
                                    ? fmt(s.total / 100)
                                    : "已打分"
                                  : "未打分"}
                                {p.result.dropped.includes(j.id)
                                  ? "（已剔除）"
                                  : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <Empty title="暂无匹配项目">
          试试其他搜索词，或由管理员添加参赛项目。
        </Empty>
      )}
    </section>
  );
}

function Overview({ data, act }) {
  const active = data.projects.find((p) =>
    ["ready", "open"].includes(p.status),
  );
  const current =
    active ||
    data.projects.find((p) => p.status === "pending") ||
    data.projects.at(-1);
  const final = data.settings.status === "final",
    draft = data.settings.status === "draft";
  const update = (status) =>
    act(`/admin/projects/${current.id}/status`, "POST", { status });
  return (
    <>
      <PageTitle title="比赛控制台">
        <Badge status={data.settings.status} />
        <a
          className="button primary"
          href="/admin/present"
          target="_blank"
          rel="noreferrer"
        >
          <Monitor size={16} />
          开始投屏演示
        </a>
      </PageTitle>
      <nav className="core-links" aria-label="核心管理">
        <a href="/admin/projects">
          <ClipboardList size={20} />
          项目与重评
        </a>
        <a href="/admin/judges">
          <QrCode size={20} />
          评委二维码
        </a>
        <a href="/admin/rules">
          <Settings2 size={20} />
          赛事设置
        </a>
        <a href="/admin/awards">
          <Award size={20} />
          奖项设置
        </a>
      </nav>
      <section className="operator-panel">
        <div className="operator-heading">
          <h2>{final ? "比赛已结束" : draft ? "赛前准备" : "现场控制"}</h2>
          <span>
            {data.projects.filter((p) => p.status === "closed").length} /{" "}
            {data.projects.length} 队已封存
          </span>
        </div>
        <CompetitionControls data={data} act={act} />
        {final ? (
          <div className="operator-actions">
            <a className="button primary" href="/admin/display">
              展示排名与颁奖
            </a>
            <a className="button" href="/api/admin/export.csv">
              导出成绩
            </a>
          </div>
        ) : draft ? (
          <div className="operator-actions">
            <a className="button" href="/admin/rules">
              配置比赛
            </a>
            <a className="button" href="/admin/print">
              打印评委二维码
            </a>
          </div>
        ) : current ? (
          <div className="current-operation">
            <div>
              <h3>
                <span>{String(current.position).padStart(2, "0")}</span>
                {current.team}
              </h3>
              <p>
                {current.name} · 已提交 {current.scores.length} /{" "}
                {data.judges.length}
              </p>
            </div>
            <div className="operator-actions">
              {current.status === "pending" && (
                <Button kind="primary" onClick={() => update("ready")}>
                  准备评分
                </Button>
              )}
              {current.status === "ready" && (
                <Button
                  kind="primary"
                  disabled={data.settings.status !== "running"}
                  onClick={() => update("open")}
                >
                  开始评分
                </Button>
              )}
              {current.status === "open" && current.result.complete && current.released === false && (
                <Button kind="primary" onClick={() => act("/admin/reveal", "POST", { projectId: current.id, releaseKey: current.releaseKey })}>公布本队成绩</Button>
              )}
              {current.status === "open" && (
                <Button
                  kind="primary"
                  disabled={!current.result.complete || current.released === false}
                  onClick={() => update("closed")}
                >
                  {current.result.complete ? "封存成绩" : "等待评委提交"}
                </Button>
              )}
              {["open", "closed"].includes(current.status) && (
                <a
                  className="button"
                  href={`/admin/projects?rejudge=${current.id}`}
                >
                  重新评分
                </a>
              )}
              <a className="button" href="/admin/display">
                切换展示
              </a>
            </div>
          </div>
        ) : (
          <a className="button primary" href="/admin/rules">
            设置项目与评委
          </a>
        )}
      </section>
      <LiveDesk data={data} act={act} />
      <div className="overview-projects">
        <ProjectTable data={data} />
      </div>
    </>
  );
}

function CompetitionControls({ data, act }) {
  const s = data.settings;
  return (
    <div className="control-bar">
      <span>
        <Flag size={17} />
        {s.mode === "test"
          ? "测试评分"
          : s.rounds > 1
            ? `正式比赛 · 第 ${s.currentRound} / ${s.rounds} 轮`
            : "正式比赛"}
      </span>
      <div className="actions">
        {s.status === "draft" && (
          <>
            <Button
              kind={!s.testCompleted ? "primary" : ""}
              onClick={() => act("/admin/test/start", "POST", {})}
            >
              {s.testCompleted ? "重新测试" : "开始测试评分"}
            </Button>
            <Button
              kind="primary"
              disabled={!s.testCompleted}
              onClick={() =>
                act("/admin/status", "POST", { status: "running" })
              }
            >
              开始正式比赛
            </Button>
          </>
        )}
        {s.status === "running" && (
          <Button
            onClick={() => act("/admin/status", "POST", { status: "paused" })}
          >
            暂停评分
          </Button>
        )}
        {s.status === "paused" && (
          <Button
            onClick={() => act("/admin/status", "POST", { status: "running" })}
          >
            继续评分
          </Button>
        )}
        {s.mode === "test" && (
          <Button
            kind="primary"
            onClick={() => act("/admin/test/finish", "POST", {})}
          >
            完成测试
          </Button>
        )}
        {s.mode === "official" &&
          ["running", "paused"].includes(s.status) &&
          (s.currentRound < s.rounds ? (
            <Button
              kind="primary"
              disabled={data.projects.some(
                (p) => !p.result.complete || p.status !== "closed",
              )}
              onClick={() => act("/admin/round/next", "POST", {})}
            >
              进入第 {s.currentRound + 1} 轮
            </Button>
          ) : (
            <Button
              kind="primary"
              disabled={data.projects.some(
                (p) => !p.result.complete || p.status !== "closed",
              )}
              onClick={() => {
                if (confirm("发布后成绩与奖项将锁定，确认发布？"))
                  act("/admin/status", "POST", { status: "final" });
              }}
            >
              发布最终成绩
            </Button>
          ))}
      </div>
    </div>
  );
}

const displayViews = [
  ["ranking", "得分排名"],
  ["teamAwards", "团体奖项"],
  ["individualAwards", "个人奖项"],
];
const prizeNames = ["", "一等奖", "二等奖", "三等奖"];

function ResultsView({ data, view }) {
  if (view === "ranking") {
    const teams = data.ranking;
    if (!teams.length) return <Empty title="等待评分完成" />;
    return (
      <ol aria-label="比赛得分排名" className={`standings ${teams.length < 4 ? "standings-short" : ""}`}>
        {teams.map((team, i) => (
          <li key={team.id} className={`standing-row place-${team.rank}`}
            style={{ "--delay": (teams.length - i - 1) * 70 + "ms" }}>
            <span className="rank-num" aria-label={`第 ${team.rank} 名`}>{team.rank}</span>
            <strong className="standing-team">{team.team}</strong>
            {team.prize > 0 && <span className={`prize-label medal-${team.prize}`}>{prizeNames[team.prize]}</span>}
            <strong className="standing-score">{team.result.complete ? fmt(team.result.average) : "—"}</strong>
          </li>
        ))}
      </ol>
    );
  }
  if (view === "teamAwards") {
    if (!data.ranking.some((p) => p.prize)) return <Empty title="暂无团体奖项" />;
    return (
      <div className="team-honors">
        {[3, 2, 1].map((level) => {
          const teams = data.ranking.filter((p) => p.prize === level);
          if (!teams.length) return null;
          return (
            <section key={level} className={`team-honor medal-${level}`}>
              <h2 className="honor-heading">{prizeNames[level]}</h2>
              <div className="honor-grid" style={{ "--columns": Math.min(teams.length, 4) }}>
                {teams.map((p, i) => (
                  <article className="honor-winner" key={p.id} style={{ "--index": i }}>
                    <h3>{p.team}</h3>
                    <p className="winner-members">{p.members || "名单待录入"}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }
  if (!data.awards.length) return <Empty title="暂无个人奖项" />;
  return (
    <div className="personal-honors honor-grid medal-1" style={{ "--columns": Math.min(data.awards.length, 3) }}>
      {data.awards.map((award, i) => (
        <section className="personal-honor" key={award.id} style={{ "--index": i }}>
          <h2 className="personal-award-title">{award.name}</h2>
          <h3>{award.recipient}</h3>
        </section>
      ))}
    </div>
  );
}

function Ranking({ data, act }) {
  const [order, setOrder] = useState("");
  const [reason, setReason] = useState("");
  const [view, setView] = useState("ranking");
  return (
    <>
      <PageTitle title="比赛成绩">
        <Badge status={data.settings.status === "final" ? "closed" : "open"}>
          {data.settings.status === "final" ? "最终成绩" : "未发布"}
        </Badge>
        <Button icon={Printer} onClick={() => print()}>
          打印
        </Button>
      </PageTitle>
      <div className="result-tabs" role="group" aria-label="成绩展示">
        {displayViews.map(([id, label]) => (
          <Button
            key={id}
            kind={id === view ? "primary" : ""}
            onClick={() => setView(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {data.settings.status !== "final" &&
        data.ranking.some((p) => p.tieUnresolved) && (
          <section className="panel settings-section">
            <h2>同分顺序确认</h2>
            <p>
              请输入全部项目序号，按同分优先顺序排列；不同分数仍按得分排名。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const positions = order
                  .trim()
                  .split(/[，,\s]+/)
                  .map(Number);
                act("/admin/tiebreak", "POST", {
                  projectIds: positions.map(
                    (n) =>
                      data.projects.find((p) => p.position === n)?.id || "",
                  ),
                  reason,
                });
              }}
            >
              <Field label="项目序号顺序">
                <input
                  required
                  placeholder={data.ranking.map((p) => p.position).join(", ")}
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                />
              </Field>
              <Field label="裁定依据">
                <input
                  required
                  maxLength={100}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button kind="primary">确认同分顺序</Button>
            </form>
          </section>
        )}
      <ResultsView data={data} view={view} />
    </>
  );
}
function ScreenPreview({ children }) {
  const wrap = useRef(null);
  const frame = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Fit a 16:9 stage inside whatever space the layout grants the preview.
      const w = Math.max(0, Math.min(width, (height * 16) / 9));
      frame.current.style.width = `${w}px`;
      frame.current.style.height = `${(w * 9) / 16}px`;
      frame.current.style.setProperty("--preview-scale", w / 1920);
    });
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={wrap} className="preview-fit">
      <div ref={frame} className="screen-preview">
        {children ? <div className="projection-preview-canvas">{children}</div>
          : <iframe src="/screen" title="当前大屏只读预览" tabIndex={-1} />}
      </div>
    </div>
  );
}

const backgroundKinds = [
  ["home", "背景首页"],
  ["awards", "排名与颁奖"],
];

function BackgroundSettings({ data, refresh, act }) {
  const [busy, setBusy] = useState(null);
  const [pendingTitle, setPendingTitle] = useState(null);
  const [error, setError] = useState(null);
  const backgrounds = data.backgrounds || {};
  async function send(kind, method, file) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/admin/backgrounds/${kind}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": file ? file.type : "application/json" },
        body: file || "{}",
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(value.error || "操作失败，请重试");
      await refresh?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel display-control background-settings">
      <h2>背景图片</h2>
      <p className="table-sub">
        建议使用 16:9 图片，每张不超过 10 MB。排名、团体奖和个人奖共用一张颁奖背景图。
      </p>
      {backgroundKinds.map(([kind, label]) => {
        const version = backgrounds[kind];
        return (
          <div className="background-row" key={kind}>
            <span
              className={`background-thumb ${version ? "is-set" : ""}`}
              role="img"
              aria-label={`${label}背景${version ? "已设置" : "未设置"}`}
              style={version ? { backgroundImage: `url("/api/backgrounds/${kind}?v=${version}")` } : undefined}
            >
              {!version && <ImageIcon size={18} />}
            </span>
            <div className="background-info">
              <strong>{label}</strong>
              <span>{version ? "已设置" : "未设置"}</span>
            </div>
            <div className="actions">
              <label className={`button ${busy === kind ? "is-busy" : ""}`}>
                <Upload size={15} />
                {version ? "更换图片" : "上传图片"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) {
                      setError(new Error("图片不能超过 10 MB"));
                      return;
                    }
                    send(kind, "PUT", file);
                  }}
                />
              </label>
              {version && (
                <Button
                  kind="danger-text"
                  disabled={busy === kind}
                  onClick={() => send(kind, "DELETE")}
                >
                  清除
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <label className="home-title-toggle"><input type="checkbox" disabled={pendingTitle !== null}
        checked={pendingTitle ?? (data.settings.showHomeTitle !== false)}
        onChange={async e => {
          const showHomeTitle = e.target.checked;
          setPendingTitle(showHomeTitle);
          try { await act("/admin/display-options", "PUT", { showHomeTitle }); }
          catch (reason) { setError(reason); }
          finally { setPendingTitle(null); }
        }} />
        背景首页显示系统标题和副标题</label>
      <ErrorBox error={error} />
    </section>
  );
}

function PresentationControls({ data, act, refresh }) {
  const [editing, setEditing] = useState(false);
  const presentation = data.settings.presentation;
  const current =
    data.projects.find((p) => p.id === presentation.projectId) ||
    data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
    data.projects[0];
  const final = data.settings.status === "final";
  const view = presentation.view;
  const stages = resultViews(data);
  const nextView = stages[stages.indexOf(view) + 1];
  return (
    <div className="display-page">
      <PageTitle title="大屏控制">
        <a
          className="button primary"
          href="/admin/present"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} />
          开始投屏演示
        </a>
      </PageTitle>
      <div className="display-layout">
        <div className="display-controls">
          <CompetitionControls data={data} act={act} />
          <StageControls data={data} act={act} />
          {!final && (
            <section className="panel display-control">
              <h2 className="display-section-title">大屏内容</h2>
              <Field label="当前展示队伍">
                <select
                  value={current?.id || ""}
                  onChange={(e) =>
                    act("/admin/presentation", "POST", {
                      view: "project",
                      projectId: e.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    请选择队伍
                  </option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.position).padStart(2, "0")} · {p.team} · {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              {current && (
                <div className="actions">
                  <Button
                    disabled={
                      data.settings.status === "draft" || current.scores.length > 0
                    }
                    onClick={() =>
                      act(`/admin/projects/${current.id}/status`, "POST", {
                        status: "ready",
                      })
                    }
                  >
                    准备评分
                  </Button>
                  <Button
                    kind="primary"
                    icon={Play}
                    disabled={
                      data.settings.status !== "running" ||
                      current.status === "open" ||
                      current.status === "closed"
                    }
                    onClick={() =>
                      act(`/admin/projects/${current.id}/status`, "POST", {
                        status: "open",
                      })
                    }
                  >
                    开始评分
                  </Button>
                  <Button
                    icon={LockKeyhole}
                    disabled={
                      !current.result.complete || current.released === false || current.status === "closed"
                    }
                    onClick={() =>
                      act(`/admin/projects/${current.id}/status`, "POST", {
                        status: "closed",
                      })
                    }
                  >
                    封存成绩
                  </Button>
                  {current.result.complete && current.released === false && <Button kind="primary" onClick={() => act("/admin/reveal", "POST", { projectId: current.id, releaseKey: current.releaseKey })}>公布本队成绩</Button>}
                  <a className="button" href="/admin/projects">
                    重新评分
                  </a>
                </div>
              )}
            </section>
          )}
            <section className="panel display-control">
              <h2 className="display-section-title">排名与颁奖投屏</h2>
              {!final && <p className="table-sub">发布最终成绩后可切换现场画面。赛前可在排版预览中调整文字。</p>}
              <div className="result-tabs">
                {displayViews.map(([id, label]) => (
                  <Button
                    key={id}
                    disabled={!final}
                    kind={id === view && data.settings.stage.scene === "live" ? "primary" : ""}
                    onClick={() => act("/admin/presentation", "POST", { view: id })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {final && nextView && (
                <Button
                  kind="primary"
                  icon={ArrowRight}
                  onClick={() =>
                    act("/admin/presentation", "POST", {
                      view: nextView,
                    })
                  }
                >
                  下一步：{displayViews.find(([id]) => id === nextView)?.[1]}
                </Button>
              )}
            </section>
          <BackgroundSettings data={data} refresh={refresh} act={act} />
        </div>
        <div className="display-preview">
          <div className="preview-heading">
            <h2>{editing ? "排版预览" : "当前大屏"}</h2>
            <div className="preview-tools">
              <Button aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? "返回现场预览" : "排版预览"}</Button>
              <a href="/screen" target="_blank" rel="noreferrer">
                只读大屏
              </a>
              <label>
                <input type="checkbox" checked={data.settings.showTeamNumber !== false}
                  onChange={(e) => act("/admin/display-options", "PUT", { showTeamNumber: e.target.checked })} />
                显示队伍序号
              </label>
            </div>
          </div>
          {editing ? <LayoutPreview data={data} act={act} ScreenPreview={ScreenPreview} ResultsView={ResultsView} /> : <ScreenPreview />}
        </div>
      </div>
    </div>
  );
}

function Login({ refresh, presenter = false }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <form
        className="login-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/login", "POST", { password });
            refresh();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="login-symbol">
          <ShieldCheck size={32} />
        </span>
        <h1>{presenter ? "进入投屏演示" : "进入赛事工作台"}</h1>

        <Field label="管理员密码">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入管理员密码"
            autoFocus
          />
        </Field>
        <ErrorBox error={error} />
        <Button kind="primary full-width" disabled={busy} icon={ArrowRight}>
          {busy ? "正在登录…" : presenter ? "进入演示" : "登录工作台"}
        </Button>
        <a className="back-link" href="/">
          <ArrowLeft size={14} /> 返回现场大屏
        </a>
      </form>
    </div>
  );
}

function ProjectManager({ data, act }) {
  const [edit, setEdit] = useState(null);
  const [rejudge, setRejudge] = useState(() => {
    const id = new URLSearchParams(location.search).get("rejudge");
    return data.projects.some(
      (p) => p.id === id && ["open", "closed"].includes(p.status),
    ) && data.settings.status !== "final"
      ? { projectId: id, judgeIds: [], reason: "" }
      : null;
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const draft = data.settings.status === "draft";
  const final = data.settings.status === "final";
  return (
    <>
      <PageTitle title="项目管理">
        {draft && (
          <Button
            kind="primary"
            icon={Plus}
            onClick={() => {
              setError(null);
              setEdit({
                name: "",
                team: "",
                members: "",
                description: "",
                position: data.projects.length + 1,
              });
            }}
          >
            添加项目
          </Button>
        )}
        <a className="button" href="/admin/display">
          大屏控制
        </a>
      </PageTitle>
      <CompetitionControls data={data} act={act} />
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>顺序</th>
                <th>队伍 / 项目</th>
                <th>状态</th>
                <th>已打分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.position}</td>
                  <td>
                    <strong>{p.team}</strong>
                    <small className="table-sub">{p.name}</small>
                  </td>
                  <td>
                    <Badge status={p.result.complete ? "closed" : p.status}>
                      {p.result.complete
                        ? p.status === "closed"
                          ? "已封存"
                          : "已亮分"
                        : statusNames[p.status]}
                    </Badge>
                  </td>
                  <td>
                    {p.scores.length} / {data.judges.length}
                  </td>
                  <td>
                    <div className="actions">
                      {draft ? (
                        <>
                          <Button
                            onClick={() => {
                              setError(null);
                              setEdit(p);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            kind="danger-text"
                            onClick={() => {
                              if (confirm(`删除“${p.name}”？`))
                                act(`/admin/projects/${p.id}`, "DELETE", {});
                            }}
                          >
                            删除
                          </Button>
                        </>
                      ) : (
                        !final && (
                          <>
                            {["pending", "ready"].includes(p.status) && (
                              <>
                                <Button
                                  onClick={() =>
                                    act(
                                      `/admin/projects/${p.id}/status`,
                                      "POST",
                                      { status: "ready" },
                                    )
                                  }
                                >
                                  准备评分
                                </Button>
                                <Button
                                  kind="primary"
                                  disabled={data.settings.status !== "running"}
                                  onClick={() =>
                                    act(
                                      `/admin/projects/${p.id}/status`,
                                      "POST",
                                      { status: "open" },
                                    )
                                  }
                                >
                                  开始评分
                                </Button>
                              </>
                            )}
                            {p.status === "open" && p.result.complete && (
                              <Button
                                icon={LockKeyhole}
                                onClick={() =>
                                  act(
                                    `/admin/projects/${p.id}/status`,
                                    "POST",
                                    { status: "closed" },
                                  )
                                }
                              >
                                封存成绩
                              </Button>
                            )}
                            {["open", "closed"].includes(p.status) && (
                              <Button
                                icon={RotateCw}
                                onClick={() => {
                                  setError(null);
                                  setRejudge({
                                    projectId: p.id,
                                    judgeIds: [],
                                    reason: "",
                                  });
                                }}
                              >
                                重新评分
                              </Button>
                            )}
                            <Button
                              icon={Monitor}
                              onClick={() =>
                                act("/admin/presentation", "POST", {
                                  view: "project",
                                  projectId: p.id,
                                })
                              }
                            >
                              投屏
                            </Button>
                          </>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.projects.length && <Empty title="暂无参赛项目" />}
      </section>
      {edit && (
        <Modal
          title={edit.id ? "编辑项目" : "添加项目"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await act(
                  `/admin/projects${edit.id ? "/" + edit.id : ""}`,
                  edit.id ? "PUT" : "POST",
                  {
                    name: edit.name,
                    team: edit.team,
                    members: edit.members || "",
                    description: edit.description,
                    position: Number(edit.position),
                  },
                );
                setEdit(null);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="队伍名称">
              <input
                required
                maxLength={100}
                value={edit.team}
                onChange={(e) => setEdit({ ...edit, team: e.target.value })}
              />
            </Field>
            <Field label="项目名称">
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="队员名单">
              <textarea
                maxLength={2000}
                placeholder="用顿号或换行分隔"
                value={edit.members || ""}
                onChange={(e) => setEdit({ ...edit, members: e.target.value })}
              />
            </Field>
            <Field label="出场顺序">
              <input
                type="number"
                min="1"
                max="1000"
                required
                value={edit.position}
                onChange={(e) => setEdit({ ...edit, position: e.target.value })}
              />
            </Field>
            <Field label="项目说明">
              <textarea
                maxLength={500}
                value={edit.description}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </Field>
            <ErrorBox error={error} />
            <Button kind="primary full-width" disabled={busy}>
              保存项目
            </Button>
          </form>
        </Modal>
      )}
      {rejudge && (
        <Modal title="重新评分" onClose={() => setRejudge(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !confirm(
                  `确认让 ${rejudge.judgeIds.length} 位评委重评？本队分数将隐藏，收齐后重新亮分。`,
                )
              )
                return;
              setBusy(true);
              setError(null);
              try {
                await act("/admin/scores/rejudge", "POST", rejudge);
                setRejudge(null);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="rejudge-head">
              <h3>
                {data.projects.find((p) => p.id === rejudge.projectId)?.team}
              </h3>
              <Button
                type="button"
                onClick={() =>
                  setRejudge({
                    ...rejudge,
                    judgeIds:
                      rejudge.judgeIds.length === data.judges.length
                        ? []
                        : data.judges.map((j) => j.id),
                  })
                }
              >
                {rejudge.judgeIds.length === data.judges.length
                  ? "取消全选"
                  : "全部评委"}
              </Button>
            </div>
            <div className="rejudge-list">
              {data.judges.map((j) => (
                <label key={j.id}>
                  <input
                    type="checkbox"
                    checked={rejudge.judgeIds.includes(j.id)}
                    onChange={(e) =>
                      setRejudge({
                        ...rejudge,
                        judgeIds: e.target.checked
                          ? [...rejudge.judgeIds, j.id]
                          : rejudge.judgeIds.filter((id) => id !== j.id),
                      })
                    }
                  />
                  <span>
                    评委 {String(data.judges.indexOf(j) + 1).padStart(2, "0")}
                  </span>
                  <small>
                    {data.projects
                      .find((p) => p.id === rejudge.projectId)
                      ?.scores.some((s) => s.judge_id === j.id)
                      ? "已打分"
                      : "未打分"}
                  </small>
                </label>
              ))}
            </div>
            <Field label="重评原因（选填）">
              <input
                maxLength={500}
                value={rejudge.reason}
                onChange={(e) =>
                  setRejudge({ ...rejudge, reason: e.target.value })
                }
                placeholder="如：分数录入有误"
              />
            </Field>
            <ErrorBox error={error} />
            <Button
              kind="primary full-width"
              disabled={busy || !rejudge.judgeIds.length}
            >
              确认重评（{rejudge.judgeIds.length} 人）
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

function JudgeManager({ data, act }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const draft = data.settings.status === "draft";
  return (
    <>
      <PageTitle title="评委与专属二维码">
        <a
          className="button"
          href="/admin/test-qr"
          target="_blank"
          rel="noreferrer"
        >
          <QrCode size={16} />
          测试压测二维码
        </a>
        <Button
          icon={Clock3}
          onClick={() => {
            if (
              confirm(
                `为全部 ${data.judges.length} 位评委的二维码统一续期 7 天？\n二维码本身不变，评委无需重新扫码。`,
              )
            )
              act("/admin/judges/renew-all", "POST", { days: 7 });
          }}
        >
          全部续期
        </Button>
        <a
          className="button"
          href="/admin/print"
          target="_blank"
          rel="noreferrer"
        >
          <Printer size={16} />
          批量打印
        </a>
        {draft && (
          <Button
            kind="primary"
            icon={Plus}
            onClick={() => {
              setError(null);
              setEdit({ name: "", title: "" });
            }}
          >
            添加评委
          </Button>
        )}
      </PageTitle>
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          当前 <b>{data.judges.length}</b> 位评委 · 二维码默认有效期 7 天 ·
          二维码请分别发放
        </span>
      </div>
      <div className="judge-grid">
        {data.judges.map((j, i) => (
          <section className="judge-card" key={j.id}>
            <div className="judge-card-head">
              <span className="avatar">{j.name.slice(0, 1)}</span>
              <div>
                <h2>评委 {String(i + 1).padStart(2, "0")}</h2>
                <p>{j.title || `评委 ${i + 1}`}</p>
              </div>
              <Badge
                status={
                  j.enabled && j.expires_at > Date.now() ? "closed" : "paused"
                }
              >
                {!j.enabled
                  ? "已停用"
                  : j.expires_at <= Date.now()
                    ? "已过期"
                    : "已启用"}
              </Badge>
            </div>
            <img
              className="qr-code"
              src={`/api/admin/judges/${j.id}/qr?v=${j.token_version}`}
              alt={`${j.name}的专属评分二维码`}
            />
            <div className="qr-caption">
              <small>
                有效期至 {new Date(j.expires_at).toLocaleString("zh-CN")}
              </small>
            </div>
            <div className="judge-card-actions">
              <Button
                icon={ExternalLink}
                onClick={async () => {
                  try {
                    setLink({
                      name: j.name,
                      ...(await api(`/admin/judges/${j.id}/link`)),
                    });
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                评分链接
              </Button>
              <Button
                icon={QrCode}
                onClick={async () => {
                  try {
                    setLink({
                      id: j.id,
                      name: j.name,
                      test: true,
                      ...(await api(`/admin/judges/${j.id}/link?kind=test`)),
                    });
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                测试码
              </Button>
              <Button
                onClick={() =>
                  act(`/admin/judges/${j.id}/access`, "POST", {
                    enabled: !j.enabled,
                  })
                }
              >
                {j.enabled ? "停用" : "启用"}
              </Button>
              <Button
                icon={Clock3}
                onClick={() => {
                  if (
                    confirm(
                      `为${j.name}的二维码续期 7 天？\n二维码不变，评委无需重新扫码。`,
                    )
                  )
                    act(`/admin/judges/${j.id}/access`, "POST", {
                      renew: true,
                      days: 7,
                    });
                }}
              >
                续期
              </Button>
              <Button
                icon={RotateCw}
                onClick={() => {
                  if (
                    confirm(
                      `为${j.name}重新生成二维码并续期 7 天？\n旧二维码会立即失效，已扫码的评委需要重新领取。`,
                    )
                  )
                    act(`/admin/judges/${j.id}/access`, "POST", {
                      rotate: true,
                      days: 7,
                    });
                }}
              >
                换码
              </Button>
              {draft && (
                <>
                  <Button
                    onClick={() => {
                      setError(null);
                      setEdit({ ...j });
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    kind="danger-text"
                    onClick={() => {
                      if (confirm(`删除评委${j.name}？`))
                        act(`/admin/judges/${j.id}`, "DELETE", {});
                    }}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {!data.judges.length && (
        <Empty title="尚未添加评委">
          添加后生成有效期 7 天的专属评分二维码，可随时续期且不换码。
        </Empty>
      )}
      <ErrorBox error={!edit && error} />
      {edit && (
        <Modal
          title={edit.id ? "编辑评委" : "添加评委"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await act(
                  `/admin/judges${edit.id ? "/" + edit.id : ""}`,
                  edit.id ? "PUT" : "POST",
                  {
                    name: edit.name,
                    title: edit.title,
                  },
                );
                setEdit(null);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="评委姓名">
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="职务 / 备注">
              <input
                maxLength={500}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </Field>

            <ErrorBox error={error} />
            <Button kind="primary full-width" disabled={busy}>
              保存评委
            </Button>
          </form>
        </Modal>
      )}
      {link && (
        <Modal
          title={`${link.name}${link.test ? "的测试二维码" : "的评分入口"}`}
          onClose={() => setLink(null)}
        >
          {link.test ? (
            <>
              <p>
                此码仅在<b>测试评分阶段</b>可用。与本席正式码同时到期，有效期至 {date(link.expires_at)}。
              </p>
              <img
                className="qr-code"
                style={{ display: "block", margin: "0 auto" }}
                src={`/api/admin/judges/${link.id}/qr?kind=test`}
                alt={`${link.name}的测试二维码`}
              />
              <Field label="测试链接（压测脚本可用）">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <a
                className="button full-width"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                打开测试评分页面 <ExternalLink size={16} />
              </a>
            </>
          ) : (
            <>
              <p>此链接等同于评分凭证，请勿公开分享。</p>
              <Field label="专属链接">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <a
                className="button primary full-width"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                打开评分页面 <ExternalLink size={16} />
              </a>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function NewCompetition({ data, act }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        if (
          !confirm(
            "归档当前比赛并进入新比赛筹备？\n旧成绩与奖项完整保存在历史归档中；保留项目和评委名单，原二维码失效，需要重新打印。",
          )
        )
          return;
        setBusy(true);
        try {
          await act("/admin/competitions/new", "POST", {
            epoch: data.settings.epoch,
          });
          location.reload();
        } catch {
          setBusy(false);
        }
      }}
    >
      {busy ? "正在归档…" : "归档并新建比赛"}
    </Button>
  );
}

function Rules({ data, act }) {
  const [form, setForm] = useState({
    ...data.settings,
    judgeCount: data.judges.length || 5,
    projectCount: data.projects.length || 6,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const locked = data.settings.status !== "draft";
  const final = data.settings.status === "final";
  const number = (key, label, min, max, disabled = false) => (
    <Field label={label}>
      <input
        type="number"
        required
        min={min}
        max={max}
        disabled={disabled || locked}
        value={form[key]}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: Number(e.target.value),
            ...(key === "trimHigh" && form.trimSymmetric
              ? { trimLow: Number(e.target.value) }
              : {}),
          })
        }
      />
    </Field>
  );
  return (
    <>
      <PageTitle title="赛事设置">
        <Badge status={locked ? "closed" : "draft"}>
          {final ? "已发布" : locked ? "计分参数已锁定" : "可编辑"}
        </Badge>
      </PageTitle>
      {locked && (
        <div className="settings-explanation">
          <p>
            {final
              ? "成绩已发布，归档后可创建下一场比赛。"
              : `${data.settings.demo ? "当前为已开赛的演示赛事。" : "比赛已开始。"}人数、轮次和计分规则已锁定；赛事名称与奖项名额仍可修改。`}
          </p>
          <NewCompetition data={data} act={act} />
        </div>
      )}
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await act("/admin/settings", "PUT", form);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={final || busy}>
          <section className="panel settings-section">
            <h2>赛事信息与规模</h2>
            <Field label="赛事名称">
              <input
                required
                maxLength={100}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="副标题" hint="显示在背景首页主标题下方，可留空">
              <input
                maxLength={500}
                value={form.subtitle || ""}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              />
            </Field>
            <div className="form-grid three">
              {number("judgeCount", "评委人数", 1, 100)}
              {number("projectCount", "项目数量", 1, 200)}
              {number("rounds", "比赛轮次", 1, 20)}
            </div>
            <p>单一总分 · 满分 100 · 各轮平均分排名</p>
          </section>
          <section className="panel settings-section">
            <h2>最高 / 最低分处理</h2>
            <div className="rule-switches">
              <label>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={form.trimEnabled}
                  onChange={(e) =>
                    setForm({ ...form, trimEnabled: e.target.checked })
                  }
                />
                启用去分
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={form.trimSymmetric}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      trimSymmetric: e.target.checked,
                      ...(e.target.checked ? { trimLow: form.trimHigh } : {}),
                    })
                  }
                />
                对称去分
              </label>
            </div>
            <div className="form-grid">
              {number("trimHigh", "去除最高分数量", 0, 99, !form.trimEnabled)}
              {number(
                "trimLow",
                "去除最低分数量",
                0,
                99,
                !form.trimEnabled || form.trimSymmetric,
              )}
            </div>
          </section>
          <section className="panel settings-section">
            <h2>固定奖项名额</h2>
            <div className="form-grid three">
              {form.prizes.map((n, i) => (
                <Field key={i} label={`${["一", "二", "三"][i]}等奖名额`}>
                  <input
                    required
                    type="number"
                    min="0"
                    max="200"
                    value={n}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        prizes: form.prizes.map((v, j) =>
                          i === j ? Number(e.target.value) : v,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </section>
          {!final && (
            <Button kind="primary" disabled={busy}>
              保存设置
            </Button>
          )}
        </fieldset>
        <ErrorBox error={error} />
      </form>
      {!locked && (data.settings.testCompleted || data.projects.length > 0) && (
        <div className="settings-explanation">
          <NewCompetition data={data} act={act} />
        </div>
      )}
      {!!data.archives?.length && (
        <details className="archive-list">
          <summary>历史比赛归档（{data.archives.length}）</summary>
          {data.archives.map((a) => (
            <p key={a.id}>
              <a href={`/api/admin/archives/${a.id}`}>
                {a.title} · {date(a.created_at)} · 下载归档
              </a>
            </p>
          ))}
        </details>
      )}
    </>
  );
}

function TeamRoster({ project, locked, act }) {
  const [members, setMembers] = useState(project.members || "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="team-roster"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await act(`/admin/projects/${project.id}/members`, "PUT", {
            members,
          });
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{project.team}</h3>
      <Field label="获奖人员名单">
        <textarea
          aria-label={`${project.team}队员名单`}
          maxLength={2000}
          disabled={locked}
          placeholder="用顿号或换行分隔"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
        />
      </Field>
      {!locked && <Button disabled={busy}>保存名单</Button>}
    </form>
  );
}

function parseCsvTable(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore CR
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
function awardsFromRows(rows) {
  const cleaned = rows.map((r) => r.map((c) => String(c ?? "").trim()));
  let unitIdx = 0,
    nameIdx = 1,
    start = 0;
  const header = cleaned[0] || [];
  const unitHeader = header.findIndex((c) => /^(?:所属)?单位(?:名称)?$/.test(c));
  const nameHeader = header.findIndex((c) => /^(?:姓名|获奖人(?:姓名)?)$/.test(c));
  if (unitHeader >= 0 && nameHeader >= 0) {
    start = 1;
    unitIdx = unitHeader;
    nameIdx = nameHeader;
  }
  const awards = [];
  for (const r of cleaned.slice(start)) {
    const unit = (r[unitIdx] || "").slice(0, 100);
    const person = (r[nameIdx] || "").slice(0, 100);
    if (!unit && !person) continue;
    awards.push({ name: unit, recipient: person });
  }
  return awards;
}

function Awards({ data, act }) {
  const [prizes, setPrizes] = useState(data.settings.prizes);
  const [form, setForm] = useState({ name: "", recipient: "" });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [importError, setImportError] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const locked = data.settings.status === "final";
  async function loadFile(file) {
    setImportError(null);
    setPending(null);
    try {
      let rows;
      if (/\.(csv|txt)$/i.test(file.name)) rows = parseCsvTable(await file.text());
      else {
        const XLSX = await import("xlsx");
        const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = book.Sheets[book.SheetNames[0]];
        if (!sheet) throw new Error("表格中没有工作表");
        rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: "",
        });
      }
      const awards = awardsFromRows(rows);
      if (!awards.length)
        throw new Error('未解析到有效数据，请确认表格包含"单位"和"姓名"两列');
      setPending({ awards, source: file.name });
    } catch (e) {
      setImportError(e);
    }
  }
  async function importAwards(replace) {
    if (!pending) return;
    if (
      replace &&
      !confirm(`将删除现有 ${data.awards.length} 条个人奖项并导入 ${pending.awards.length} 条，确认？`)
    )
      return;
    setBusy(true);
    try {
      await act("/admin/awards/bulk", "POST", {
        replace,
        awards: pending.awards,
      });
      setPending(null);
      setPasteText("");
    } catch {
      // The shared action handler already displays the server error.
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="奖项设置">
        <Badge status={locked ? "closed" : "draft"}>
          {locked ? "已发布，奖项锁定" : "发布前可调整"}
        </Badge>
      </PageTitle>
      <section className="panel settings-section">
        <h2>项目奖项名额</h2>
        <details className="inline-help">
          <summary>名额规则</summary>
          <p>按固定名额分配；同分须确认顺序，可设为 0。</p>
        </details>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await act("/admin/prizes", "PUT", { prizes });
            } catch {
              // The shared action handler already displays the server error.
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid three">
            {prizes.map((n, i) => (
              <Field key={i} label={`${["一", "二", "三"][i]}等奖名额`}>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  required
                  disabled={locked}
                  value={n}
                  onChange={(e) =>
                    setPrizes(
                      prizes.map((v, j) =>
                        i === j ? Number(e.target.value) : v,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          {!locked && (
            <Button disabled={busy} kind="primary">
              保存奖项名额
            </Button>
          )}
        </form>
      </section>
      <section className="panel settings-section">
        <h2>团体奖队员名单</h2>
        {data.projects.map((p) => (
          <TeamRoster
            key={p.id}
            project={p}
            locked={locked}
            act={act}
          />
        ))}
      </section>
      <div className="section-title">
        <h2>个人奖项</h2>
      </div>
      <section className="panel settings-section">
        {!locked && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await act("/admin/awards", "POST", form);
                setForm({ name: "", recipient: "" });
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <Field label="单位">
                <input
                  required
                  maxLength={100}
                  placeholder="如：第一分公司"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="姓名">
                <input
                  required
                  maxLength={100}
                  value={form.recipient}
                  onChange={(e) =>
                    setForm({ ...form, recipient: e.target.value })
                  }
                />
              </Field>
            </div>
            <Button kind="primary" icon={Plus} disabled={busy}>
              添加个人奖项
            </Button>
          </form>
        )}
        {!locked && (
          <div className="award-import">
            <h3>批量导入</h3>
            <p className="table-sub">
              支持 Excel（.xlsx / .xls）或 CSV 表格，仅需两列：单位、姓名。
            </p>
            <div className="actions">
              <label className="button">
                <Upload size={16} />
                选择表格文件
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) loadFile(file);
                  }}
                />
              </label>
              <details className="inline-help">
                <summary>或粘贴表格文本</summary>
                <textarea
                  placeholder="单位，姓名（可用逗号、制表符或直接从 Excel 复制粘贴）"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <Button
                  type="button"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    setImportError(null);
                    const awards = awardsFromRows(parseCsvTable(pasteText));
                    if (!awards.length)
                      return setImportError(
                        new Error('未解析到有效数据，请确认每行包含"单位"和"姓名"'),
                      );
                    setPending({ awards, source: "粘贴文本" });
                  }}
                >
                  解析文本
                </Button>
              </details>
            </div>
            <ErrorBox error={importError} />
            {pending && (
              <div className="award-import-preview">
                <p>
                  已解析 <strong>{pending.awards.length}</strong> 条（来源：
                  {pending.source}）：
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>单位</th>
                        <th>姓名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.awards.slice(0, 8).map((a, i) => (
                        <tr key={i}>
                          <td>{a.name}</td>
                          <td>{a.recipient}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pending.awards.length > 8 && (
                  <p className="table-sub">
                    …以及另外 {pending.awards.length - 8} 条
                  </p>
                )}
                <div className="actions">
                  <Button
                    kind="primary"
                    icon={Plus}
                    disabled={busy}
                    onClick={() => importAwards(false)}
                  >
                    追加导入
                  </Button>
                  <Button disabled={busy} onClick={() => importAwards(true)}>
                    替换现有名单
                  </Button>
                  <Button
                    kind="danger-text"
                    disabled={busy}
                    onClick={() => setPending(null)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {data.awards.map((a) => (
          <div className="award-edit-row" key={a.id}>
            <Award size={22} />
            <div>
              <strong>{a.recipient}</strong>
              <p>{a.name}</p>
            </div>
            {!locked && (
              <Button
                kind="danger-text"
                icon={Trash2}
                onClick={() => {
                  if (confirm(`删除"${a.recipient}"的个人奖项？`))
                    act(`/admin/awards/${a.id}`, "DELETE", {});
                }}
              >
                删除
              </Button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function Logs({ data }) {
  return (
    <>
      <PageTitle title="操作记录">
        <a href="/api/admin/audit.json" className="button">
          <ArrowDownToLine size={16} />
          导出完整记录
        </a>
        <a href="/api/admin/export.csv" className="button primary">
          <ArrowDownToLine size={16} />
          导出成绩 CSV
        </a>
      </PageTitle>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((log) => (
                <tr key={log.id}>
                  <td className="nowrap">{date(log.created_at)}</td>
                  <td>{log.actor}</td>
                  <td className="nowrap">{log.action}</td>
                  <td>
                    <details>
                      <summary>查看详情</summary>
                      <pre>
                        {JSON.stringify(JSON.parse(log.detail), null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PrintJudges({ data }) {
  const [single, setSingle] = useState(false);
  return (
    <div className="print-page">
      <div className="print-toolbar">
        <h1>评委评分席位卡</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind={single ? "" : "primary"}
            aria-pressed={!single}
            onClick={() => setSingle(false)}
          >
            多码一页
          </Button>
          <Button
            kind={single ? "primary" : ""}
            aria-pressed={single}
            onClick={() => setSingle(true)}
          >
            单页单码
          </Button>
        </div>
        <Button icon={Printer} onClick={() => print()}>
          打印全部二维码
        </Button>
        <a href="/admin/judges">返回评委管理</a>
      </div>
      <p className="no-print">
        每张二维码对应一位评委，请分别发放。纸张选 A4，关闭浏览器页眉页脚。
        {single
          ? "当前为单页单码：一位评委一张 A4，便于逐个发放。"
          : "当前为多码一页：一页两张席位卡。"}
      </p>
      <div className={single ? "print-grid single" : "print-grid"}>
        {data.judges.map((j, i) => (
          <section className="print-ticket" key={j.id}>
            <p>{data.settings.title}</p>
            <h2>评委席 {String(i + 1).padStart(2, "0")}</h2>

            <img
              src={`/api/admin/judges/${j.id}/qr?v=${j.token_version}`}
              alt={`评委 ${i + 1} 评分二维码`}
            />
            <h3>扫码评分</h3>
            <small>
              有效期至 {new Date(j.expires_at).toLocaleString("zh-CN")} ·{" "}
              {j.enabled ? "已启用" : "已停用"}
            </small>
            <p className="ticket-note">请妥善保管，勿转发或公开张贴</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function competitionPhase(settings) {
  if (settings.mode === "test") return "测试评分";
  return settings.rounds > 1
    ? `正式比赛 · 第 ${settings.currentRound} / ${settings.rounds} 轮`
    : "正式比赛";
}

function TestJudges({ data }) {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [single, setSingle] = useState(false);
  const seats = JSON.stringify(data.judges.map(j => [j.id, j.token_version, j.expires_at, j.name]));
  useEffect(() => {
    let active = true;
    setError(null);
    setLinks(null);
    api("/admin/judges/test-links")
      .then(value => { if (active) setLinks(value); })
      .catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, [seats]);
  const text = links?.judges
    ?.map((j) => `${j.number}\t${j.name}\t${j.url}`)
    .join("\n");
  return (
    <div className="print-page">
      <div className="print-toolbar">
        <h1>测试压测二维码</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind={single ? "" : "primary"}
            aria-pressed={!single}
            onClick={() => setSingle(false)}
          >
            多码一页
          </Button>
          <Button
            kind={single ? "primary" : ""}
            aria-pressed={single}
            onClick={() => setSingle(true)}
          >
            单页单码
          </Button>
        </div>
        {links?.judges?.length ? (
          <Button icon={Printer} onClick={() => print()}>
            打印全部
          </Button>
        ) : null}
        <a href="/admin/judges">返回评委管理</a>
      </div>
      <p className="no-print">
        测试码与同席正式码共用到期时间，续期、停用和换码同步生效。测试码仅限测试阶段，正式评分请使用正式码。
      </p>
      {error && <ErrorBox error={error} />}
      {!links && !error && <p className="no-print">正在获取测试二维码…</p>}
      {links && !links.judges.length && (
        <Empty title="尚未添加评委">
          先在评委管理中添加评委，再生成测试二维码。
        </Empty>
      )}
      {links?.judges?.length ? (
        <>
          <div className={single ? "print-grid single" : "print-grid"}>
            {links.judges.map((j) => (
              <section className="print-ticket" key={j.id}>
                <p>{data?.settings?.title}</p>
                <h2>测试席 {String(j.number).padStart(2, "0")}</h2>
                <img
                  src={`/api/admin/judges/${j.id}/qr?kind=test&v=${j.token_version}`}
                  alt={`评委 ${j.number} 测试二维码`}
                />
                <h3>测试评分专用</h3>
                <small>{j.name} · 正式评分请使用正式二维码</small>
                <p className="ticket-note">仅测试阶段可用 · 到期 {date(j.expires_at)}</p>
              </section>
            ))}
          </div>
          <div className="no-print">
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Button
                icon={copied ? Check : QrCode}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                  } catch {
                    const el = document.getElementById("test-links-text");
                    el?.select();
                    document.execCommand?.("copy");
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "已复制" : "复制全部测试链接"}
              </Button>
              <span className="muted">
                每行：序号 + 评委名 + 测试链接，可直接粘贴到压测脚本。
              </span>
            </div>
            <textarea
              id="test-links-text"
              readOnly
              rows={Math.min(links.judges.length, 10)}
              value={text}
              onFocus={(e) => e.target.select()}
              style={{ width: "100%", marginTop: 12 }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function JudgeApp() {
  const live = useLive("/judge/state"),
    { data } = live;
  const [score, setScore] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const current = data?.projects.find((p) =>
    ["open", "ready"].includes(p.status),
  );
  const nextTeam = data?.settings.mode === "test" ? data.projects[0]
    : data?.projects.find((team) => team.status === "pending")
      ?? (data?.settings.currentRound < data?.settings.rounds ? data.projects[0] : null);
  const validScore = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(score) && Number(score) <= 100;
  const invalidScore = score !== "" && !validScore;
  const key =
    data && current
      ? `jh-single-${data.judge.id}-${data.settings.mode}-${data.settings.currentRound}-${data.settings.epoch}-${current.id}-${current.revision}`
      : "";
  useEffect(() => {
    try {
      setScore(localStorage.getItem(key) || "");
    } catch {
      setScore("");
    }
    setError(null);
  }, [key]);
  async function submit(e) {
    e.preventDefault();
    if (!validScore || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/judge/scores", "POST", {
        projectId: current.id,
        score: Number(score),
        phase: data.settings.mode,
        round: data.settings.currentRound,
        epoch: data.settings.epoch,
        revision: current.revision,
      });
      try {
        localStorage.removeItem(key);
      } catch {}
      await live.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="judge-app">
      <header className="judge-top">
        <h1>{data ? "评委 " + String(data.judge.number).padStart(2, "0") : "评委评分席"}</h1>
        <Connection connected={live.connected} />
      </header>
      <main>
        {!data ? (
          live.error ? <ErrorBox error={live.error} /> : <p role="status">正在连接赛事…</p>
        ) : (
          <>
            <div className="judge-welcome">
              <Badge status={data.settings.status}>
                {competitionPhase(data.settings)}
              </Badge>
              <p>{data.settings.title}</p>
            </div>
            {current ? (
              <section className="judge-form-panel">
                <div className="inline-meta">
                  <span>
                    {String(current.position).padStart(2, "0")} 号队伍
                  </span>
                  <Badge status={current.status} />
                </div>
                <h2>{current.team}</h2>
                {current.name !== current.team && <p>{current.name}</p>}
                {current.ownScore ? (
                  <div className="submitted-summary">
                    <CheckCircle2 size={36} />
                    <h3>评分已提交</h3>
                    <strong>
                      {fmt(current.ownScore.total / 100)}
                      <small>分</small>
                    </strong>
                    <p>提交时间 <time dateTime={current.ownScore.submitted_at}>{time(current.ownScore.submitted_at)}</time></p>
                    <p>已锁定，如需修改请联系管理员</p>
                    {nextTeam && <p className="judge-next">下一队：{nextTeam.team}</p>}
                  </div>
                ) : (
                  <form onSubmit={submit}>
                    <fieldset
                      disabled={
                        busy ||
                        current.status !== "open" ||
                        data.settings.status !== "running"
                      }
                    >
                      {current.revision > 0 && (
                        <div className="notice">请重新评分</div>
                      )}
                      <Field label="总分（满分 100 分）">
                        <input
                          className="score-input"
                          type="text"
                          inputMode="decimal"
                          required
                          autoComplete="off"
                          aria-invalid={invalidScore}
                          aria-describedby={invalidScore ? "score-range score-error" : "score-range"}
                          value={score}
                          onChange={(e) => {
                            setScore(e.target.value);
                            try {
                              localStorage.setItem(key, e.target.value);
                            } catch {}
                          }}
                        />
                      </Field>
                      <p id="score-range">0–100 分，最多两位小数</p>
                      {invalidScore && <p id="score-error" role="alert">请输入 0 到 100 之间的数字，最多保留两位小数。</p>}
                      <div className="judge-submit">
                        <Button kind="primary full-width" disabled={busy || !validScore} icon={Check}>
                          {busy ? "正在提交…" : "提交评分"}
                        </Button>
                      </div>
                    </fieldset>
                    <ErrorBox error={error} />
                  </form>
                )}
              </section>
            ) : (
              <div className="stage-empty">
                <h2>
                  {data.settings.status === "final"
                    ? "比赛已结束"
                    : "等待下一项目开放"}
                </h2>
              </div>
            )}
            <ErrorBox error={live.error} />
          </>
        )}
      </main>
    </div>
  );
}

function PresenterControls({ data, current, revealed, page, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState([]);
  const [order, setOrder] = useState("");
  const [reason, setReason] = useState("");
  const lock = useRef(false),
    lastAction = useRef(0);
  const next = data.presenter.next;
  const manual = data.settings.presentation.manual;
  const waitingReveal = next.waitForReveal && !revealed;
  const disabled = busy || !manual || !next.enabled || waitingReveal;
  const canBack =
    data.settings.status === "final" &&
    (page > 0 ||
      ["teamAwards", "individualAwards"].includes(
        data.settings.presentation.view,
      ));

  async function run(path, body = {}) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(path, "POST", body);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e);
      await refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!manual) run("/admin/presenter/start");
  }, [manual]);

  function move(back = false) {
    if (lock.current || modal || Date.now() - lastAction.current < 650) return;
    if (back ? !canBack || busy : disabled) return;
    lastAction.current = Date.now();
    if (!back && next.type === "tie") {
      setOrder(data.presenter.ties.map((p) => p.position).join(", "));
      setReason("");
      setError(null);
      setModal("tie");
      return;
    }
    run(`/admin/presenter/${back ? "previous" : "next"}`, { key: next.key });
  }
  function rejudge() {
    if (busy || data.settings.status === "final" || current?.status !== "open")
      return;
    setSelected([]);
    setReason("");
    setError(null);
    setModal("rejudge");
  }
  useEffect(() => {
    const handler = (e) => {
      if (
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        modal ||
        e.target.closest("input, textarea, select, [contenteditable], dialog")
      )
        return;
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        rejudge();
        return;
      }
      if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        setModal("help");
        return;
      }
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        const stage = data.settings.stage;
        run("/admin/stage", { action: "scene", scene: stage?.scene === "break" ? "live" : "break", version: stage?.version || 0 });
        return;
      }
      const forward = ["ArrowRight", "PageDown", " ", "Enter"].includes(e.key);
      const backward = ["ArrowLeft", "PageUp"].includes(e.key);
      if (!forward && !backward) return;
      e.preventDefault();
      move(backward);
    };
    const click = (e) => {
      if (
        e.detail > 1 ||
        modal ||
        !e.target.closest(".presenter-screen") ||
        e.target.closest(
          "button, a, input, textarea, select, dialog, .presenter-error",
        ) ||
        window.getSelection()?.toString()
      )
        return;
      move();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("click", click);
    };
  });
  const close = () => {
    if (!lock.current) {
      setModal(null);
      setError(null);
    }
  };
  return (
    <>
      <span className="sr-only" role="status">
        {busy ? "正在切换…" : waitingReveal ? "正在亮分…" : next.label}
      </span>
      {!modal && error && (
        <div className="presenter-error">
          <ErrorBox error={error} />
          {!manual && (
            <Button onClick={() => run("/admin/presenter/start")}>
              重新连接
            </Button>
          )}
        </div>
      )}
      {modal === "help" && (
        <Modal title="演示快捷键" onClose={close}>
          <dl className="presenter-shortcuts">
            <dt>单击 / 空格 / → / PageDown</dt>
            <dd>推进下一步</dd>
            <dt>← / PageUp</dt>
            <dd>回看排名和获奖名单</dd>
            <dt>F</dt>
            <dd>切换全屏</dd>
            <dt>R</dt>
            <dd>当前队伍重评</dd>
            <dt>B</dt>
            <dd>显示 / 关闭中场休息画面（不停止收分）</dd>
            <dt>H / Esc</dt>
            <dd>打开 / 关闭快捷键说明</dd>
          </dl>
        </Modal>
      )}
      {modal && modal !== "help" && (
        <Modal
          title={modal === "rejudge" ? "重新评分" : "确认同分名次"}
          onClose={close}
        >
          <form
            className="presenter-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (modal === "rejudge")
                run("/admin/scores/rejudge", {
                  projectId: current.id,
                  judgeIds: selected,
                  reason,
                });
              else
                run("/admin/tiebreak", {
                  projectIds: order
                    .trim()
                    .split(/[，,\s]+/)
                    .map(
                      (n) =>
                        data.presenter.ties.find(
                          (p) => p.position === Number(n),
                        )?.id || "",
                    ),
                  reason,
                });
            }}
          >
            {modal === "rejudge" ? (
              <>
                <label className="presenter-select-all">
                  <input
                    type="checkbox"
                    checked={selected.length === data.judges.length}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? data.judges.map((j) => j.id) : [],
                      )
                    }
                  />
                  全部评委
                </label>
                <div className="presenter-judges">
                  {data.judges.map((j, i) => (
                    <label key={j.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(j.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, j.id]
                              : selected.filter((id) => id !== j.id),
                          )
                        }
                      />
                      评委 {String(j.number || i + 1).padStart(2, "0")}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p>按裁定结果填写队伍序号顺序；不同得分仍按成绩排名。</p>
                <div className="presenter-ties">
                  {data.presenter.ties.map((p) => (
                    <div key={p.id}>
                      <span>
                        {String(p.position).padStart(2, "0")} {p.team}
                      </span>
                      <strong>{fmt(p.score)}</strong>
                    </div>
                  ))}
                </div>
                <Field label="队伍序号顺序">
                  <input
                    required
                    value={order}
                    disabled={busy}
                    onChange={(e) => setOrder(e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label={modal === "rejudge" ? "重评原因（选填）" : "裁定依据"}>
              <input
                required={modal !== "rejudge"}
                maxLength={100}
                disabled={busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <ErrorBox error={error} />
            <div className="actions">
              <Button type="button" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button
                kind="primary"
                disabled={busy || (modal === "rejudge" && !selected.length)}
              >
                {modal === "rejudge" ? "开始重评" : "确认顺序"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Screen({ data, connected, presenter = false, refresh }) {
  const view = data.settings.presentation.view;
  const current =
    data.projects.find((p) => p.id === data.settings.presentation.projectId) ||
    data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
    data.projects[0];
  const [localPage, setPage] = useState(0);
  const [reveal, setReveal] = useState(null);
  const manual = presenter || data.settings.presentation.manual;
  const slides = resultPages(data, view);
  const pages = Math.max(1, slides.length);
  const page = Math.min(manual ? data.settings.presentation.page || 0 : localPage, pages - 1);
  const records = slides[page] || [];
  const covered = data.settings.stage?.scene && data.settings.stage.scene !== "live";
  const board = covered ? (data.settings.stage.scene === "home" ? "home" : null)
    : view !== "project" ? view : null;
  const startedAt = data.settings.presentation.startedAt;
  // Legacy saved views have no start time and rotate from the moment they open.
  const elapsed = startedAt ? Math.max(0, Date.parse(data.serverTime) - startedAt) : 0;
  useEffect(() => {
    const handler = (e) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.key.toLowerCase() !== "f" ||
        e.target.closest("input, textarea, select, [contenteditable], dialog")
      )
        return;
      e.preventDefault();
      const promise = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      promise?.catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    setPage(0);
  }, [view]);
  useEffect(() => {
    if (manual || pages <= 1) return;
    // The preview and independently opened screens follow the same stage clock.
    const advance = Math.floor(elapsed / 12000);
    setPage(advance % pages);
    let interval;
    const timer = setTimeout(() => {
      const next = () => setPage((n) => (n + 1) % pages);
      next();
      interval = setInterval(next, 12000);
    }, 12000 - elapsed % 12000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [pages, view, manual, elapsed]);
  return (
    <div
      className={`${board ? "projection-screen" : "screen-page stage-view"} stage-${view} stage-scene-${data.settings.stage?.scene || "live"} ${presenter ? "presenter-screen" : ""}`}
    >
      {board ? <>
        <ProjectionBoard data={data} view={board} records={records} page={page} pages={pages} ResultsView={ResultsView} />
        {!connected && <div className="projection-connection"><Connection connected={false} /></div>}
      </> : <>
      <header>
        <div className="screen-event">{data.settings.title}</div>
        <div className="screen-tools">
          {!covered && view === "project" && data.settings.mode === "test" && <span>测试评分</span>}
          {!connected && <Connection connected={false} />}
        </div>
      </header>
      {covered ? <StageCover data={data} /> : (
        current ? (
          <ScorePanel
            project={current}
            data={data}
            onRevealChange={setReveal}
          />
        ) : (
          <div className="stage-empty">
            <h1>比赛即将开始</h1>
          </div>
        )
      )}
      <footer className="screen-pagination" />
      </>}
      {presenter && (
        <PresenterControls
          data={data}
          current={current}
          page={page}
          refresh={refresh}
          revealed={
            !!current &&
            reveal?.signature === scoreSignature(current, data) &&
            reveal.ready
          }
        />
      )}
    </div>
  );
}

function App() {
  const path = location.pathname;
  const adminMode = path.startsWith("/admin");
  const presenter = path === "/admin/present";
  const live = useLive(
    presenter
      ? "/admin/presenter/state"
      : adminMode
        ? "/admin/state"
        : "/state",
  );
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  async function act(path, method, body) {
    try {
      const result = await api(path, method, body);
      await live.refresh();
      setToast({ text: "操作已保存", ok: true });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3000);
      return result;
    } catch (e) {
      setToast({ text: e.message, ok: false });
      throw e;
    }
  }
  // Event handlers that don't await act still surface errors in the global notice.
  const safeAct = (...args) => {
    const result = act(...args);
    result.catch(() => {});
    return result;
  };
  const { data } = live;
  if (adminMode && (live.error?.status === 401 || live.error?.status === 403))
    return presenter ? (
      <div className="presenter-login">
        <Login refresh={live.refresh} presenter />
      </div>
    ) : (
      <Shell connected={live.connected} adminMode={false}>
        <Login refresh={live.refresh} />
      </Shell>
    );
  if (!data)
    return (
      <Shell connected={false}>
        <div className="loading">
          <Activity size={28} />
          <h2>{live.error ? "暂时无法获取赛事数据" : "正在连接赛事…"}</h2>
          <ErrorBox error={live.error} />
          <Button onClick={live.refresh} icon={RotateCw}>
            重新连接
          </Button>
        </div>
      </Shell>
    );
  if (presenter)
    return (
      <Screen
        data={data}
        connected={live.connected}
        presenter
        refresh={live.refresh}
      />
    );
  if (["/screen", "/", "/ranking"].includes(path))
    return <Screen data={data} connected={live.connected} />;
  if (path === "/admin/print") return <PrintJudges data={data} />;
  if (path === "/admin/test-qr") return <TestJudges data={data} />;
  let content;
  if (path === "/admin/ranking")
    content = <Ranking data={data} act={safeAct} />;
  else if (path === "/admin/display")
    content = <PresentationControls data={data} act={safeAct} refresh={live.refresh} />;
  else if (path === "/admin/projects")
    content = <ProjectManager data={data} act={safeAct} />;
  else if (path === "/admin/judges")
    content = <JudgeManager data={data} act={safeAct} />;
  else if (path === "/admin/rules")
    content = <Rules data={data} act={safeAct} />;
  else if (path === "/admin/awards")
    content = <Awards data={data} act={safeAct} />;
  else if (path === "/admin/logs") content = <Logs data={data} />;
  else if (path === "/" || path === "/admin")
    content = <Overview data={data} adminMode={adminMode} act={safeAct} />;
  else
    content = (
      <Empty title="页面不存在">
        <a href="/">返回赛事总览</a>
      </Empty>
    );
  return (
    <Shell data={data} connected={live.connected} adminMode={adminMode}>
      {live.error && <ErrorBox error={live.error} />}
      {content}
      {toast && (
        <div
          className={`toast ${toast.ok ? "" : "toast-error"}`}
          role={toast.ok ? "status" : "alert"}
        >
          {toast.ok ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
          {toast.text}
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="关闭通知"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Shell>
  );
}

// 渲染前套用已保存的配色主题；服务端 CSP 禁止内联脚本，因此放在模块入口。
applyTheme(readTheme());
createRoot(document.getElementById("root")).render(
  location.pathname === "/judge" ? <JudgeApp /> : <App />,
);
