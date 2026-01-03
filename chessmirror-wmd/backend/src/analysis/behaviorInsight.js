export function getBehaviorInsight(stats) {
  const moveCount = stats?.moves ?? stats?.moveCount ?? 0;
  const avgThinkTime = stats?.avgThinkTime ?? 0;     // seconds
  const blunderRate = stats?.blunderRate ?? 0;       // %
  const hoverCount = stats?.hoverCount ?? 0;

  const hoversPerMove = moveCount > 0 ? hoverCount / moveCount : 0;

  // ✅ Warming up (voorkomt te vroege labels)
  if (moveCount < 6) {
    return {
      label: "Warming up",
      text: "Not enough data yet to detect a stable play style. Play a few more moves."
    };
  }

  // Impulsive: very fast + noticeably error-prone
  if (avgThinkTime <= 2.2 && blunderRate >= 25) {
    return {
      label: "Impulsive",
      text: "Very fast decisions combined with frequent mistakes suggests impulsive play."
    };
  }

  // Reflective: slow + accurate
  if (avgThinkTime >= 6.0 && blunderRate <= 20) {
    return {
      label: "Reflective",
      text: "Longer thinking times with fewer mistakes indicate a reflective decision-making style."
    };
  }

  // Hesitant: slower + lots of exploration
  if (avgThinkTime >= 4.0 && hoversPerMove >= 4.0) {
    return {
      label: "Hesitant",
      text: "Extended thinking combined with heavy exploration suggests hesitation before committing."
    };
  }

  // Explorer: lots of exploration (but not necessarily slow)
  if (hoversPerMove >= 5.0) {
    return {
      label: "Explorer",
      text: "You scan many squares and lines. This can be strong, but try to shortlist 1–2 candidates."
    };
  }

  // ✅ Unstable alleen als het écht mis gaat (anders is het een rot-label)
  if (blunderRate >= 35) {
    return {
      label: "Unstable",
      text: "High error rate suggests inconsistent execution or focus."
    };
  }

  // ✅ Default: normaal menselijk schaakgedrag
  return {
    label: "Balanced",
    text: "A generally steady pace and error rate. Your play looks fairly consistent overall."
  };
}
