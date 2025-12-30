
export function getBehaviorInsight(stats) {
  const { avgThinkTime, blunderRate, hoverCount } = stats;

  if (avgThinkTime < 4 && blunderRate > 40) {
    return {
      label: "Impulsive",
      text: "Fast decision-making combined with a high blunder rate suggests impulsive play under pressure."
    };
  }

  if (avgThinkTime > 6 && blunderRate < 25) {
    return {
      label: "Reflective",
      text: "Longer thinking times with fewer mistakes indicate a reflective decision-making style."
    };
  }

  if (hoverCount > 20) {
    return {
      label: "Hesitant",
      text: "Frequent hovering suggests hesitation and uncertainty before committing moves."
    };
  }

  return {
    label: "Unstable",
    text: "Inconsistent thinking patterns suggest fluctuating focus or strategy."
  };
}
