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
  Users,
  X,
} from "lucide-react";
import "./styles.css";
import "./stages.css";
import { LiveDesk, StageControls, StageCover } from "./live-desk.jsx";

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
  const incoming = location.hash.slice(1);
  if (incoming) {
    sessionStorage.setItem("jh_judge", incoming);
    history.replaceState(null, "", "/judge");
  }
  judgeToken = sessionStorage.getItem("jh_judge") || "";
}

async function api(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
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
  const seq = useRef(0);
  async function refresh() {
    const n = ++seq.current;
    try {
      const next = await api(path);
      if (n === seq.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) {
        setError(e);
        if (e.status === 401 || e.status === 403) setData(null);
      }
    }
  }
  useEffect(() => {
    let alive = true;
    let timer;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
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
      ++seq.current;
      events.close();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [path]);
  return { data, error, connected: connected && !error, refresh };
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
      <p>{children}</p>
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
function PageTitle({ title, subtitle, children }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="actions">{children}</div>
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
function Shell({ children, data, connected, adminMode }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <a href="/admin" className="brand">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <span>
            竞衡<small>比赛评分系统</small>
          </span>
        </a>
        <div className="nav-caption">赛事工作台</div>
        <nav>
          {navigation.map((n, i) => (
            <a
              key={n.path}
              className={`${location.pathname === n.path || (location.pathname === "/admin" && i === 0) ? "active" : ""} ${i === 2 ? "nav-divider" : ""}`}
              href={n.path}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {location.pathname === n.path && <ChevronRight size={15} />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a className="account" href="/admin">
            <span className="avatar">
              <Users size={17} />
            </span>
            <span>
              {adminMode ? "赛事管理员" : "赛事管理"}
              <small>{adminMode ? "管理工作台" : "管理员登录"} </small>
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
      className={`score-panel stage-score ${complete ? "revealed" : "concealed"} reveal-step-${step}`}
      data-reveal-step={complete ? step : "waiting"}
    >
      <div className="score-panel-top">
        <div className="current-info">
          <div className="inline-meta">
            <Badge status={complete ? "closed" : ready ? "ready" : "open"}>
              {phase}
            </Badge>
            {data.settings.mode === "test" ? (
              <span>测试评分</span>
            ) : (
              data.settings.rounds > 1 && (
                <span>
                  第 {data.settings.currentRound} / {data.settings.rounds} 轮
                </span>
              )
            )}
          </div>
          <h2>
            <span className="team-prefix">
              {String(project.position).padStart(2, "0")}
            </span>
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
                : "已完成评分"}
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
      <div className="judge-scores">
        {data.judges.map((j, i) => {
          const score = project.scores.find((v) => v.judge_id === j.id),
            low = project.result.droppedLow?.includes(j.id),
            high = project.result.droppedHigh?.includes(j.id),
            drop = low || high;
          return (
            <div
              key={j.id}
              className={`judge-score ${score ? "submitted" : ""} ${complete && step >= 1 && drop ? "extreme" : ""} ${complete && step >= 2 && drop ? "excluded" : ""}`}
            >
              <div>
                <span>评委 {String(j.number || i + 1).padStart(2, "0")}</span>
              </div>
              {complete ? (
                <>
                  <strong>{fmt(score?.total / 100)}</strong>
                  <small>
                    {step >= 2 && drop
                      ? "已剔除"
                      : step >= 1 && drop
                        ? high
                          ? "最高分"
                          : "最低分"
                        : " "}
                  </small>
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
            <span>
              {data.settings.testCompleted
                ? "测试已完成，可以正式开赛"
                : "先完成测试评分，再开始正式比赛"}
            </span>
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
function ResultsView({ data, view }) {
  if (view === "ranking")
    return (
      <section
        className={`results-table standings ${data.ranking.length <= 3 ? "standings-short" : ""}`}
      >
        {data.ranking.length ? (
          <div className="table-scroll">
            <table aria-label="比赛得分排名">
              <thead>
                <tr>
                  <th>名次</th>
                  <th>参赛队伍</th>
                  <th className="align-right">得分</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((p) => (
                  <tr key={p.id} className={`standing-row standing-${p.rank}`}>
                    <td>
                      <span className={`rank-num rank-${p.rank}`}>
                        {p.rank}
                      </span>
                    </td>
                    <td>
                      <strong>{p.team}</strong>
                    </td>
                    <td className="table-score align-right">
                      {p.result.complete ? fmt(p.result.average) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="等待评分完成" />
        )}
      </section>
    );
  if (view === "teamAwards") {
    const levels = [1, 2, 3].filter((level) =>
      data.ranking.some((p) => p.prize === level),
    );
    if (!levels.length) return <Empty title="暂无团体奖项" />;
    return (
      <div className="team-honors" style={{ "--honor-columns": levels.length }}>
        {levels.map((level) => (
          <section
            key={level}
            className={`team-honor honor-${level} ${data.ranking.filter((p) => p.prize === level).length > 2 ? "honor-stacked" : ""}`}
          >
            <header className="honor-heading">
              <span className="honor-emblem" aria-hidden="true">
                <Trophy size={36} />
              </span>
              <h2>{["", "一", "二", "三"][level]}等奖</h2>
            </header>
            {data.ranking
              .filter((p) => p.prize === level)
              .map((p) => (
                <div className="honor-winner" key={p.id}>
                  <h3>{p.team}</h3>
                  <div className="winner-members">
                    {p.members || "名单待录入"}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
    );
  }
  if (!data.awards.length) return <Empty title="暂无个人奖项" />;
  return (
    <div
      className={`personal-honors ${data.awards.length === 1 ? "personal-single" : ""} ${data.awards.length > 3 ? "personal-many" : ""}`}
      style={{ "--honor-columns": Math.min(data.awards.length, 3) }}
    >
      {data.awards.map((a) => (
        <section className="personal-honor" key={a.id}>
          <span className="honor-emblem" aria-hidden="true">
            <Award size={36} />
          </span>
          <div>
            <span className="personal-award-title">{a.name}</span>
            <h3>{a.recipient}</h3>
            {a.note && <p>{a.note}</p>}
          </div>
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
function PresentationControls({ data, act }) {
  const presentation = data.settings.presentation;
  const current =
    data.projects.find((p) => p.id === presentation.projectId) ||
    data.projects.find((p) => ["ready", "open"].includes(p.status)) ||
    data.projects[0];
  const final = data.settings.status === "final";
  const view = presentation.view;
  const nextIndex = displayViews.findIndex(([id]) => id === view) + 1;
  return (
    <>
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
      <StageControls data={data} act={act} />
      <CompetitionControls data={data} act={act} />
      {!final ? (
        <section className="panel display-control">
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
      ) : (
        <section className="panel display-control">
          <div className="result-tabs">
            {displayViews.map(([id, label]) => (
              <Button
                key={id}
                kind={id === view ? "primary" : ""}
                onClick={() => act("/admin/presentation", "POST", { view: id })}
              >
                {label}
              </Button>
            ))}
          </div>
          {nextIndex > 0 && nextIndex < displayViews.length && (
            <Button
              kind="primary"
              icon={ArrowRight}
              onClick={() =>
                act("/admin/presentation", "POST", {
                  view: displayViews[nextIndex][0],
                })
              }
            >
              下一步：{displayViews[nextIndex][1]}
            </Button>
          )}
        </section>
      )}
      <h2 className="preview-heading">当前大屏</h2>
      {data.settings.stage?.scene && data.settings.stage.scene !== "live" ? <div className="stage-preview"><StageCover data={data} /></div> : view === "project" ? (
        current ? (
          <ScorePanel project={current} data={data} />
        ) : (
          <Empty title="请选择参赛队伍" />
        )
      ) : (
        <ResultsView data={data} view={view} />
      )}
    </>
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
            <Field label="重评原因">
              <input
                required
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
              setEdit({ name: "", title: "", days: 2 });
            }}
          >
            添加评委
          </Button>
        )}
      </PageTitle>
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          当前 <b>{data.judges.length}</b> 位评委 · 二维码请分别发放
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
                onClick={() =>
                  act(`/admin/judges/${j.id}/access`, "POST", {
                    enabled: !j.enabled,
                  })
                }
              >
                {j.enabled ? "停用" : "启用"}
              </Button>
              <Button
                icon={RotateCw}
                onClick={() => {
                  if (
                    confirm(
                      `为${j.name}重新生成二维码并续期 48 小时？旧二维码会立即失效。`,
                    )
                  )
                    act(`/admin/judges/${j.id}/access`, "POST", {
                      rotate: true,
                      days: 2,
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
                      setEdit({ ...j, days: 2 });
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
          添加后生成有效期 48 小时的专属评分二维码。
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
                    days: Number(edit.days),
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
        <Modal title={`${link.name}的评分入口`} onClose={() => setLink(null)}>
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

function Awards({ data, act }) {
  const [prizes, setPrizes] = useState(data.settings.prizes);
  const [form, setForm] = useState({ name: "", recipient: "", note: "" });
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle title="奖项设置">
        <Badge status={data.settings.status === "final" ? "closed" : "draft"}>
          {data.settings.status === "final"
            ? "已发布，奖项锁定"
            : "发布前可调整"}
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
                  disabled={data.settings.status === "final"}
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
          {data.settings.status !== "final" && (
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
            locked={data.settings.status === "final"}
            act={act}
          />
        ))}
      </section>
      <div className="section-title">
        <h2>个人奖项</h2>
      </div>
      <section className="panel settings-section">
        {data.awards.map((a) => (
          <div className="award-edit-row" key={a.id}>
            <Award size={22} />
            <div>
              <strong>
                {a.name} · {a.recipient}
              </strong>
              <p>{a.note}</p>
            </div>
            {data.settings.status !== "final" && (
              <Button
                kind="danger-text"
                icon={Trash2}
                onClick={() => {
                  if (confirm("删除此个人奖项？"))
                    act(`/admin/awards/${a.id}`, "DELETE", {});
                }}
              >
                删除
              </Button>
            )}
          </div>
        ))}
        {data.settings.status !== "final" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await act("/admin/awards", "POST", form);
                setForm({ name: "", recipient: "", note: "" });
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <Field label="奖项名称">
                <input
                  required
                  maxLength={100}
                  placeholder="如：最佳协作奖"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="获奖人">
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
            <Field label="颁奖说明">
              <input
                maxLength={500}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
            <Button kind="primary" icon={Plus} disabled={busy}>
              添加个人奖项
            </Button>
          </form>
        )}
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
  return (
    <div className="print-page">
      <div className="print-toolbar">
        <h1>评委评分席位卡</h1>
        <Button kind="primary" icon={Printer} onClick={() => print()}>
          打印全部二维码
        </Button>
        <a href="/admin/judges">返回评委管理</a>
      </div>
      <p className="no-print">
        每张二维码对应一位评委，请分别发放。纸张选 A4，关闭浏览器页眉页脚。
      </p>
      <div className="print-grid">
        {data.judges.map((j, i) => (
          <section className="print-ticket" key={j.id}>
            <p>{data.settings.title}</p>
            <span>评委席 {String(i + 1).padStart(2, "0")}</span>
            <h2>评委 {String(i + 1).padStart(2, "0")}</h2>

            <img
              src={`/api/admin/judges/${j.id}/qr?v=${j.token_version}`}
              alt={`评委 ${i + 1} 评分二维码`}
            />
            <h3>扫码评分 · 专属入口</h3>
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

function JudgeApp() {
  const live = useLive("/judge/state"),
    { data } = live;
  const [score, setScore] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const current = data?.projects.find((p) =>
    ["open", "ready"].includes(p.status),
  );
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
        <span className="brand">
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          评委评分席
        </span>
        <Connection connected={live.connected} />
      </header>
      <main>
        {!data ? (
          <ErrorBox error={live.error} />
        ) : (
          <>
            <div className="judge-welcome">
              <Badge status={data.settings.status}>
                {data.settings.mode === "test"
                  ? "测试评分"
                  : `正式比赛 · 第 ${data.settings.currentRound} / ${data.settings.rounds} 轮`}
              </Badge>
              <h1>评委 {String(data.judge.number).padStart(2, "0")}</h1>
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
                <p>{current.name}</p>
                {current.ownScore ? (
                  <div className="submitted-summary">
                    <CheckCircle2 size={36} />
                    <h3>评分已提交</h3>
                    <strong>
                      {fmt(current.ownScore.total / 100)}
                      <small>分</small>
                    </strong>
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
                          type="number"
                          inputMode="decimal"
                          required
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="0 – 100"
                          value={score}
                          onChange={(e) => {
                            setScore(e.target.value);
                            try {
                              localStorage.setItem(key, e.target.value);
                            } catch {}
                          }}
                        />
                      </Field>
                      <Button
                        kind="primary full-width"
                        disabled={busy || score === ""}
                        icon={Check}
                      >
                        {busy ? "正在提交…" : "提交评分"}
                      </Button>
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

function PresenterControls({ data, current, revealed, page, pages, refresh }) {
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
    setReason("现场重评");
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
      {pages > 1 && (
        <span className="presenter-page screen-pagination">
          {page + 1} / {pages}
        </span>
      )}
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
            <Field label={modal === "rejudge" ? "重评原因" : "裁定依据"}>
              <input
                required
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
  const page = manual ? data.settings.presentation.page || 0 : localPage;
  // Only paginate within the operator-selected stage; never switch award stages on a timer.
  const pageSize = view === "teamAwards" ? 3 : 8;
  const count =
    view === "ranking"
      ? data.ranking.length
      : view === "individualAwards"
        ? data.awards.length
        : view === "teamAwards"
          ? data.ranking.filter((p) => p.prize).length
          : 0;
  const pages = Math.max(1, Math.ceil(count / pageSize));
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
    const timer = setInterval(() => setPage((n) => (n + 1) % pages), 12000);
    return () => clearInterval(timer);
  }, [pages, view, manual]);
  const shown = {
    ...data,
    ranking:
      view === "teamAwards"
        ? data.ranking
            .filter((p) => p.prize)
            .slice((page % pages) * pageSize, ((page % pages) + 1) * pageSize)
        : data.ranking.slice(
            (page % pages) * pageSize,
            ((page % pages) + 1) * pageSize,
          ),
    awards: data.awards.slice(
      (page % pages) * pageSize,
      ((page % pages) + 1) * pageSize,
    ),
  };
  return (
    <div
      className={`screen-page stage-view stage-${view} ${presenter ? "presenter-screen" : ""}`}
    >
      <header>
        <span className="screen-event">
          <Activity size={24} aria-hidden="true" />
          {data.settings.title}
        </span>
        <div className="screen-tools">
          {!connected && <Connection connected={false} />}
        </div>
      </header>
      {data.settings.stage?.scene && data.settings.stage.scene !== "live" ? <StageCover data={data} /> : view === "project" ? (
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
      ) : (
        <div className="stage-results" key={view}>
          <h1 className="stage-heading">
            {displayViews.find(([id]) => id === view)?.[1]}
          </h1>
          <ResultsView data={shown} view={view} />
        </div>
      )}
      {presenter && (
        <PresenterControls
          data={data}
          current={current}
          page={page}
          pages={pages}
          refresh={refresh}
          revealed={
            !!current &&
            reveal?.signature === scoreSignature(current, data) &&
            reveal.ready
          }
        />
      )}
      {!presenter && pages > 1 && (
        <div className="screen-pagination">
          <span>
            {(page % pages) + 1} / {pages}
          </span>
        </div>
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
  let content;
  if (path === "/admin/ranking")
    content = <Ranking data={data} act={safeAct} />;
  else if (path === "/admin/display")
    content = <PresentationControls data={data} act={safeAct} />;
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

createRoot(document.getElementById("root")).render(
  location.pathname === "/judge" ? <JudgeApp /> : <App />,
);
