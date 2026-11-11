import { isScoreReleased } from "./stage.js";
import { resultPages, resultViews } from "../shared/slides.js";
// A single forward action is derived from the persisted competition state.
export function pageCount(data, view) {
  return Math.max(1, resultPages(data, view).length);
}

// 排名 / 团体奖项 / 个人奖项的推进逻辑，正式发布与测试预演共用。
// 返回 null 表示全部视图已翻完。
function ceremonyNext(data, s, step) {
  const view = s.presentation.view,
    page = s.presentation.page || 0;
  if (page < pageCount(data, view) - 1)
    return step("view", "下一页", { view, page: page + 1 });
  const views = resultViews(data);
  const following = views[views.indexOf(view) + 1];
  if (following)
    return step(
      "view",
      following === "teamAwards" ? "展示团体奖项" : "展示个人奖项",
      { view: following, page: 0 },
    );
  return null;
}

export function nextSlide(data) {
  const s = data.settings;
  const step = (type, label, extra = {}) => ({
    type,
    label,
    enabled: true,
    ...extra,
  });
  if (s.stage && s.stage.scene !== "live")
    return step("returnStage", "返回比赛画面");
  if (s.status === "final") {
    if (s.presentation.view === "project")
      return step("view", "展示得分排名", { view: "ranking", page: 0 });
    return (
      ceremonyNext(data, s, step) ?? step("done", "展示完毕", { enabled: false })
    );
  }
  if (!data.projects.length || !data.judges.length)
    return step("setup", "请先配置比赛", { enabled: false });
  if (s.status === "draft")
    return s.testCompleted
      ? step("startOfficial", "进入正式比赛")
      : step("startTest", "开始测试评分");
  if (s.status === "paused") return step("resume", "继续评分");
  const active = data.projects.find((p) =>
    ["open", "ready"].includes(p.status),
  );
  if (active) {
    if (active.status === "ready")
      return step("open", "开始评分", { projectId: active.id });
    if (!active.result.complete)
      return step(
        "waiting",
        `等待评分 ${active.scores.length} / ${data.judges.length}`,
        { enabled: false, projectId: active.id },
      );
    if (!isScoreReleased(s, active))
      return step("reveal", "公布本队成绩", { projectId: active.id });
  }
  if (s.mode === "test") {
    // 全部收齐后进入收官预演：同分裁定 → 测试排名 → 团体奖项 → 个人奖项 → 完成测试。
    // 未收齐时保持“完成测试”提前结束，正式当天的既有习惯不变。
    if (data.projects.every((p) => p.result.complete)) {
      if (data.ranking.some((p) => p.tieUnresolved))
        return step("tie", "确认同分名次", { waitForReveal: !!active });
      if (s.presentation.view === "project")
        return step("publishTest", "展示测试排名（预演）", {
          closeId: active?.id,
          waitForReveal: !!active,
        });
      return (
        ceremonyNext(data, s, step) ??
        step("finishTest", "完成测试，准备正式比赛")
      );
    }
    return step(
      "finishTest",
      "完成测试，准备正式比赛",
      active ? { projectId: active.id, waitForReveal: true } : {},
    );
  }
  const pending = data.projects.find((p) => p.status === "pending");
  if (pending)
    return step("prepare", `下一队：${pending.team}`, {
      projectId: pending.id,
      closeId: active?.id,
      waitForReveal: !!active,
    });
  if (data.projects.some((p) => !p.result.complete))
    return step("waiting", "等待全部评分完成", { enabled: false });
  if (s.currentRound < s.rounds)
    return step("round", `进入第 ${s.currentRound + 1} 轮`, {
      closeId: active?.id,
      waitForReveal: !!active,
    });
  if (data.ranking.some((p) => p.tieUnresolved))
    return step("tie", "确认同分名次", { waitForReveal: !!active });
  return step("publish", "展示最终排名", {
    closeId: active?.id,
    waitForReveal: !!active,
  });
}
