// 配色主题：默认沿用竞衡蓝白，另一版为取自赛事主视觉的「数智警蓝」。
export const THEMES = [
  { id: "default", label: "竞衡蓝白", hint: "蓝白工作台，默认主题" },
  { id: "police", label: "数智警蓝", hint: "公安蓝 · 警徽金 · 数智青" },
];

const STORAGE_KEY = "jingheng-theme";
const DARK_COLOR = "#0b3e8f";
const LIGHT_COLOR = "#1c5143";

export function readTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.id === saved) ? saved : "default";
  } catch {
    return "default";
  }
}

export function applyTheme(id) {
  const root = document.documentElement;
  const known = THEMES.some((theme) => theme.id === id) ? id : "default";
  if (known === "default") root.removeAttribute("data-theme");
  else root.dataset.theme = known;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    if (known === "default") meta.setAttribute("content", LIGHT_COLOR);
    else meta.setAttribute("content", DARK_COLOR);
  }
  try {
    localStorage.setItem(STORAGE_KEY, known);
  } catch {
    /* 隐私模式下无法写入，主题只在本次会话生效。 */
  }
  return known;
}
