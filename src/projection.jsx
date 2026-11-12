import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { displayLayouts, getTextLayout } from "../shared/display-layout.js";
import { resultPages } from "../shared/slides.js";
import "./projection.css";

// 赛前示例数据：已录入的队伍 / 个人奖名单直接用于预览；名次与分数仍为示例
// （排名与团体奖依赖打分结果，赛前只能用示例成绩，但队伍和奖级名额是真实的）
export function previewResults(view, data) {
  if (view === "individualAwards" && data.awards?.length)
    return { ...sampleResults, awards: data.awards };
  if ((view === "ranking" || view === "teamAwards") && data.projects?.length) {
    const quotas = Array.isArray(data.settings?.prizes) && data.settings.prizes.length === 3
      ? data.settings.prizes
      : [1, 2, 3];
    const limits = [quotas[0], quotas[0] + quotas[1], quotas[0] + quotas[1] + quotas[2]];
    const ranking = data.projects.map((project, i) => ({
      id: project.id,
      name: project.name,
      team: project.team,
      members: project.members,
      rank: i + 1,
      // 按出场顺序套用真实奖项名额：前 N1 个一等奖、再 N2 个二等奖、再 N3 个三等奖
      prize: i < limits[0] ? 1 : i < limits[1] ? 2 : i < limits[2] ? 3 : 0,
      result: { complete: true, average: Math.max(60, 97.5 - i * 1.3) },
    }));
    return { ...sampleResults, ranking };
  }
  return sampleResults;
}

export const projectionNames = {
  home: "背景首页", ranking: "得分排名", teamAwards: "团体奖项", individualAwards: "个人奖项",
};

// Render the same canvas in the editor, presenter and read-only screen.
export function ProjectionBoard({ data, view, records, page = 0, pages = 1, draft, cardOffsets, ResultsView }) {
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
        <ResultsView
          data={{
            settings,
            cardOffsets: cardOffsets ?? settings.displayLayouts?.[view]?.cards?.offsets,
            ...(view === "individualAwards" ? { awards: records } : { ranking: records }),
          }}
          view={view} />
      </div>)}
    </>}
  </section>;
}

// 赛前预览与排版使用的示例数据：结构与真实名单一致（ID 为字符串），覆盖各奖级
export const sampleResults = {
  ranking: Array.from({ length: 8 }, (_, i) => ({
    id: `sample-team-${i}`,
    team: `第${"一二三四五六七八"[i]}代表队`,
    rank: i + 1,
    prize: i === 0 ? 1 : i < 3 ? 2 : 3,
    result: { complete: true, average: 97.5 - i * 1.5 },
    members: "示例队员甲、示例队员乙",
  })),
  awards: [
    { id: "sample-award-1", name: "数智攻坚单位", recipient: "王示例", level: 1 },
    { id: "sample-award-2", name: "数据侦查大队", recipient: "李示例", level: 2 },
    { id: "sample-award-3", name: "情报研判中心", recipient: "张示例", level: 2 },
    { id: "sample-award-4", name: "经侦一线支队", recipient: "赵示例", level: 3 },
    { id: "sample-award-5", name: "合成作战中心", recipient: "钱示例", level: 3 },
  ],
};

const colorPresets = ["#ffffff", "#ffe4a8", "#ffcf5c", "#cfe0f7", "#8ec5ff", "#103b75"];

