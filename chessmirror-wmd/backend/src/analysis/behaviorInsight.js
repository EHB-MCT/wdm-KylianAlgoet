export function getBehaviorInsight(stats) {
  const { avgThinkTime, blunderRate, hoverCount, moveCount } = stats;

  const hoversPerMove = moveCount > 0 ? hoverCount / moveCount : 0;

  // Impulsive: fast + inaccurate
  if (avgThinkTime < 3 && blunderRate > 40) {
    return {
      label: "Impulsive",
      text: "Fast decision-making combined with frequent mistakes suggests impulsive play."
    };
  }

  // Reflective: slow + accurate
  if (avgThinkTime > 6 && blunderRate < 25) {
    return {
      label: "Reflective",
      text: "Longer thinking times with fewer mistakes indicate a reflective decision-making style."
    };
  }

  // Hesitant: slow + high exploration
  if (avgThinkTime > 4 && hoversPerMove > 4) {
    return {
      label: "Hesitant",
      text: "Extended thinking combined with frequent board exploration suggests hesitation before committing moves."
    };
  }

  return {
    label: "Unstable",
    text: "Inconsistent thinking and exploration patterns suggest fluctuating focus or strategy."
  };
}
