import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { domToBlob } from "modern-screenshot";
import { ProjectionBoard } from "./projection.jsx";
import { resultPages, awardLevelNames } from "../shared/slides.js";
import { zipStore } from "./zip.js";

// —— 后台画面图片导出：统一走 1920×1080 离屏画板，产出与现场大屏一致的海报成品 ——
// foreignObject 方案（modern-screenshot）由浏览器原生渲染克隆 DOM，
// 容器查询单位、红金渐变与自定义背景图均与投屏完全一致；字体与背景图
// 同源 fetch 后内联为 data: URL，不触碰服务端 CSP 配置。

const BOARD_WIDTH = 1920;
const BOARD_HEIGHT = 1080;

// 各页文件名与后台翻页下拉的页标签保持同一套口径
function boardPageName(view, page, slides, viewName) {
  const records = slides[page];
  if (view === "teamAwards" && records?.[0]?.prize)
    return `${viewName}-${["", "一等奖", "二等奖", "三等奖"][records[0].prize]}.png`;
  if (view === "individualAwards" && records?.[0])
    return `${viewName}-${awardLevelNames[records[0].level || 0]}.png`;
  return slides.length > 1
    ? `${viewName}-第${page + 1}页.png`
    : `${viewName}.png`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 截取任意已渲染 DOM 节点（如分析页报表区），默认 2 倍分辨率保证打印清晰
export async function exportNode(node, filename, { scale = 2 } = {}) {
  if (!node) throw new Error("未找到可导出的内容");
  const blob = await domToBlob(node, {
    scale,
    backgroundColor: "#f5f6f7",
  });
  if (!blob) throw new Error("生成图片失败，请重试");
  downloadBlob(blob, filename);
}

// 等待离屏画板完成布局、字体与入场动画，保证截到的是最终画面
async function settle(host) {
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  try {
    await document.fonts.ready;
  } catch {
    // 字体状态不可用时按当前渲染继续
  }
  const animations = host.getAnimations({ subtree: true });
  if (animations.length) {
    await Promise.race([
      Promise.all(animations.map((a) => a.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function Mounted({ onReady, children }) {
  useEffect(() => {
    onReady();
  });
  return <>{children}</>;
}

// foreignObject 栅格化时系统字体度量可能与页面实测不同：克隆里烘焙的
// max-content 宽高按页面字体量出，栅格化用另一套字形就会偏窄，导致标题
// 断行、名单换行。克隆不携带原始样式表（删除行内属性即回到初始值），
// 因此按「解开盒尺寸 + 恢复关键弹性布局定义」的方式重建可回流的结构。
const BOX_PROPS = ["width", "height", "inline-size", "block-size"];
const unpinBox = (el) => {
  for (const prop of BOX_PROPS) el.style.removeProperty(prop);
};

function unpinFlowSizes(clone) {
  for (const layer of clone.querySelectorAll(".projection-layer")) {
    const isContent = layer.classList.contains("layer-content");
    const inset = layer.style.getPropertyValue("inset").trim();
    for (const prop of ["inset", "inset-inline", "inset-block", ...BOX_PROPS])
      layer.style.removeProperty(prop);
    // 烘焙的 inset 记录了页面实测定位（top right bottom left），换算回百分比
    const numbers = inset.split(/\s+/).map((p) => parseFloat(p) || 0);
    if (numbers.length >= 4) {
      layer.style.left = `${(numbers[3] / BOARD_WIDTH) * 100}%`;
      layer.style.top = `${(numbers[0] / BOARD_HEIGHT) * 100}%`;
    }
    if (isContent) {
      // 内容层若失去原始的 84% 定宽，绝对定位收缩适配会一路塌缩到
      // min-content（overflow-wrap: anywhere 时窄到一个字），列表必然竖排。
      layer.style.setProperty("width", "84%");
      layer.style.setProperty("overflow", "hidden");
    }
    // 层内标题与文本解开烘焙盒尺寸，按图内字体重新排版
    for (const el of layer.querySelectorAll("h1, h2, h3, p, .screen-event"))
      unpinBox(el);
  }
  // 榜单网格：烘焙轨道是按页面字体解析的定宽 px，恢复弹性定义重新量宽
  for (const standings of clone.querySelectorAll(".standings")) {
    standings.style.setProperty("grid-template-columns", "2.6em auto 5em");
    standings.style.setProperty("width", "max-content");
    standings.style.removeProperty("grid-template-rows");
    for (const row of standings.querySelectorAll(".standing-row")) {
      row.style.setProperty("grid-template-columns", "subgrid");
      unpinBox(row);
      for (const el of row.querySelectorAll("*")) unpinBox(el);
    }
  }
  for (const el of clone.querySelectorAll(
    ".stage-results, .team-honors, .team-honor, .honor-rows, .honor-row, .honor-winner, .personal-honor",
  ))
    unpinBox(el);
}

async function captureBoardPage(data, view, slides, page, ResultsView) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${BOARD_WIDTH}px;height:${BOARD_HEIGHT}px;overflow:hidden;`;
  document.body.appendChild(host);
  let ready;
  const mounted = new Promise((resolve) => {
    ready = resolve;
  });
  const root = createRoot(host);
  root.render(
    <Mounted onReady={ready}>
      <ProjectionBoard
        data={{
          ...data,
          // 静帧导出:不沿用评审中/入场中的交互态标记
          settings: {
            ...data.settings,
            presentation: { ...data.settings.presentation, reviewing: false },
          },
        }}
        view={view}
        records={slides[page]}
        page={page}
        pages={slides.length}
        ResultsView={ResultsView}
      />
    </Mounted>,
  );
  try {
    await mounted;
    await settle(host);
    const blob = await domToBlob(host.firstElementChild, {
      scale: 2,
      backgroundColor: "#12283c",
      onCloneNode: unpinFlowSizes,
    });
    if (!blob) throw new Error("生成图片失败，请重试");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    root.unmount();
    host.remove();
  }
}

// 导出某个展示视图的全部页面：单页直接下载 PNG，多页打包 ZIP
export async function exportBoards(data, view, viewName, ResultsView) {
  const slides = resultPages(data, view);
  if (!slides.length) throw new Error("暂无可导出的内容，请先完成评分");
  const files = [];
  for (let page = 0; page < slides.length; page++) {
    files.push({
      name: boardPageName(view, page, slides, viewName),
      bytes: await captureBoardPage(data, view, slides, page, ResultsView),
    });
  }
  if (files.length === 1)
    downloadBlob(
      new Blob([files[0].bytes], { type: "image/png" }),
      files[0].name,
    );
  else
    downloadBlob(zipStore(files), `${viewName}图片包.zip`);
}

// 导出按钮的统一 busy / 报错状态（页面自行决定用何种按钮样式呈现）
export function useImageExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (task) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await task();
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  return { busy, error, run };
}
