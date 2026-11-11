import React, { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Clock3, ExternalLink, Monitor, Pause, Play, RotateCw, Users } from "lucide-react";
import { resultViews } from "../shared/slides.js";
import "./live-desk.css";

export function StageClock({ stage, serverTime }) {
  const remaining = stage.endsAt ? stage.endsAt - Date.parse(serverTime) : stage.remainingMs || 0;
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil(remaining / 1000)));
  useEffect(() => {
    const deadline = Date.now() + remaining;
    let timer;
    function tick() {
      const ms = Math.max(0, deadline - Date.now());
      setSeconds(Math.ceil(ms / 1000));
      if (stage.endsAt && ms > 0) timer = setTimeout(tick, ms % 1000 || 1000);
    }
    tick();
    return () => clearTimeout(timer);
  }, [stage.endsAt, remaining]);
  return <div className="stage-clock">
    <strong aria-label={`剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}>
      {String(Math.floor(seconds / 60)).padStart(2, "0")}<span>:</span>{String(seconds % 60).padStart(2, "0")}
    </strong>
    <span>{!seconds && stage.endsAt ? "时间到 · 等待继续" : stage.endsAt ? "距离继续还有" : "倒计时未运行"}</span>
  </div>;
}

export function StageCover({ data }) {
  const stage = data.settings.stage;
  return (
    <section className={`stage-cover cover-${stage.scene}`}>
      <div className="stage-cover-mark" aria-hidden="true"><Monitor /></div>
      <h1>{stage.scene === "break" ? "中场休息" : "比赛即将开始"}</h1>
      {stage.message && <p>{stage.message}</p>}
      {(stage.remainingMs > 0 || stage.endsAt) && <StageClock stage={stage} serverTime={data.serverTime} />}
    </section>
  );
}

export function StageControls({ data, act }) {
  const stage = data.settings.stage || { scene: "live", version: 0, remainingMs: 0 };
  const [message, setMessage] = useState(stage.message || "");
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMessage(stage.message || ""), [stage.message]);
  async function send(command) {
    if (busy) return;
    setBusy(true);
    try { await act("/admin/stage", "POST", { ...command, version: stage.version }); }
    catch { /* The shared action notice reports the server error. */ }
    finally { setBusy(false); }
  }
  async function showView(view, projectId) {
    if (busy) return;
    setBusy(true);
    try { await act("/admin/presentation", "POST", projectId ? { view, projectId } : { view }); }
    catch { /* The shared action notice reports the server error. */ }
    finally { setBusy(false); }
  }
  const final = data.settings.status === "final";
  // 测试阶段全部收齐后同样可切排名与颁奖画面（收官预演）
  const testCeremonyReady =
    data.settings.mode === "test" && data.projects.every((p) => p.result.complete);
  const awardsReady = final || testCeremonyReady;
  const live = stage.scene === "live";
  const view = data.settings.presentation.view;
  const showingProject = live && view === "project";
  // “比赛画面”同时收 scene 与展示页：从颁奖页返回时恢复当前队伍计分板。
  async function backToLive() {
    const project = data.projects.find((p) => p.id === data.settings.presentation.projectId)
      || data.projects.find((p) => ["ready", "open"].includes(p.status))
      || data.projects[0];
    if (!live) await send({ action: "scene", scene: "live", message: "", seconds: 0 });
    if (data.settings.presentation.view !== "project" && project)
      await showView("project", project.id);
  }
  const awardViews = [["ranking", "得分排名"], ["teamAwards", "团体奖项"], ["individualAwards", "个人奖项"]];
  const nextView = awardsReady
    ? resultViews(data)[resultViews(data).indexOf(view) + 1]
    : undefined;
  const validMinutes = minutes !== "" && Number.isFinite(Number(minutes)) && Number(minutes) >= 0 && Number(minutes) <= 120;
  return <section className="director-tools" aria-labelledby="stage-control-title">
    <div className="desk-heading"><h2 id="stage-control-title">现场画面</h2>
      <span>切换后立即生效</span>
    </div>
    <div className="scene-group">
      <span className="scene-group-label">大屏场景</span>
      <div className="scene-switch" role="group" aria-label="大屏场景">
        {[["live", "比赛画面"], ["home", "背景首页"], ["standby", "开场候场"], ["break", "中场休息"]].map(([scene, label]) => {
          const pressed = scene === "live" ? showingProject : stage.scene === scene;
          const timed = !["live", "home"].includes(scene);
          return <button key={scene} className={`button ${pressed ? "primary" : ""}`} aria-pressed={pressed}
            disabled={busy || pressed || (timed && !validMinutes)}
            onClick={() => scene === "live"
              ? backToLive()
              : send({ action: "scene", scene, message: timed ? message : "", seconds: timed ? Math.round(Number(minutes) * 60) : 0 })}>{label}</button>;
        })}
      </div>
    </div>
    <div className="scene-group scene-group-awards">
      <span className="scene-group-label">
        {final
          ? "排名与颁奖"
          : testCeremonyReady
            ? "排名与颁奖 · 测试预演"
            : "排名与颁奖 · 发布后可用"}
      </span>
      <div className="scene-switch" role="group" aria-label="排名与颁奖投屏">
        {awardViews.map(([id, label]) =>
          <button key={id} className={`button ${live && view === id ? "primary" : ""}`} aria-pressed={live && view === id}
            disabled={busy || !awardsReady} onClick={() => showView(id)}>{label}</button>)}
      </div>
      {awardsReady && nextView && <button className="button primary scene-next" disabled={busy} onClick={() => showView(nextView)}>
        <ArrowRight size={15} />下一步：{awardViews.find(([id]) => id === nextView)?.[1]}
      </button>}
    </div>
    <div className="stage-inputs">
      <label className="field"><span>候场 / 休息提示</span><input maxLength={100} value={message} placeholder="例如：请评委就座，比赛即将开始" onChange={(e) => setMessage(e.target.value)} /></label>
      <label className="field"><span>倒计时（分钟）</span><input type="number" min="0" max="120" step="0.5" value={minutes} aria-invalid={!validMinutes} aria-describedby={!validMinutes ? "stage-minutes-error" : undefined} onChange={(e) => setMinutes(e.target.value)} />
        {!validMinutes && <small id="stage-minutes-error" className="timer-field-error">请输入 0–120 分钟</small>}
      </label>
    </div>
    {!["live", "home"].includes(stage.scene) && <div className="timer-controls">
      <StageClock stage={stage} serverTime={data.serverTime} />
      <div className="actions">
        <button className="button" disabled={busy || !validMinutes} onClick={() => send({ action: "scene", scene: stage.scene, message, seconds: Math.round(Number(minutes) * 60) })}>更新画面与时长</button>
        <button className="button primary" disabled={busy || (!stage.endsAt && !stage.remainingMs)} onClick={() => send({ action: stage.endsAt ? "pause" : "start" })}>
          {stage.endsAt ? <Pause size={16} /> : <Play size={16} />}{stage.endsAt ? "暂停倒计时" : "开始 / 继续计时"}</button>
        <button className="button" disabled={busy || !validMinutes} onClick={() => send({ action: "reset", seconds: Math.round(Number(minutes) * 60) })}><RotateCw size={16} />重置计时</button>
      </div>
    </div>}
    <p className="desk-note">切换画面不改变收分状态；停止收分请暂停比赛。</p>
  </section>;
}

export function LiveDesk({ data, act }) {
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = data.projects.find((p) => ["ready", "open"].includes(p.status));
  const next = data.projects.find((p) => p.status === "pending" && p.id !== current?.id);
  const online = data.judges.filter((j) => j.online).length;
  const valid = data.judges.length > 0 && data.judges.every((j) => j.enabled && j.expires_at > Date.parse(data.serverTime));
  const checks = [
    { title: "参赛名单", detail: `${data.projects.length} 支队伍`, ok: data.projects.length > 0, href: "/admin/projects" },
    { title: "评委凭证", detail: valid ? "全部可用" : "检查停用或过期凭证", ok: valid, href: "/admin/judges" },
    { title: "计分与奖项", detail: `${data.settings.rounds} 轮 · 百分制`, ok: data.projects.length > 0 && data.judges.length > (data.settings.trimEnabled ? data.settings.trimHigh + data.settings.trimLow : 0) && data.settings.prizes.reduce((a, b) => a + b, 0) <= data.projects.length, href: "/admin/rules" },
    { title: "赛前测试", detail: data.settings.testCompleted ? "已完成" : "请在投屏演示中测试", ok: data.settings.testCompleted, href: "/admin/present" },
  ];
  const seats = all ? data.judges : data.judges.slice(0, 12);
  return <div className="live-desk">
    {data.settings.status === "draft" && <section className="preflight" aria-labelledby="preflight-title">
      <div className="desk-heading"><h2 id="preflight-title">赛前检查</h2><span>{checks.filter((c) => c.ok).length} / {checks.length} 项就绪</span></div>
      <div className="preflight-list">{checks.map((c) => <a key={c.title} href={c.href}>
        {c.ok ? <CheckCircle2 size={20} /> : <Circle size={20} />}<div><strong>{c.title}</strong><span>{c.detail}</span></div>
      </a>)}</div>
      <label className="reveal-choice"><span><strong>成绩揭晓方式</strong><small>赛前设置，开赛后锁定</small></span>
        <select aria-label="成绩揭晓方式" value={data.settings.revealMode || "auto"} disabled={saving} onChange={async (e) => {
          setSaving(true);
          try { await act("/admin/reveal-mode", "PUT", { mode: e.target.value }); } catch { /* Shared notice. */ } finally { setSaving(false); }
        }}><option value="auto">收齐后自动亮分</option><option value="manual">主持人确认后亮分</option></select>
      </label>
    </section>}
    <section className="judge-watch" aria-labelledby="judge-watch-title">
      <div className="desk-heading"><h2 id="judge-watch-title"><Users size={19} />评委席状态</h2><span>{online} / {data.judges.length} 席近期在线</span></div>
      {data.judges.length ? <div className="seat-list">{seats.map((j) => {
        const submitted = current?.scores.some((s) => s.judge_id === j.id);
        const invalid = !j.enabled || j.expires_at <= Date.parse(data.serverTime);
        return <div key={j.id} className={`seat ${submitted ? "seat-submitted" : ""}`}>
          <strong>评委 {String(j.number).padStart(2, "0")}</strong>
          <span>{invalid ? "凭证不可用" : j.online ? "近期在线" : j.lastSeen ? "连接待确认" : "尚未连接"}</span>
          {data.settings.status !== "final" && <small>{submitted ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{submitted ? "已提交" : current?.status === "open" ? "待提交" : "待评分"}</small>}
        </div>;
      })}</div> : <p className="desk-note">配置评委席位后，可在这里查看连接与提交情况。</p>}
      {data.judges.length > 12 && <button className="button" onClick={() => setAll(!all)}>{all ? "收起席位" : `查看全部 ${data.judges.length} 席`}</button>}
      <div className="desk-footer"><a href="/admin/judges">管理评委与二维码</a></div>
    </section>
    {data.settings.status !== "final" && next && <div className="next-cue"><span>下一支候场队伍</span><strong>{String(next.position).padStart(2, "0")} · {next.team}</strong><a href="/admin/display">现场画面与倒计时 <ExternalLink size={14} /></a></div>}
  </div>;
}
