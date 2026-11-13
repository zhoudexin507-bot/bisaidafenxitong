import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
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
import { resultPages, awardRows, awardLevelNames } from "../shared/slides.js";
import { zipStore } from "./zip.js";
import { exportBoards, exportNode, useImageExport } from "./export-image.jsx";
import "./styles.css";
import "./stages.css";
import { LiveDesk, StageControls, StageCover } from "./live-desk.jsx";
import { applyTheme, readTheme, THEMES } from "./theme.js";
import "./themes.css";
import {
  LayoutPreview,
  ProjectionBoard,
  previewResults,
  projectionNames,
} from "./projection.jsx";

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
  // 拖选弹窗内的文本（如输入框内容）时 mouseup 常落在遮罩上，
  // click 目标会变成 dialog 自身；只有按下与松开都在遮罩上才算点击遮罩关闭。
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        if (e.target === ref.current && pressedBackdrop.current) onClose();
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
  { label: "评委分析", path: "/admin/analysis", icon: BarChart3 },
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
  const seatRows = Array.from(
    { length: Math.ceil(count / columns) },
    (_, r) => data.judges.slice(r * columns, (r + 1) * columns),
  );
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
            {project.name && project.name !== project.team && (
              <span className="stage-project-name">{project.name}</span>
            )}
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
        {seatRows.map((row, r) => (
          <div className="judge-row" key={r}>
            {row.map((j, c) => {
              const i = r * columns + c;
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
        ))}
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
        {data.settings.closed && <Badge status="paused">已停用</Badge>}
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
        {s.closed
          ? "系统已停用 · 对外不展示"
          : s.mode === "test"
          ? "测试评分"
          : s.rounds > 1
            ? `正式比赛 · 第 ${s.currentRound} / ${s.rounds} 轮`
            : "正式比赛"}
      </span>
      <div className="actions">
        {s.closed ? (
          <Button
            kind="primary"
            onClick={() => act("/admin/access", "POST", { closed: false })}
          >
            恢复开放
          </Button>
        ) : (
          <Button
            disabled={s.status === "running"}
            title={
              s.status === "running"
                ? "比赛进行中不能停用，请先暂停或结束比赛"
                : "停用后大屏与评委端显示「未开放」，可随时恢复"
            }
            onClick={() => {
              if (confirm("停用后大屏与评委端将显示「未开放」，确认停用系统？"))
                act("/admin/access", "POST", { closed: true });
            }}
          >
            停用系统
          </Button>
        )}
        {s.status === "draft" && (
          <>
            <Button
              kind={!s.testCompleted && !s.closed ? "primary" : ""}
              disabled={s.closed}
              onClick={() => act("/admin/test/start", "POST", {})}
            >
              {s.testCompleted ? "重新测试" : "开始测试评分"}
            </Button>
            <Button
              kind="primary"
              disabled={!s.testCompleted || s.closed}
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

// 颁奖卡片自动排布：按 awardRows 分行居中；个别卡片可按记录 ID 微调位置（排版预览中设置）
function AwardRows({ items, view, data, card }) {
  const offsets =
    data.cardOffsets || data.settings?.displayLayouts?.[view]?.cards?.offsets || {};
  let start = 0;
  return (
    <div className="honor-rows">
      {awardRows(items.length).map((count, r) => {
        const row = items.slice(start, start + count);
        const base = start;
        start += count;
        return (
          <div className="honor-row" key={r}>
            {row.map((item, i) => {
              const offset = offsets[item.id] || {};
              return (
                <article
                  key={item.id}
                  className={`honor-winner ${card || ""}`}
                  style={{
                    "--index": base + i,
                    "--dx": offset.dx || 0,
                    "--dy": offset.dy || 0,
                  }}
                >
                  {card === "personal-honor" ? (
                    <>
                      <h3>{item.recipient}</h3>
                      <p className="winner-members">{item.name}</p>
                    </>
                  ) : (
                    <>
                      <h3>{item.team}</h3>
                      <p className="winner-members">{item.members || "名单待录入"}</p>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

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
            <strong className="standing-team">
              {team.team}
              {team.name && team.name !== team.team && (
                <span className="standing-project">{team.name}</span>
              )}
            </strong>
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
              <AwardRows items={teams} view={view} data={data} />
            </section>
          );
        })}
      </div>
    );
  }
  if (!data.awards.length) return <Empty title="暂无个人奖项" />;
  // 按等级分组展示（三等 → 二等 → 一等 → 未分组）；投屏时每页传入一个等级，管理页传入全部
  const groups = [3, 2, 1, 0]
    .map((level) => ({
      level,
      awards: data.awards.filter((award) => (award.level || 0) === level),
    }))
    .filter((group) => group.awards.length);
  return (
    <div className="team-honors">
      {groups.map(({ level, awards }) => (
        <section key={level} className={`team-honor medal-${level || 1}`}>
          <h2 className="honor-heading">{awardLevelNames[level]}</h2>
          <AwardRows items={awards} view={view} data={data} card="personal-honor" />
        </section>
      ))}
    </div>
  );
}

function Ranking({ data, act }) {
  const [order, setOrder] = useState("");
  const [reason, setReason] = useState("");
  const [view, setView] = useState("ranking");
  const image = useImageExport();
  return (
    <>
      <PageTitle title="比赛成绩">
        {data.settings.mode === "test" && <Badge status="open">测试分排名</Badge>}
        <Badge status={data.settings.status === "final" ? "closed" : "open"}>
          {data.settings.status === "final" ? "最终成绩" : "未发布"}
        </Badge>
        <Button
          icon={ImageIcon}
          disabled={image.busy}
          onClick={() =>
            image.run(() =>
              exportBoards(
                data,
                view,
                displayViews.find(([id]) => id === view)?.[1] || "比赛成绩",
                ResultsView,
              ),
            )
          }
        >
          {image.busy ? "正在生成…" : "导出图片"}
        </Button>
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
      {image.error && <ErrorBox error={image.error} />}
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

// —— 评委打分分析：打分完成率 / 评分入选率、宽严指数、稳定性与逐项目评分矩阵 ——
const percent = (rate) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);
const signed = (value) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

// 偏差热力：±5 分封顶做透明度渐变，偏高偏暖、偏低偏冷
function heatStyle(deviation) {
  if (deviation == null) return undefined;
  const alpha = 0.08 + (Math.min(Math.abs(deviation), 5) / 5) * 0.55;
  return {
    backgroundColor:
      deviation >= 0
        ? `rgba(225, 29, 72, ${alpha.toFixed(3)})`
        : `rgba(37, 99, 235, ${alpha.toFixed(3)})`,
  };
}

function MatrixCell({ project, cell, rounds }) {
  if (!cell.submittedRounds)
    return <td className="analysis-cell muted-cell">—</td>;
  const trimmedRounds = cell.rounds.filter((r) => r.trimmed);
  const value =
    rounds > 1 ? cell.avgTotal / 100 : cell.rounds[0].total / 100;
  const deviation =
    rounds > 1
      ? project.reference != null
        ? value - project.reference
        : null
      : cell.rounds[0].deviation;
  const title = cell.rounds
    .map((r) =>
      r.total == null
        ? `第${r.round}轮：未提交`
        : `第${r.round}轮 ${fmt(r.total / 100)}（偏差 ${signed(r.deviation)}${
            r.trimmed
              ? `，${r.trimmed === "high" ? "最高分" : "最低分"}已剔除`
              : ""
          }）`,
    )
    .join("\n");
  return (
    <td
      className={`analysis-cell${trimmedRounds.length ? " cell-trimmed" : ""}`}
      style={heatStyle(deviation)}
      title={title}
    >
      {fmt(value)}
      {!!trimmedRounds.length && <sup aria-label="该评委此项目有评分被剔除">剔</sup>}
    </td>
  );
}

function Analysis() {
  const [phaseChoice, setPhaseChoice] = useState("");
  const live = useLive(`/admin/analysis${phaseChoice ? `?phase=${phaseChoice}` : ""}`);
  const image = useImageExport();
  const report = useRef(null);
  const { data } = live;
  if (!data)
    return (
      <div className="loading">
        <Activity size={28} />
        <h2>{live.error ? "暂时无法获取分析数据" : "正在统计评委评分…"}</h2>
        {live.error && <ErrorBox error={live.error} />}
        <Button onClick={live.refresh} icon={RotateCw}>
          重新连接
        </Button>
      </div>
    );
  const judges = data.judges;
  const scoredJudges = judges.filter((j) => j.avg != null);
  const panelAvg = scoredJudges.length
    ? scoredJudges.reduce((n, j) => n + j.avg, 0) / scoredJudges.length
    : null;
  const leniencyScale = Math.max(
    1,
    ...judges.map((j) => Math.abs(j.leniency ?? 0)),
  );
  const projectLabel = new Map(
    data.matrix.map((p) => [
      p.id,
      `${String(p.position).padStart(2, "0")}号 ${p.team}`,
    ]),
  );
  function exportCsv() {
    const cell = (value) => {
      let str = String(value ?? "");
      if (/^[\s]*[=+@-]/.test(str)) str = `'${str}`;
      return `"${str.replaceAll('"', '""')}"`;
    };
    const header = [
      "席位", "评委", "职务", "已提交", "应提交", "打分完成率", "平均分",
      "最低分", "最高分", "标准差", "宽严指数", "被剔除(最高)", "被剔除(最低)",
      "评分入选率", "平均提交次序", "缺评",
    ];
    const rows = judges.map((j) => [
      String(j.number).padStart(2, "0"),
      j.name,
      j.title,
      j.submitted,
      j.expected,
      percent(j.completionRate),
      j.avg == null ? "" : j.avg.toFixed(2),
      j.min == null ? "" : j.min.toFixed(2),
      j.max == null ? "" : j.max.toFixed(2),
      j.stdDev == null ? "" : j.stdDev.toFixed(2),
      signed(j.leniency),
      j.trimmedHigh,
      j.trimmedLow,
      percent(j.keptRate),
      j.avgOrder == null ? "" : j.avgOrder.toFixed(1),
      j.missing.map((m) => projectLabel.get(m.projectId) || m.projectId).join("、"),
    ]);
    const csv =
      "\uFEFF" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "评委打分分析.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  const seatName = (j) =>
    /^评委\s*\d+$/.test(j.name) ? "" : j.name;
  return (
    <div className="analysis-page" ref={report}>
      <PageTitle title="评委打分分析">
        <Badge status={data.phase === "test" ? "open" : "closed"}>
          {data.phase === "test" ? "测试评分" : "正式评分"}
        </Badge>
        <Button icon={Download} onClick={exportCsv} disabled={!judges.length}>
          导出 CSV
        </Button>
        <Button
          icon={ImageIcon}
          disabled={image.busy || !judges.length}
          onClick={() =>
            image.run(() =>
              exportNode(
                report.current,
                `评委打分分析-${new Date().toISOString().slice(0, 10)}.png`,
              ),
            )
          }
        >
          {image.busy ? "正在生成…" : "导出图片"}
        </Button>
      </PageTitle>
      <div className="result-tabs" role="group" aria-label="评分阶段">
        {[["official", "正式评分"], ["test", "测试评分"]].map(([id, label]) => (
          <Button
            key={id}
            kind={data.phase === id ? "primary" : ""}
            onClick={() => setPhaseChoice(id)}
          >
            {label}
            {data.phase === id && data.mode === id ? " · 当前阶段" : ""}
          </Button>
        ))}
      </div>
      {image.error && <ErrorBox error={image.error} />}
      {!data.matrix.length || !judges.length ? (
        <Empty title="暂无可分析的评分数据">
          <a href="/admin/projects">先配置项目与评委</a>
        </Empty>
      ) : (
        <>
          <div className="stats-strip">
            <div>
              <span><Users size={15} />评委席位</span>
              <strong>{judges.length}<small> 席</small></strong>
            </div>
            <div>
              <span><ClipboardList size={15} />评分规模</span>
              <strong>{data.matrix.length}<small> 项 × {data.rounds} 轮</small></strong>
            </div>
            <div>
              <span><CheckCircle2 size={15} />总体完成率</span>
              <strong>{percent(data.totals.completionRate)}</strong>
            </div>
            <div>
              <span><ShieldCheck size={15} />去极值剔除</span>
              <strong>{data.totals.trimmed}<small> 次</small></strong>
            </div>
          </div>

          <section className="panel">
            <div className="section-head">
              <h2>
                评委总览 <span className="count">{judges.length}</span>
              </h2>
              <span className="analysis-hint">
                完成率 = 已提交 / 应提交；入选率 = 提交评分中未被去极值剔除的比例
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>评委</th>
                    <th>打分完成率</th>
                    <th>平均分</th>
                    <th>给分区间</th>
                    <th>稳定性 σ</th>
                    <th>宽严指数</th>
                    <th>评分入选率</th>
                    <th>被剔除</th>
                    <th className="align-right">平均次序</th>
                  </tr>
                </thead>
                <tbody>
                  {judges.map((j) => (
                    <tr key={j.id} className={j.enabled ? "" : "row-disabled"}>
                      <td>
                        <strong>{String(j.number).padStart(2, "0")} {j.name}</strong>
                        {j.title && <small className="table-sub">{j.title}</small>}
                      </td>
                      <td>
                        <div className="progress-info">
                          <span className="numeric">
                            {j.submitted}
                            <span className="muted"> / {j.expected}</span>
                          </span>
                          <div className="progress">
                            <span style={{ width: `${(j.completionRate || 0) * 100}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="numeric">{fmt(j.avg)}</td>
                      <td className="numeric">
                        {j.min == null ? "—" : `${fmt(j.min)} – ${fmt(j.max)}`}
                      </td>
                      <td className="numeric">{j.stdDev == null ? "—" : j.stdDev.toFixed(2)}</td>
                      <td className={`numeric ${j.leniency == null ? "" : j.leniency >= 0 ? "leniency-high" : "leniency-low"}`}>
                        {signed(j.leniency)}
                      </td>
                      <td className="numeric">{percent(j.keptRate)}</td>
                      <td className="numeric">
                        {data.trimEnabled === false
                          ? "不适用"
                          : `${j.trimmedTotal} 次${j.trimmedTotal ? `（高 ${j.trimmedHigh} / 低 ${j.trimmedLow}）` : ""}`}
                      </td>
                      <td className="numeric align-right">
                        {j.avgOrder == null ? "—" : j.avgOrder.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>平均分与宽严对比</h2>
              {panelAvg != null && (
                <span className="count">全体均值 {fmt(panelAvg)}</span>
              )}
            </div>
            <div className="analysis-charts">
              <div>
                <h3 className="analysis-chart-title">各评委平均分</h3>
                <div className="bar-chart">
                  {judges.map((j) => (
                    <div className="bar-row" key={j.id}>
                      <span className="bar-label">
                        {String(j.number).padStart(2, "0")} {seatName(j)}
                      </span>
                      <div className="bar-track">
                        {j.avg != null ? (
                          <span className="bar-fill" style={{ width: `${j.avg}%` }} />
                        ) : (
                          <span className="bar-empty">未评分</span>
                        )}
                        {panelAvg != null && (
                          <i className="bar-mean" style={{ left: `${panelAvg}%` }} />
                        )}
                      </div>
                      <span className="bar-value numeric">{fmt(j.avg)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="analysis-chart-title">宽严指数（对参照均分的平均偏差）</h3>
                <div className="bar-chart">
                  {judges.map((j) => (
                    <div className="bar-row" key={j.id}>
                      <span className="bar-label">
                        {String(j.number).padStart(2, "0")} {seatName(j)}
                      </span>
                      <div className="bar-track diverging">
                        {j.leniency != null && (
                          <span
                            className={`diverge-fill ${j.leniency >= 0 ? "diverge-high" : "diverge-low"}`}
                            style={
                              j.leniency >= 0
                                ? { left: "50%", width: `${(j.leniency / leniencyScale) * 50}%` }
                                : { right: "50%", width: `${(-j.leniency / leniencyScale) * 50}%` }
                            }
                          />
                        )}
                        <i className="bar-center" />
                      </div>
                      <span className="bar-value numeric">{signed(j.leniency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>逐项目评分矩阵</h2>
              <span className="analysis-legend">
                <i className="legend-chip" style={heatStyle(3)} />偏高
                <i className="legend-chip" style={heatStyle(-3)} />偏低
                <b className="legend-trim">剔</b>被去极值剔除
                <span className="muted">— 未提交{data.rounds > 1 ? " · 多轮显示各轮平均" : ""}</span>
              </span>
            </div>
            <div className="table-scroll">
              <table className="analysis-matrix">
                <thead>
                  <tr>
                    <th>项目</th>
                    {judges.map((j) => (
                      <th key={j.id} className="analysis-judge-col">
                        {String(j.number).padStart(2, "0")}
                        {seatName(j) && <small className="table-sub">{seatName(j)}</small>}
                      </th>
                    ))}
                    <th className="align-right">项目均分</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small className="table-sub">
                          {String(p.position).padStart(2, "0")} · {p.team}
                        </small>
                      </td>
                      {p.cells.map((cell) => (
                        <MatrixCell
                          key={cell.judgeId}
                          project={p}
                          cell={cell}
                          rounds={data.rounds}
                        />
                      ))}
                      <td className="numeric align-right">
                        <strong>{fmt(p.reference)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>评委平均</th>
                    {judges.map((j) => (
                      <th key={j.id} className="numeric">{fmt(j.avg)}</th>
                    ))}
                    <th className="numeric align-right">{fmt(panelAvg)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
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

// 超清大图直接上屏会边下载边逐行解码，切换画面时明显卡顿。
// 上传前在本地压到 1080p JPEG（动图和已足够小的图保持原样）。
async function compressBackground(file) {
  if (file.type === "image/gif" || file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function BackgroundSettings({ data, refresh }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const backgrounds = data.backgrounds || {};
  async function send(kind, method, file) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const payload = method === "PUT" && file ? await compressBackground(file) : file;
      const response = await fetch(`/api/admin/backgrounds/${kind}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": payload ? payload.type : "application/json" },
        body: payload || "{}",
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
        建议使用 16:9 图片，每张不超过 10 MB；超过 1.5 MB 的静态图会自动压缩到 1080p，避免大屏切换卡顿。未上传时使用内置红金庆典背景（深红渐变 + 金色光晕），上传后自动覆盖，清除图片即恢复内置背景。排名、团体奖和个人奖共用一张颁奖背景图；背景图自带赛事文字时，可在排版预览中关闭系统标题。
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
      <ErrorBox error={error} />
    </section>
  );
}

// 赛前（成绩未发布）用示例数据检查排名与颁奖画面，不影响现场大屏；
// 个人奖项与打分无关，已录入名单时直接预览真实最终画面。
function CeremonySamplePreview({ data, view }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view]);
  const useRealAwards = view === "individualAwards" && data.awards?.length > 0;
  const useRealTeams =
    (view === "ranking" || view === "teamAwards") && data.projects?.length > 0;
  const sample = {
    ...data,
    ...previewResults(view, data),
    settings: { ...data.settings, presentation: { ...data.settings.presentation } },
  };
  const slides = resultPages(sample, view);
  const pages = Math.max(1, slides.length);
  const index = Math.min(page, pages - 1);
  const label = (i) => {
    const records = slides[i];
    if (view === "teamAwards" && records?.[0])
      return `${prizeNames[records[0].prize] || `第 ${i + 1} 页`}（${records.length} 队）`;
    if (view === "individualAwards" && records?.[0])
      return `${awardLevelNames[records[0].level || 0]}（${records.length} 人）`;
    return `第 ${i + 1} 页`;
  };
  return (
    <>
      {useRealAwards && (
        <p className="sample-preview-reason">已按录入的个人奖项名单预览最终画面（{data.awards.length} 人）。</p>
      )}
      {useRealTeams && (
        <p className="sample-preview-reason">
          已按录入的队伍与奖项名额预览（{data.projects.length} 队），名次与分数为示例。
        </p>
      )}
      {pages > 1 && (
        <div className="scene-pages sample-preview-pages" aria-label="预览页面切换">
          <button className="button scene-page-button" disabled={index === 0}
            aria-label="上一页" onClick={() => setPage(index - 1)}><ChevronLeft size={16} /></button>
          <select className="scene-page-select" aria-label="选择预览页面" value={index}
            onChange={(e) => setPage(Number(e.target.value))}>
            {slides.map((_, i) => <option key={i} value={i}>{label(i)}</option>)}
          </select>
          <button className="button scene-page-button" disabled={index >= pages - 1}
            aria-label="下一页" onClick={() => setPage(index + 1)}><ChevronRight size={16} /></button>
          <span className="scene-pages-count">{index + 1} / {pages} 页</span>
        </div>
      )}
      <ScreenPreview>
        <ProjectionBoard data={sample} view={view} page={index} pages={pages}
          records={slides[index] || []} ResultsView={ResultsView} />
      </ScreenPreview>
    </>
  );
}

function PresentationControls({ data, act, refresh }) {
  const [editing, setEditing] = useState(false);
  const [sampleView, setSampleView] = useState(null);
  const [sampleReason, setSampleReason] = useState("");
  const image = useImageExport();
  const presentation = data.settings.presentation;
  const current =
    data.projects.find((p) => p.id === presentation.projectId) ||
    data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
    data.projects[0];
  const final = data.settings.status === "final";
  // 发布成绩后仍可逐队回看评分画面：选择器与前后翻队始终可用
  const teamIndex = current ? data.projects.indexOf(current) : -1;
  const showTeam = (index) =>
    act("/admin/presentation", "POST", {
      view: "project",
      projectId: data.projects[index].id,
    });
  // 颁奖画面切换：始终由服务器裁决——本地数据可能滞后（如刚发布成绩），
  // 成功则真正切屏；服务器以 409 拒绝（成绩未发布）时才进入示例数据预览。
  async function toggleAwardView(view) {
    setSampleReason("");
    try {
      await api("/admin/presentation", "POST", { view });
      setSampleView(null);
      await refresh?.();
    } catch (e) {
      setEditing(false);
      setSampleView(view);
      setSampleReason(e.message || "成绩尚未发布");
    }
  }
  // 真实颁奖画面已切出时，退出示例预览
  useEffect(() => {
    if (data.settings.status === "final" && data.settings.presentation.view !== "project")
      setSampleView(null);
  }, [data.settings.status, data.settings.presentation.view]);
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
          <StageControls data={data} act={act} onToggle={toggleAwardView} />
          <section className="panel display-control">
            <h2 className="display-section-title">大屏内容</h2>
            <div className="team-picker">
              <Button
                aria-label="上一队"
                icon={ChevronLeft}
                disabled={teamIndex <= 0}
                onClick={() => showTeam(teamIndex - 1)}
              />
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
              <Button
                aria-label="下一队"
                icon={ChevronRight}
                disabled={teamIndex < 0 || teamIndex >= data.projects.length - 1}
                onClick={() => showTeam(teamIndex + 1)}
              />
            </div>
            {/* 收分流程操作仅在成绩发布前有意义 */}
            {!final && current && (
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
          <BackgroundSettings data={data} refresh={refresh} />
        </div>
        <div className="display-preview">
          <div className="preview-heading">
            <h2>
              {editing
                ? "排版预览"
                : sampleView
                  ? `示例数据预览 · ${displayViews.find(([id]) => id === sampleView)?.[1] || ""}`
                  : "当前大屏"}
            </h2>
            <div className="preview-tools">
              {sampleView && !editing && (
                <Button onClick={() => setSampleView(null)}>返回现场预览</Button>
              )}
              <Button
                icon={ImageIcon}
                title={
                  presentation.view === "project"
                    ? "评分画面无需导出；请先切到排名或颁奖画面"
                    : "按 1920×1080 海报规格导出当前画面全部页面"
                }
                disabled={
                  image.busy || editing || !!sampleView || presentation.view === "project"
                }
                onClick={() =>
                  image.run(() =>
                    exportBoards(
                      data,
                      presentation.view,
                      projectionNames[presentation.view] || "大屏画面",
                      ResultsView,
                    ),
                  )
                }
              >
                {image.busy ? "正在生成…" : "导出图片"}
              </Button>
              {image.error && <span role="alert" className="preview-export-error">{image.error.message}</span>}
              <Button aria-pressed={editing} onClick={() => {
                if (!editing) setSampleView(null);
                setEditing(!editing);
              }}>{editing ? "返回现场预览" : "排版预览"}</Button>
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
          {editing ? <LayoutPreview data={data} act={act} ScreenPreview={ScreenPreview} ResultsView={ResultsView} />
            : sampleView ? (
              <>
                {sampleReason && <p className="sample-preview-reason">{sampleReason}，当前为示例数据预览。</p>}
                <CeremonySamplePreview data={data} view={sampleView} />
              </>
            )
            : <ScreenPreview />}
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
function parseAwardLevel(value) {
  const v = String(value ?? "").trim();
  if (/^[一二三]等奖/.test(v)) return "一二三".indexOf(v[0]) + 1;
  if (/^[123]$/.test(v)) return Number(v);
  return 0;
}
function awardsFromRows(rows) {
  const cleaned = rows.map((r) => r.map((c) => String(c ?? "").trim()));
  let unitIdx = 0,
    nameIdx = 1,
    levelIdx = -1,
    start = 0;
  const header = cleaned[0] || [];
  const unitHeader = header.findIndex((c) => /^(?:所属)?单位(?:名称)?$/.test(c));
  const nameHeader = header.findIndex((c) => /^(?:姓名|获奖人(?:姓名)?)$/.test(c));
  const levelHeader = header.findIndex((c) => /^(?:奖项(?:等级)?|奖级|等级)$/.test(c));
  if (unitHeader >= 0 && nameHeader >= 0) {
    start = 1;
    unitIdx = unitHeader;
    nameIdx = nameHeader;
    levelIdx = levelHeader;
  }
  const awards = [];
  for (const r of cleaned.slice(start)) {
    const unit = (r[unitIdx] || "").slice(0, 100);
    const person = (r[nameIdx] || "").slice(0, 100);
    if (!unit && !person) continue;
    awards.push({
      name: unit,
      recipient: person,
      level: levelIdx >= 0 ? parseAwardLevel(r[levelIdx]) : 0,
    });
  }
  return awards;
}

function Awards({ data, act }) {
  const [prizes, setPrizes] = useState(data.settings.prizes);
  const [form, setForm] = useState({ name: "", recipient: "", level: 0 });
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
                // 连续录入时保留等级，免得每条都重选
                setForm({ name: "", recipient: "", level: form.level });
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
              <Field label="奖项等级">
                <select
                  value={form.level}
                  onChange={(e) =>
                    setForm({ ...form, level: Number(e.target.value) })
                  }
                >
                  {awardLevelNames.map((label, level) => (
                    <option key={level} value={level}>
                      {level === 0 ? "未分组" : label}
                    </option>
                  ))}
                </select>
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
                  支持 Excel（.xlsx / .xls）或 CSV 表格，两列（单位、姓名）或三列（单位、姓名、奖项：一等奖 / 二等奖 / 三等奖）。
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
                      placeholder="单位，姓名，奖项（可用逗号、制表符或直接从 Excel 复制粘贴）"
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
                        <th>奖项</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.awards.slice(0, 8).map((a, i) => (
                        <tr key={i}>
                          <td>{a.name}</td>
                          <td>{a.recipient}</td>
                          <td>{a.level ? awardLevelNames[a.level] : "未分组"}</td>
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
            <select
              className="award-level-select"
              aria-label={`${a.recipient}的奖项等级`}
              disabled={locked}
              value={a.level || 0}
              onChange={(e) =>
                act(`/admin/awards/${a.id}`, "PUT", {
                  level: Number(e.target.value),
                })
              }
            >
              {awardLevelNames.map((label, level) => (
                <option key={level} value={level}>
                  {level === 0 ? "未分组" : label}
                </option>
              ))}
            </select>
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

// —— 评委二维码纯净图导出：canvas 合成「二维码 + 席位标签」，打包为 ZIP ——
// 图片仅白底、二维码与一行席位信息，不含打印版说明文字，便于发送或自行排版。
// （ZIP 打包工具已抽到 src/zip.js，与画面导出图片包共用。）

// 取服务端 SVG 二维码，经 data: URL（受 CSP 许可）绘入 canvas 并加席位标签
async function qrImageBytes(judge, label) {
  const response = await fetch(
    `/api/admin/judges/${judge.id}/qr?v=${judge.token_version}`,
  );
  if (!response.ok) throw new Error("获取二维码失败，请刷新后重试");
  const image = new Image();
  image.src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(await response.text());
  await image.decode();
  const width = 640,
    qr = 544,
    pad = (width - qr) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = pad + qr + 72;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, canvas.height);
  context.drawImage(image, pad, pad, qr, qr);
  context.fillStyle = "#111827";
  context.font =
    '600 34px "Manrope Variable", "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(label, width / 2, pad + qr + 22, width - 32);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("生成二维码图片失败"))),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function PrintJudges({ data }) {
  const [single, setSingle] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  async function exportZip() {
    if (exporting || !data.judges.length) return;
    setExporting(true);
    setExportError(null);
    try {
      const files = [];
      for (let i = 0; i < data.judges.length; i++) {
        const judge = data.judges[i],
          number = String(i + 1).padStart(2, "0");
        // 未改名的默认席位名（评委 01）不再重复展示
        const label = /^评委\s*\d+$/.test(judge.name)
          ? `评委席 ${number}`
          : `评委席 ${number} · ${judge.name}`;
        files.push({
          name: `${number}-${judge.name.replace(/[\\/:*?"<>|]/g, "_")}.png`,
          bytes: await qrImageBytes(judge, label),
        });
      }
      const url = URL.createObjectURL(zipStore(files));
      const link = document.createElement("a");
      link.href = url;
      link.download = "评委评分二维码.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }
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
        <Button icon={Download} onClick={exportZip} disabled={exporting}>
          {exporting ? "正在生成…" : "导出图片 ZIP"}
        </Button>
        <Button icon={Printer} onClick={() => print()}>
          打印全部二维码
        </Button>
        <a href="/admin/judges">返回评委管理</a>
      </div>
      {exportError && <ErrorBox error={exportError} />}
      <p className="no-print">
        每张二维码对应一位评委，请分别发放。纸张选 A4，关闭浏览器页眉页脚。「导出图片
        ZIP」生成纯净版：白底二维码 + 席位标签，无打印排版，便于线上发送或自行排版。
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
        ) : data.closed ? (
          <div className="judge-welcome">
            <Badge status="paused">系统未开放</Badge>
            <p>评分系统当前未开放，请在比赛时间访问</p>
          </div>
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
  // 系统停用时接口只回最小负载，presentation 可能缺席
  const manual = data.settings.presentation?.manual;
  const waitingReveal = next.waitForReveal && !revealed;
  const disabled = busy || !manual || !next.enabled || waitingReveal;
  // 正式发布后与测试收官预演中均可回看颁奖页面
  const reviewing =
    data.settings.status === "final" ||
    (data.settings.mode === "test" &&
      data.settings.presentation?.view !== "project");
  const canBack =
    reviewing &&
    (page > 0 ||
      ["teamAwards", "individualAwards"].includes(
        data.settings.presentation?.view,
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
  // 系统停用：大屏与演示端都显示未开放画面，不读任何比赛数据
  // （演示端保留控制条，由 nextSlide 提示「恢复开放」后再推进）
  if (data.settings.closed)
    return (
      <div
        className={`screen-page stage-view stage-closed${presenter ? " presenter-screen" : ""}`}
      >
        <div className="stage-empty">
          <h1>赛事系统未开放</h1>
          <p>请在比赛时间访问</p>
        </div>
        {!connected && (
          <div className="projection-connection">
            <Connection connected={false} />
          </div>
        )}
        {presenter && (
          <PresenterControls
            data={data}
            current={undefined}
            page={0}
            refresh={refresh}
            revealed={false}
          />
        )}
      </div>
    );
  const view = data.settings.presentation.view;
  const current =
    data.projects.find((p) => p.id === data.settings.presentation.projectId) ||
    data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
    data.projects[0];
  const [reveal, setReveal] = useState(null);
  // 排名与颁奖页面由后台大屏控制逐页切换，大屏端只跟随后台页码，不再自动轮播。
  const slides = resultPages(data, view);
  const pages = Math.max(1, slides.length);
  const page = Math.min(data.settings.presentation.page || 0, pages - 1);
  const records = slides[page] || [];
  const covered = data.settings.stage?.scene && data.settings.stage.scene !== "live";
  const board = covered ? (data.settings.stage.scene === "home" ? "home" : null)
    : view !== "project" ? view : null;
  // 背景图提前下载并解码：切换画面时直接命中缓存，避免大图边下边画的卡顿。
  const backgroundKey = Object.entries(data.backgrounds || {})
    .map(([kind, version]) => `${kind}:${version}`)
    .join("|");
  useEffect(() => {
    for (const [kind, version] of Object.entries(data.backgrounds || {})) {
      const image = new Image();
      image.src = `/api/backgrounds/${kind}?v=${version}`;
      image.decode().catch(() => {});
    }
  }, [backgroundKey]);
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
  return (
    <div
      className={`${board ? "projection-screen" : "screen-page stage-view"} stage-${view} stage-scene-${data.settings.stage?.scene || "live"} ${presenter ? "presenter-screen" : ""}`}
    >
      {board ? <>
        {data.settings.mode === "test" && <div className="projection-badge">测试预演</div>}
        <ProjectionBoard data={data} view={board} records={records} page={page} pages={pages} ResultsView={ResultsView} />
        {!connected && <div className="projection-connection"><Connection connected={false} /></div>}
      </> : <>
      <header>
        <div className="screen-event">{data.settings.title}</div>
        <div className="screen-tools">
          {!covered && data.settings.mode === "test" && (
            <span>{view === "project" ? "测试评分" : "测试预演"}</span>
          )}
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
  else if (path === "/admin/analysis") content = <Analysis />;
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
