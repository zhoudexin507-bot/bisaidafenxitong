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

// Each page carries just the records its view renders, in presentation order.
export function resultPages(data, view) {
  if (view === "teamAwards") {
    return [3, 2, 1].flatMap((level) =>
      chunks(data.ranking.filter((team) => team.prize === level), 4),
    );
  }
  if (view === "individualAwards") return chunks(data.awards, 6);
  if (view === "ranking") return chunks(data.ranking, 8);
  return [];
}
