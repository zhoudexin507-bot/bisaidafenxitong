// 评委打分分析：纯函数、双端共用（服务端聚合，单测直测）。
// 口径与计分规则同源：results 由调用方用 scoring.calculate() 逐「项目:轮次」
// 算好传入（keptSum/keptCount/droppedLow/droppedHigh），剔除判定不做第二套逻辑。

function mean(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

function stdDev(list) {
  if (list.length < 2) return null;
  const m = mean(list);
  return Math.sqrt(mean(list.map((v) => (v - m) ** 2)));
}

// 参照分（分，保留两位内浮点）：收齐时用去极值后的均值，未收齐用已提交均值
function referenceAverage(result, groupEntries) {
  if (result?.complete && result.count > 0) return result.sum / result.count / 100;
  const totals = groupEntries.map((e) => e.total);
  return mean(totals) != null ? mean(totals) / 100 : null;
}

export function analyzeJudges({ judges, projects, entries, results, rounds }) {
  const roundCount = Math.max(1, rounds || 1);
  const expected = projects.length * roundCount;
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.project_id}:${entry.round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  // 每组按提交时间排位次（1 起），位次越小反应越快
  const orderOf = new Map();
  for (const [key, group] of groups) {
    [...group]
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.judge_id.localeCompare(b.judge_id))
      .forEach((e, i) => orderOf.set(`${key}:${e.judge_id}`, i + 1));
  }

  const judgeRows = judges.map((judge) => {
    const own = entries.filter((e) => e.judge_id === judge.id);
    const totals = own.map((e) => e.total / 100);
    const deviations = [];
    let trimmedLow = 0,
      trimmedHigh = 0,
      orderSum = 0,
      orderCount = 0;
    const missing = [];
    for (const project of projects) {
      for (let round = 1; round <= roundCount; round++) {
        const key = `${project.id}:${round}`;
        const result = results[key];
        const entry = own.find((e) => e.project_id === project.id && e.round === round);
        if (!entry) {
          missing.push({ projectId: project.id, round });
          continue;
        }
        const reference = referenceAverage(result, groups.get(key) || []);
        if (reference != null) deviations.push(entry.total / 100 - reference);
        if (result?.droppedLow?.includes(judge.id)) trimmedLow++;
        if (result?.droppedHigh?.includes(judge.id)) trimmedHigh++;
        const order = orderOf.get(`${key}:${judge.id}`);
        if (order) {
          orderSum += order;
          orderCount++;
        }
      }
    }
    const trimmedTotal = trimmedLow + trimmedHigh;
    const avg = mean(totals);
    return {
      id: judge.id,
      number: judge.number,
      name: judge.name,
      title: judge.title || "",
      enabled: judge.enabled !== 0 && judge.enabled !== false,
      submitted: own.length,
      expected,
      completionRate: expected ? own.length / expected : null,
      missing,
      avg,
      min: totals.length ? Math.min(...totals) : null,
      max: totals.length ? Math.max(...totals) : null,
      stdDev: stdDev(totals),
      // 宽严指数：对所评项目参照分的平均偏差，正=整体给分偏高
      leniency: deviations.length ? mean(deviations) : null,
      trimmedTotal,
      trimmedLow,
      trimmedHigh,
      // 入选率：提交的评分中未被去极值剔除的比例
      keptRate: own.length ? 1 - trimmedTotal / own.length : null,
      // 平均提交次序：每个项目上是第几位提交（1 起），越小反应越快
      avgOrder: orderCount ? orderSum / orderCount : null,
    };
  });

  // 评分矩阵：行=项目，列=评委，单元格内含各轮明细与偏差
  const matrix = projects.map((project) => {
    const roundRefs = [];
    for (let round = 1; round <= roundCount; round++) {
      const key = `${project.id}:${round}`;
      const ref = referenceAverage(results[key], groups.get(key) || []);
      if (ref != null) roundRefs.push(ref);
    }
    return {
    id: project.id,
    name: project.name,
    team: project.team,
    position: project.position,
    status: project.status,
    // 项目参照均分：各轮去极值均值（未收齐轮用已提交均值）的平均
    reference: mean(roundRefs),
    cells: judges.map((judge) => {
      const roundsDetail = [];
      for (let round = 1; round <= roundCount; round++) {
        const key = `${project.id}:${round}`;
        const result = results[key];
        const entry = (groups.get(key) || []).find((e) => e.judge_id === judge.id);
        if (!entry) {
          roundsDetail.push({ round, total: null, deviation: null, trimmed: null, order: null });
          continue;
        }
        const reference = referenceAverage(result, groups.get(key) || []);
        roundsDetail.push({
          round,
          total: entry.total,
          deviation: reference != null ? entry.total / 100 - reference : null,
          trimmed: result?.droppedLow?.includes(judge.id)
            ? "low"
            : result?.droppedHigh?.includes(judge.id)
              ? "high"
              : null,
          order: orderOf.get(`${key}:${judge.id}`) || null,
          submittedAt: entry.submitted_at,
        });
      }
      const scored = roundsDetail.filter((r) => r.total != null);
      return {
        judgeId: judge.id,
        rounds: roundsDetail,
        submittedRounds: scored.length,
        // 多轮时单元格展示各轮平均（百分制）
        avgTotal: scored.length ? Math.round(mean(scored.map((r) => r.total))) : null,
      };
    }),
    };
  });

  const submitted = entries.length;
  // 总体口径分母是「项目 × 轮次 × 评委席」的全部评分槽位
  const slots = expected * judges.length;
  return {
    rounds: roundCount,
    expected,
    totals: {
      submitted,
      missing: slots - submitted,
      completionRate: slots ? submitted / slots : null,
      trimmed: judgeRows.reduce((n, r) => n + r.trimmedTotal, 0),
    },
    judges: judgeRows,
    matrix,
  };
}
