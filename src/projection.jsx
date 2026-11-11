import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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
    if (layout.hidden) return null;
    return <div className={`projection-layer layer-${key} ${className}`} style={{
      left: layout.x + "%", top: layout.y + "%", color: layout.color,
      "--text-size": layout.size,
      maxWidth: Math.min(94, 2 * Math.min(layout.x, 100 - layout.x)) + "%",
    }}>{children}</div>;
  }
  return <section className={`projection-board board-${view} ${version ? "with-artwork" : ""}`} aria-label={projectionNames[view]}
    style={version ? { backgroundImage: `url("/api/backgrounds/${kind}?v=${version}")` } : undefined}>
    {view === "home" ? <>
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

const colorPresets = ["#ffffff", "#ffe4a8", "#ffcf5c", "#cfe0f7", "#8ec5ff", "#103b75"];

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
  const isLayerHidden = (key) =>
    (edit && key === layer ? edit.hidden : getTextLayout(data.settings, view, key).hidden) === true;
  const update = (patch) => setEdit({ ...style, ...patch });
  async function save(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const { size, x, y, color, hidden } = style;
    try {
      await act(`/admin/display-layout/${view}/${layer}`, "PUT", { size, x, y, color, hidden: hidden === true });
      setEdit(null);
    } catch { /* The action notice displays the server error. */ }
    finally { setSaving(false); }
  }
  return <>
    <div className="layout-pickers">
      <div className="chip-row" role="group" aria-label="预览画面">
        <span className="chip-caption">预览画面</span>
        {Object.entries(projectionNames).map(([id, name]) =>
          <button type="button" key={id} className={`chip ${view === id ? "chip-active" : ""}`}
            aria-pressed={view === id} disabled={saving} onClick={() => {
              setView(id); setLayer("title"); setEdit(null); setPage(0);
            }}>{name}</button>)}
      </div>
      {slides.length > 1 && <label className="layout-page">预览页
        <select value={index} disabled={saving} onChange={e => setPage(Number(e.target.value))}>
          {slides.map((_, i) => <option key={i} value={i}>{i + 1} / {slides.length}</option>)}
        </select>
      </label>}
      {example && <small className="layout-sample-note">赛前排版使用示例数据</small>}
    </div>
    <ScreenPreview>
      <ProjectionBoard data={data} view={view} page={index} pages={slides.length} records={slides[index] || []}
        ResultsView={ResultsView} draft={edit && valid ? { layer, ...edit } : null} />
    </ScreenPreview>
    <form className="layout-form" onSubmit={save}>
      <fieldset disabled={saving} className={style.hidden ? "editing-hidden" : ""}>
        <legend>文字排版 · {displayLayouts[view][layer].label}</legend>
        <div className="chip-row" role="group" aria-label="文字项">
          <span className="chip-caption">文字项</span>
          {Object.entries(displayLayouts[view]).map(([key, def]) =>
            <button type="button" key={key}
              className={`chip ${layer === key ? "chip-active" : ""} ${isLayerHidden(key) ? "chip-dimmed" : ""}`}
              aria-pressed={layer === key} onClick={() => { setLayer(key); setEdit(null); }}>
              {isLayerHidden(key) ? <EyeOff size={13} /> : <Eye size={13} />}{def.label}
            </button>)}
        </div>
        <label className="layout-switch">
          <input type="checkbox" checked={!style.hidden} onChange={e => update({ hidden: !e.target.checked })} />
          <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
          显示此文字项
        </label>
        <div className="layout-sliders">
          {[["size", "字号（1920px 画布）", "字号滑杆", 12, 160],
            ["x", "水平位置（%）", "水平位置滑杆", 1, 99],
            ["y", "垂直位置（%）", "垂直位置滑杆", 1, 99]].map(([key, label, sliderLabel, min, max]) =>
            <div className="layout-slider" key={key}>
              <div className="layout-slider-head">
                <span>{label}</span>
                <input type="number" aria-label={label} required min={min} max={max}
                  value={style[key]} onChange={e => update({ [key]: e.target.value === "" ? "" : Number(e.target.value) })} />
              </div>
              <input type="range" aria-label={sliderLabel} min={min} max={max} step={1}
                value={Number.isInteger(style[key]) ? style[key] : min}
                onChange={e => update({ [key]: Number(e.target.value) })} />
            </div>)}
          <div className="layout-slider layout-color">
            <span className="layout-slider-head"><span>文字颜色</span></span>
            <div className="swatch-row" role="group" aria-label="颜色预设">
              {colorPresets.map(color =>
                <button type="button" key={color} className={`swatch-pill ${style.color === color ? "swatch-selected" : ""}`}
                  style={{ "--swatch": color }} aria-label={`预设颜色 ${color}`} aria-pressed={style.color === color}
                  onClick={() => update({ color })} />)}
              <label className="swatch-custom">文字颜色<input type="color" value={style.color} onChange={e => update({ color: e.target.value })} /></label>
            </div>
          </div>
        </div>
        <div className="layout-actions">
          <button className="button" type="button" onClick={() => setEdit(displayLayouts[view][layer])}>恢复默认排版</button>
          <button className="button primary" disabled={!edit || !valid}>保存此文字项</button>
        </div>
      </fieldset>
    </form>
  </>;
}
