import test from "node:test";
import assert from "node:assert/strict";
import { calculate, rankProjects, csvCell } from "../server/scoring.js";
const settings = {
  trimEnabled: true,
  trimHigh: 1,
  trimLow: 1,
  prizes: [1, 1, 1],
};
const scores = (numbers) =>
  numbers.map((total, i) => ({ judge_id: String(i), total }));
test("trim exact counts, including tied extreme scores", () => {
  const result = calculate(
    scores([8000, 8000, 9000, 9000, 10000]),
    settings,
    5,
  );
  assert.equal(result.average, 86.66666666666666);
  assert.equal(result.dropped.length, 2);
  assert.equal(result.complete, true);
});
test("incomplete submissions show untrimmed provisional average", () => {
  const result = calculate(scores([0, 10000]), settings, 5);
  assert.equal(result.average, 50);
  assert.equal(result.complete, false);
  assert.deepEqual(result.dropped, []);
});
test("disabled trimming preserves all scores and zero is a valid score", () => {
  assert.equal(
    calculate(scores([0, 5000, 10000]), { ...settings, trimEnabled: false }, 3)
      .average,
    50,
  );
  assert.equal(calculate([], settings, 0).average, null);
});
test("configurable asymmetric trim", () => {
  const result = calculate(
    scores([1000, 2000, 3000, 4000, 5000]),
    { ...settings, trimLow: 0, trimHigh: 2 },
    5,
  );
  assert.equal(result.average, 20);
  assert.equal(result.count, 3);
});
test("fixed quotas with unresolved ties withheld", () => {
  const projects = [9000, 9000, 8999, 5000].map((score, i) => ({
    id: String(i),
    position: i,
    result: calculate(scores([score, score, score]), settings, 3),
  }));
  projects.push({ id: "pending", result: { complete: false } });
  assert.deepEqual(
    rankProjects(projects, settings).map((p) => [p.rank, p.prize]),
    [
      [1, null],
      [2, null],
      [3, 3],
      [4, null],
    ],
  );
});
test("ranking does not accidentally tie different fractions with same displayed value", () => {
  const projects = [
    { id: "a", position: 1, result: { complete: true, sum: 27001, count: 3 } },
    { id: "b", position: 2, result: { complete: true, sum: 27000, count: 3 } },
  ];
  assert.deepEqual(
    rankProjects(projects, settings).map((p) => p.rank),
    [1, 2],
  );
});
test("CSV escapes quotes, formulas and leading whitespace", () => {
  assert.equal(csvCell("=SUM(A1)"), '"\'=SUM(A1)"');
  assert.equal(csvCell(" \t@cmd"), '"\' \t@cmd"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell(0), '"0"');
});

test("confirmed ties use ordinal places without exceeding quotas", () => {
  const projects = [1, 0, 2].map((tie_order, i) => ({
    id: String(i),
    position: i,
    tie_order,
    result: calculate(scores([9000, 9000, 9000]), settings, 3),
  }));
  assert.deepEqual(
    rankProjects(projects, settings).map((p) => [p.id, p.rank, p.prize]),
    [
      ["1", 1, 1],
      ["0", 2, 2],
      ["2", 3, 3],
    ],
  );
});