export function LayoutPreview({ data, act, ScreenPreview, ResultsView }) {
  const [view, setView] = useState("home");
  const [layer, setLayer] = useState("title");
  const [edit, setEdit] = useState(null);
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cardId, setCardId] = useState(null);
  const [cardEdit, setCardEdit] = useState(null);
  const example = view !== "home" && data.settings.status !== "final";
  const exampleData = example ? previewResults(view, data) : data;
  const boardData = example ? { ...data, ...exampleData } : data;
  const slides = resultPages(exampleData, view);
  const index = Math.min(page, Math.max(0, slides.length - 1));
  const current = getTextLayout(data.settings, view, layer);
  const style = edit || current;
  const valid = ["size", "x", "y"].every(k => Number.isInteger(style[k])
    && style[k] >= (k === "size" ? 12 : 1) && style[k] <= (k === "size" ? 160 : 99));
  const isLayerHidden = (key) =>
    (edit && key === layer ? edit.hidden : getTextLayout(data.settings, view, key).hidden) === true;
  const update = (patch) => setEdit({ ...style, ...patch });
  const isAwardView = view === "teamAwards" || view === "individualAwards";
  const savedOffsets = data.settings.displayLayouts?.[view]?.cards?.offsets || {};
  const pageRecords = slides[index] || [];
  const cardName = (record) =>
    view === "teamAwards" ? record.team : record.recipient;
  const draftOffsets =
    cardId && cardEdit ? { ...savedOffsets, [cardId]: cardEdit } : savedOffsets;
  const selectCard = (id) => () => {
    setCardId(id);
    setCardEdit(id ? { dx: 0, dy: 0, ...(savedOffsets[id] || {}) } : null);
  };
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
  async function saveCard(e) {
    e.preventDefault();
    if (!cardId || !cardEdit || saving) return;
    if (!["dx", "dy"].every(k => Number.isInteger(cardEdit[k])
      && cardEdit[k] >= -30 && cardEdit[k] <= 30)) return;
    setSaving(true);
    try {
      await act(`/admin/display-layout/${view}/cards`, "PUT", {
        id: cardId, dx: cardEdit.dx || 0, dy: cardEdit.dy || 0,
      });
      setCardId(null);
      setCardEdit(null);
    } catch { /* The action notice displays the server error. */ }
    finally { setSaving(false); }
  }
  async function resetCards() {
    if (saving) return;
    setSaving(true);
    try { await act(`/admin/display-layout/${view}/cards`, "PUT", { reset: true }); }
    catch { /* The action notice displays the server error. */ }
    finally { setSaving(false); }
  }
  return <>
    <div className="layout-pickers">
      <div className="chip-row" role="group" aria-label="预览画面">
        <span className="chip-caption">预览画面</span>
        {Object.entries(projectionNames).map(([id, name]) =>
          <button type="button" key={id} className={`chip ${view === id ? "chip-active" : ""}`}
            aria-pressed={view === id} disabled={saving} onClick={() => {
              setView(id); setLayer("title"); setEdit(null); setPage(0); setCardId(null); setCardEdit(null);
            }}>{name}</button>)}
      </div>
      {slides.length > 1 && <label className="layout-page">预览页
        <select value={index} disabled={saving} onChange={e => {
          setPage(Number(e.target.value)); setCardId(null); setCardEdit(null);
        }}>
          {slides.map((_, i) => <option key={i} value={i}>{i + 1} / {slides.length}</option>)}
        </select>
      </label>}
      {example && (
        <small className="layout-sample-note">
          {view === "individualAwards" && data.awards?.length
            ? "使用已录入的个人奖项名单"
            : view !== "individualAwards" && data.projects?.length
              ? "使用已录入队伍与奖项名额，名次与分数为示例"
              : "赛前排版使用示例数据"}
        </small>
      )}
    </div>
    <ScreenPreview>
      <ProjectionBoard data={boardData} view={view} page={index} pages={slides.length} records={pageRecords}
        ResultsView={ResultsView} draft={edit && valid ? { layer, ...edit } : null} cardOffsets={draftOffsets} />
    </ScreenPreview>
    {isAwardView && (
      <form className="layout-form card-layout-form" onSubmit={saveCard}>
        <fieldset disabled={saving}>
          <legend>获奖卡片位置 · 每排自动居中，可单独微调</legend>
          <div className="chip-row" role="group" aria-label="选择卡片">
            <span className="chip-caption">卡片</span>
            <button type="button" className={`chip ${cardId === null ? "chip-active" : ""}`}
              aria-pressed={cardId === null} onClick={selectCard(null)}>自动排版</button>
            {pageRecords.map((record) =>
              <button type="button" key={record.id}
                className={`chip ${cardId === record.id ? "chip-active" : ""}`}
                aria-pressed={cardId === record.id} onClick={selectCard(record.id)}>
                {savedOffsets[record.id] ? "✥ " : ""}{cardName(record)}
              </button>)}
          </div>
          {cardId === null ? (
            <div className="layout-actions">
              <button className="button" type="button" disabled={!Object.keys(savedOffsets).length}
                onClick={resetCards}>恢复全部自动排版</button>
            </div>
          ) : (
            <>
              <div className="layout-sliders">
                {[["dx", "水平偏移（画面宽 %）", "卡片水平偏移滑杆", -20, 20],
                  ["dy", "垂直偏移（画面高 %）", "卡片垂直偏移滑杆", -15, 15]].map(([key, label, sliderLabel, min, max]) =>
                  <div className="layout-slider" key={key}>
                    <div className="layout-slider-head">
                      <span>{label}</span>
                      <input type="number" aria-label={label} required min={min} max={max}
                        value={cardEdit[key] ?? 0} onChange={e =>
                          setCardEdit({ ...cardEdit, [key]: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </div>
                    <input type="range" aria-label={sliderLabel} min={min} max={max} step={1}
                      value={Number.isInteger(cardEdit[key]) ? cardEdit[key] : 0}
                      onChange={e => setCardEdit({ ...cardEdit, [key]: Number(e.target.value) })} />
                  </div>)}
              </div>
              <div className="layout-actions">
                <button className="button" type="button" onClick={() => setCardEdit({ dx: 0, dy: 0 })}>偏移归零</button>
                <button className="button primary">保存卡片位置</button>
              </div>
            </>
          )}
        </fieldset>
      </form>
    )}
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
