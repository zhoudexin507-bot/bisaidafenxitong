// All arithmetic uses hundredths of a point; rankings compare exact fractions.
export function calculate(scores, settings, judgeCount) {
  const complete = judgeCount > 0 && scores.length === judgeCount;
  const sorted = [...scores].sort(
    (a, b) => a.total - b.total || a.judge_id.localeCompare(b.judge_id),
  );
  const low = complete && settings.trimEnabled ? settings.trimLow : 0;
  const high = complete && settings.trimEnabled ? settings.trimHigh : 0;
  const kept = sorted.slice(low, sorted.length - high);
  const dropped = complete
    ? sorted.filter((s) => !kept.includes(s)).map((s) => s.judge_id)
    : [];
  const sum = kept.reduce((value, s) => value + s.total, 0);
  return {
    complete,
    sum,
    count: kept.length,
    average: kept.length ? sum / kept.length / 100 : null,
    dropped,
    droppedLow: complete ? sorted.slice(0, low).map((s) => s.judge_id) : [],
    droppedHigh:
      complete && high ? sorted.slice(-high).map((s) => s.judge_id) : [],
  };
}

export function rankProjects(projects, settings) {
  const sorted = projects
    .filter((p) => p.result.complete)
    .sort(
      (a, b) =>
        b.result.sum * a.result.count - a.result.sum * b.result.count ||
        (a.tie_order ?? Number.MAX_SAFE_INTEGER) -
          (b.tie_order ?? Number.MAX_SAFE_INTEGER) ||
        a.position - b.position,
    );
  sorted.forEach((p, index) => {
    const tied = sorted.filter(
      (q) => q.result.sum * p.result.count === p.result.sum * q.result.count,
    );
    p.tieUnresolved =
      tied.length > 1 &&
      (tied.some((q) => q.tie_order == null) ||
        new Set(tied.map((q) => q.tie_order)).size !== tied.length);
    p.rank = index + 1;
    const [first, second, third] = settings.prizes;
    p.prize = p.tieUnresolved
      ? null
      : p.rank <= first
        ? 1
        : p.rank <= first + second
          ? 2
          : p.rank <= first + second + third
            ? 3
            : null;
  });
  return sorted;
}

export function csvCell(value) {
  let str = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(str)) str = `'${str}`;
  return `"${str.replaceAll('"', '""')}"`;
}
