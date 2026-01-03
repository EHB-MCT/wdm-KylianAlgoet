export function getBehaviorInsight(stats) {
  const moveCount = Number(stats?.moves ?? stats?.moveCount ?? 0);
  const avgThinkTime = Number(stats?.avgThinkTime ?? 0); // seconds
  const blunderRate = Number(stats?.blunderRate ?? 0);   // %
  const hoverCount = Number(stats?.hoverCount ?? 0);

  const hoversPerMove = moveCount > 0 ? hoverCount / moveCount : 0;

  const fmt = (n, d = 1) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toFixed(d);
  };

  const evidence =
    `Evidence: moves=${Number.isFinite(moveCount) ? moveCount : "—"}, ` +
    `avgThink≈${fmt(avgThinkTime)}s, ` +
    `blunderRate=${fmt(blunderRate, 0)}%, ` +
    `hovers/move≈${fmt(hoversPerMove)}.`;

  // ✅ Warming up (voorkomt te vroege labels)
  if (!Number.isFinite(moveCount) || moveCount < 6) {
    return {
      label: "Warming up",
      text:
        `Not enough stable data yet to detect a reliable play style. ` +
        `${evidence} Play a few more moves to lock in a profile.`
    };
  }

  // ✅ Unstable alleen als het écht mis gaat (zet deze vroeg zodat het niet "verzacht" wordt door andere labels)
  if (Number.isFinite(blunderRate) && blunderRate >= 35) {
    return {
      label: "Unstable",
      text:
        `Your error rate is very high, which points to inconsistent execution or focus. ` +
        `This label triggers because blunderRate is ${fmt(blunderRate, 0)}% (≥ 35%). ` +
        `${evidence}`
    };
  }

  // Impulsive: very fast + noticeably error-prone
  if (avgThinkTime <= 2.2 && blunderRate >= 25) {
    return {
      label: "Impulsive",
      text:
        `You play very fast while making many costly mistakes. ` +
        `This label triggers because avgThink≈${fmt(avgThinkTime)}s (≤ 2.2s) and blunderRate=${fmt(blunderRate, 0)}% (≥ 25%). ` +
        `${evidence}`
    };
  }

  // Reflective: slow + accurate
  if (avgThinkTime >= 6.0 && blunderRate <= 20) {
    return {
      label: "Reflective",
      text:
        `You take more time per move and keep mistakes controlled. ` +
        `This label triggers because avgThink≈${fmt(avgThinkTime)}s (≥ 6.0s) and blunderRate=${fmt(blunderRate, 0)}% (≤ 20%). ` +
        `${evidence}`
    };
  }

  // Hesitant: slower + lots of exploration
  if (avgThinkTime >= 4.0 && hoversPerMove >= 4.0) {
    return {
      label: "Hesitant",
      text:
        `You spend longer per move and explore many squares before committing. ` +
        `This label triggers because avgThink≈${fmt(avgThinkTime)}s (≥ 4.0s) and hovers/move≈${fmt(hoversPerMove)} (≥ 4.0). ` +
        `${evidence}`
    };
  }

  // Explorer: lots of exploration (but not necessarily slow)
  if (hoversPerMove >= 5.0) {
    return {
      label: "Explorer",
      text:
        `Your exploration is very high (you hover over many squares/lines). ` +
        `This label triggers because hovers/move≈${fmt(hoversPerMove)} (≥ 5.0). ` +
        `This can be strong, but it’s most effective if you shortlist 1–2 candidate moves. ` +
        `${evidence}`
    };
  }

  // ✅ Default: normaal menselijk schaakgedrag
  return {
    label: "Balanced",
    text:
      `Your pace and mistake rate are fairly consistent overall. ` +
      `No extreme pattern (too fast + error-prone, very slow + accurate, or heavy exploration) was dominant. ` +
      `${evidence}`
  };
}
