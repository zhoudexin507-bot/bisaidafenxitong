import { isScoreReleased } from "./stage.js";
import { resultPages, resultViews } from "../shared/slides.js";
// A single forward action is derived from the persisted competition state.
export function pageCount(data, view) {
  return Math.max(1, resultPages(data, view).length);
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
    const view = s.presentation.view,
      page = s.presentation.page || 0;
    if (view === "project")
      return step("view", "展示得分排名", { view: "ranking", page: 0 });
    if (page < pageCount(data, view) - 1)
      return step("view", "下一页", { view, page: page + 1 });
    const views = resultViews(data);
    const following = views[views.indexOf(view) + 1];
    if (following)
      return step("view", following === "teamAwards" ? "展示团体奖项" : "展示个人奖项", { view: following, page: 0 });
    return step("done", "展示完毕", { enabled: false });
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
    if (s.mode === "test")
      return step("finishTest", "完成测试，准备正式比赛", {
        projectId: active.id,
        waitForReveal: true,
      });
  }
  if (s.mode === "test" && data.projects.some((p) => p.result.complete))
    return step("finishTest", "完成测试，准备正式比赛");
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
