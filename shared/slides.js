function chunks(items, size) {
  const pages = [];
  for (let start = 0; start < items.length; start += size)
    pages.push(items.slice(start, start + size));
  return pages;
}

export function resultViews(data) {
  const hasTeamAward = data.ranking.some((team) => team.prize);
  // An explicitly selected empty awards view can still navigate in either direction.
  return hasTeamAward || data.settings.presentation.view === "teamAwards"
    ? ["ranking", "teamAwards", "individualAwards"]
    : ["ranking", "individualAwards"];
}

// 个人奖项等级名：0=未分组，1/2/3=一/二/三等奖
export const awardLevelNames = ["个人奖", "一等奖", "二等奖", "三等奖"];

// 颁奖卡片自动排布：3 个 = 1 + 2（顶尖居中），4 个 = 2 + 2，5 个 = 2 + 2 + 1，
// 其余每排 2 个、余 1 个独占末行，每排整体居中对称。
export function awardRows(count) {
  if (count <= 1) return [count];
  if (count === 2) return [2];
  if (count === 3) return [1, 2];
  const rows = [];
  let left = count;
  while (left > 2) {
    rows.push(2);
    left -= 2;
  }
  rows.push(left);
  return rows;
}

// Each page carries just the records its view renders, in presentation order.
// 团体奖与个人奖均按等级整页展示（三等 → 二等 → 一等，未分组垫底），空等级自动跳过；
// 具体显示哪一页由后台大屏控制切换，大屏端不再自动轮播。
export function resultPages(data, view) {
  if (view === "teamAwards") {
    return [3, 2, 1]
      .map((level) => data.ranking.filter((team) => team.prize === level))
      .filter((teams) => teams.length);
  }
  if (view === "individualAwards") {
    return [3, 2, 1, 0]
      .map((level) => data.awards.filter((award) => (award.level || 0) === level))
      .filter((persons) => persons.length);
  }
  if (view === "ranking") return chunks(data.ranking, 8);
  return [];
}
