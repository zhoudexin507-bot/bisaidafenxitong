import React, { useState } from "react";
import { displayLayouts, getTextLayout } from "../shared/display-layout.js";
import { resultPages } from "../shared/slides.js";
import "./projection.css";

export const projectionNames = {
  home: "背景首页", ranking: "得分排名", teamAwards: "团体奖项", individualAwards: "个人奖项",
};

// Render the same canvas in the editor, presenter and read-only screen.
export function ProjectionBoard({ data, view, records, page = 0, pages = 1, draft, ResultsView }) {
  const settings = data.settings;
  const kind = view === "home" ? "home" : "awards";
  const version = data.backgrounds?.[kind];
  function layer(key, children, className = "") {
    const layout = draft?.layer === key ? draft : getTextLayout(settings, view, key);
    return <div className={`projection-layer layer-${key} ${className}`} style={{
      left: layout.x + "%", top: layout.y + "%", color: layout.color,
      "--text-size": layout.size,
      maxWidth: Math.min(94, 2 * Math.min(layout.x, 100 - layout.x)) + "%",
    }}>{children}</div>;
  }
  return <section className={`projection-board board-${view} ${version ? "with-artwork" : ""}`} aria-label={projectionNames[view]}
    style={version ? { backgroundImage: `url("/api/backgrounds/${kind}?v=${version}")` } : undefined}>
    {view === "home" ? settings.showHomeTitle !== false && <>
      {layer("title", <h1>{settings.title}</h1>)}
      {settings.subtitle && layer("subtitle", <p>{settings.subtitle}</p>)}
    </> : <>
      {layer("event", <div className="screen-event">{settings.title}</div>)}
      {layer("title", <h1 className="stage-heading">{projectionNames[view]}</h1>, "screen-tools")}
      {layer("content", <div key={view + page} className={`stage-results ${settings.presentation.reviewing ? "reviewing" : "entering"}`}>
        <ResultsView data={view === "individualAwards" ? { awards: records } : { ranking: records }} view={view} />
      </div>)}
      {pages > 1 && layer("page", <span>{page + 1} / {pages}</span>, "screen-pagination")}
    </>}
  </section>;
}

const sampleResults = {
  ranking: ["第一代表队", "第二代表队", "第三代表队"].map((team, i) => ({
    id: i, team, rank: i + 1, prize: i + 1, result: { complete: true, average: 98 - i }, members: "示例队员",
  })),
  awards: [{ id: 1, name: "示例单位", recipient: "示例获奖人" }],
};

export function LayoutPreview({ data, act, ScreenPreview, ResultsView }) {
  const [view, setView] = useState("home");
  const [layer, setLayer] = useState("title");
  const [edit, setEdit] = useState(null);
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const example = view !== "home" && data.settings.status !== "final";
  const slides = resultPages(example ? sampleResults : data, view);
  const index = Math.min(page, Math.max(0, slides.length - 1));
  const current = getTextLayout(data.settings, view, layer);
  const style = edit || current;
  const valid = ["size", "x", "y"].every(k => Number.isInteger(style[k])
    && style[k] >= (k === "size" ? 12 : 1) && style[k] <= (k === "size" ? 160 : 99));
  async function save(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const { size, x, y, color } = style;
    try {
      await act(`/admin/display-layout/${view}/${layer}`, "PUT", { size, x, y, color });
      setEdit(null);
    } catch { /* The action notice displays the server error. */ }
    finally { setSaving(false); }
  }
  return <>
    <div className="layout-pickers">
      <label>预览画面<select value={view} disabled={saving} onChange={e => {
        setView(e.target.value); setLayer("title"); setEdit(null); setPage(0);
      }}>{Object.entries(projectionNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {example && <small>赛前排版使用示例数据</small>}
      {slides.length > 1 && <label>预览页<select value={index} onChange={e => setPage(Number(e.target.value))}>
        {slides.map((_, i) => <option key={i} value={i}>{i + 1} / {slides.length}</option>)}
      </select></label>}
    </div>
    <ScreenPreview>
      <ProjectionBoard data={data} view={view} page={index} pages={slides.length} records={slides[index] || []}
        ResultsView={ResultsView} draft={edit && valid ? { layer, ...edit } : null} />
    </ScreenPreview>
    <form className="layout-form" onSubmit={save}>
      <fieldset disabled={saving}>
        <legend>文字排版</legend>
        <label>文字项<select value={layer} onChange={e => { setLayer(e.target.value); setEdit(null); }}>
          {Object.entries(displayLayouts[view]).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select></label>
        {[["size", "字号（1920px 画布）"], ["x", "水平位置（%）"], ["y", "垂直位置（%）"]].map(([key, label]) =>
          <label key={key}>{label}<input type="number" required min={key === "size" ? 12 : 1} max={key === "size" ? 160 : 99}
            value={style[key]} onChange={e => setEdit({ ...style, [key]: e.target.value === "" ? "" : Number(e.target.value) })} /></label>)}
        <label>文字颜色<input type="color" value={style.color} onChange={e => setEdit({ ...style, color: e.target.value })} /></label>
        <button className="button" type="button" onClick={() => setEdit(displayLayouts[view][layer])}>恢复默认排版</button>
        <button className="button primary" disabled={!edit || !valid}>保存此文字项</button>
      </fieldset>
    </form>
  </>;
}
