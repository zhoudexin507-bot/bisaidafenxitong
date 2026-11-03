import { createHash } from "node:crypto";

export const defaultStage = { scene: "live", message: "", remainingMs: 0, endsAt: null, version: 0 };

export function scoreReleaseKey(settings, project) {
  return createHash("sha256").update(JSON.stringify([
    settings.epoch, settings.mode, settings.currentRound, project.id,
    project.scores.map(({ judge_id, total, submitted_at }) => [judge_id, total, submitted_at]),
  ])).digest("hex");
}

export function isScoreReleased(settings, project) {
  return settings.revealMode !== "manual" || settings.status === "final" ||
    settings.releasedScores?.[project.id] === scoreReleaseKey(settings, project);
}

export function changeStage(settings, command, now = Date.now()) {
  const previous = { ...defaultStage, ...settings.stage };
  const stage = { ...previous, version: previous.version + 1 };
  if (command.action === "scene") {
    stage.scene = command.scene;
    stage.message = command.message || "";
    stage.remainingMs = (command.seconds || 0) * 1000;
    stage.endsAt = null;
  } else if (command.action === "start") {
    if (!stage.endsAt && stage.remainingMs > 0) stage.endsAt = now + stage.remainingMs;
  } else if (command.action === "pause") {
    stage.remainingMs = stage.endsAt ? Math.max(0, stage.endsAt - now) : stage.remainingMs;
    stage.endsAt = null;
  } else if (command.action === "reset") {
    stage.remainingMs = command.seconds * 1000;
    stage.endsAt = null;
  }
  // Stage covers are independent of the selected project/page, and never publish scores.
  return { ...settings, stage };
}
