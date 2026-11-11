const text = (label, size, y, color = "#ffffff") => ({
  label, size, x: 50, y, color, hidden: false,
});

const resultText = {
  event: text("赛事名称", 32, 8),
  title: text("页面标题", 66, 20, "#ffe4a8"),
  content: text("名单与成绩", 42, 58),
  page: text("页码", 24, 95),
};

export const displayLayouts = {
  home: {
    title: text("赛事名称", 90, 44),
    subtitle: text("赛事副标题", 42, 60),
  },
  ranking: { ...resultText, content: text("排名与成绩", 36, 58) },
  teamAwards: { ...resultText, content: text("奖级与获奖队伍", 48, 58) },
  individualAwards: { ...resultText, content: text("获奖单位与姓名", 48, 58) },
};

export function getTextLayout(settings, view, layer) {
  return { ...displayLayouts[view][layer], ...settings.displayLayouts?.[view]?.[layer] };
}
