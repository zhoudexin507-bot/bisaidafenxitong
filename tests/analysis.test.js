import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeJudges } from "../shared/analysis.js";
import { calculate } from "../server/scoring.js";
import { fixture } from "./helpers.js";

// —— 纯函数口径：3 评委 × 2 项目 × 1 轮，去 1 高 1 低 ——
const judges = [
  { id: "j1", name: "评委 01", title: "", enabled: 1, number: 1 },
  { id: "j2", name: "评委 02", title: "", enabled: 1, number: 2 },
  { id: "j3", name: "评委 03", title: "", enabled: 1, number: 3 },
];
const projects = [
  { id: "p1", name: "项目一", team: "一队", position: 1, status: "closed" },
  { id: "p2", name: "项目二", team: "二队", position: 2, status: "closed" },
];
const trimSettings = { trimEnabled: true, trimHigh: 1, trimLow: 1 };

test("analyzeJudges counts completion, trimming, leniency and submit order", () => {
  // 项目一：j1=80 j2=90 j3=100 → 收齐去极值：去 j1（低）j3（高），均值 90
  // 项目二：j2 缺评，j1=85 j3=95 → 未收齐不去极值，参照为已提交均值 90
  const entries = [
    { judge_id: "j1", project_id: "p1", round: 1, total: 8000, submitted_at: "2026-01-01T10:00:03Z" },
    { judge_id: "j2", project_id: "p1", round: 1, total: 9000, submitted_at: "2026-01-01T10:00:02Z" },
    { judge_id: "j3", project_id: "p1", round: 1, total: 10000, submitted_at: "2026-01-01T10:00:01Z" },
    { judge_id: "j1", project_id: "p2", round: 1, total: 8500, submitted_at: "2026-01-01T11:00:00Z" },
    { judge_id: "j3", project_id: "p2", round: 1, total: 9500, submitted_at: "2026-01-01T11:00:01Z" },
  ];
  const byProject = (id) => entries.filter((e) => e.project_id === id);
  const results = {
    "p1:1": calculate(byProject("p1"), trimSettings, judges.length),
    "p2:1": calculate(byProject("p2"), trimSettings, judges.length),
  };
  const analysis = analyzeJudges({ judges, projects, entries, results, rounds: 1 });

  assert.equal(analysis.expected, 2);
  assert.equal(analysis.totals.submitted, 5);
  assert.equal(analysis.totals.completionRate, 5 / 6); // 5 / (2 项目 × 3 评委)
  assert.equal(analysis.totals.trimmed, 2);

  const j1 = analysis.judges.find((j) => j.id === "j1");
  assert.equal(j1.submitted, 2);
  assert.equal(j1.completionRate, 1);
  assert.equal(j1.trimmedLow, 1);
  assert.equal(j1.trimmedHigh, 0);
  assert.equal(j1.keptRate, 0.5);
  // 偏差：p1 80−90=−10；p2 85−90=−5 → 宽严指数 −7.5
  assert.ok(Math.abs(j1.leniency + 7.5) < 1e-9);
  // 提交次序：p1 第 3、p2 第 1 → 平均 2
  assert.equal(j1.avgOrder, 2);

  const j2 = analysis.judges.find((j) => j.id === "j2");
  assert.equal(j2.submitted, 1);
  assert.deepEqual(j2.missing, [{ projectId: "p2", round: 1 }]);
  assert.equal(j2.trimmedTotal, 0);
  assert.equal(j2.keptRate, 1);
  assert.ok(Math.abs(j2.leniency) < 1e-9);

  const j3 = analysis.judges.find((j) => j.id === "j3");
  assert.equal(j3.trimmedHigh, 1);
  assert.equal(j3.keptRate, 0.5);
  assert.equal(j3.avgOrder, 1.5);

  const p1 = analysis.matrix.find((m) => m.id === "p1");
  assert.ok(Math.abs(p1.reference - 90) < 1e-9);
  assert.equal(p1.cells.find((c) => c.judgeId === "j3").rounds[0].trimmed, "high");
  assert.equal(p1.cells.find((c) => c.judgeId === "j1").rounds[0].trimmed, "low");
  const p2 = analysis.matrix.find((m) => m.id === "p2");
  assert.ok(Math.abs(p2.reference - 90) < 1e-9);
  assert.equal(p2.cells.find((c) => c.judgeId === "j2").submittedRounds, 0);
});

test("analysis endpoint aggregates entries per phase and survives publish", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jh-analysis-"));
  const f = await fixture(t, { dbPath: join(dir, "db.sqlite") });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { request, ok, state, configure, complete, rehearse } = f;
  await f.login();
  await configure({ judgeCount: 3, projectCount: 2, rounds: 1, prizes: [1, 1, 0] });
  await rehearse(); // 测试阶段：第一项目 80 / 90 / 100

  const testPhase = (await request("/admin/analysis?phase=test")).data;
  assert.equal(testPhase.phase, "test");
  assert.equal(testPhase.rounds, 1);
  assert.equal(testPhase.expected, 2);
  assert.equal(testPhase.totals.submitted, 3);
  assert.equal(testPhase.totals.completionRate, 0.5);
  // 80 与 100 各被去一次，90 分评委入选
  assert.equal(testPhase.judges.filter((j) => j.trimmedTotal === 1).length, 2);
  assert.equal(testPhase.judges.filter((j) => j.keptRate === 1).length, 1);

  // 正式阶段：两项目全部收齐并发布
  await ok("/admin/status", "POST", { status: "running" });
  for (const [i, p] of (await state()).projects.entries()) {
    await ok(`/admin/projects/${p.id}/status`, "POST", { status: "open" });
    // 两队分差不同，避免触发同分顺序确认
    await complete(p.id, i === 0 ? [70, 85, 90] : [72, 86, 90]);
    await ok(`/admin/projects/${p.id}/status`, "POST", { status: "closed" });
  }
  await ok("/admin/status", "POST", { status: "final" });

  const official = (await request("/admin/analysis")).data;
  assert.equal(official.phase, "official");
  assert.equal(official.totals.submitted, 6);
  assert.equal(official.totals.completionRate, 1);
  assert.equal(official.matrix.length, 2);
  assert.equal(official.matrix[0].cells.length, 3);
  assert.ok(official.matrix.every((p) => p.reference != null));

  // 发布后仍可逐队切换比赛画面（回看评分画面依赖此能力）
  assert.equal(
    (
      await ok("/admin/presentation", "POST", {
        view: "project",
        projectId: official.matrix[1].id,
      })
    ).ok,
    true,
  );
  const published = await state();
  assert.equal(published.settings.presentation.projectId, official.matrix[1].id);
});
