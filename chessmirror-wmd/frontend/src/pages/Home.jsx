// ✅ UPDATED Home.jsx (drop-in replacement)
// - Fixes warming-up + nudges (no lag) using moveCountNow
// - Adds Post-Game Report modal:
//    - Shows on checkmate/stalemate/draw/resign (game over)
//    - Also shows at MOVE_THRESHOLD (default 30 full moves = 60 ply) once per game
//    - "OK, continue" closes modal and lets you keep playing (unless game over -> board locked)
//    - "New game" generates new UID and resets everything
// - Keeps your existing bot + tracking + hint + interventions intact

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getUid, newUid, newSessionId } from "../lib/uid";
import { track } from "../lib/tracker";
import { getInterventions, startGame, submitMove, getProfile } from "../lib/api";

const fenKey = (uid) => `cm_fen_${uid}`;
const gameKey = (uid) => `cm_game_${uid}`;
const BOARD_WIDTH = 420;

// ===== Report config =====
const REPORT_MOVE_THRESHOLD_FULL_MOVES = 30; // 30 moves (white+black) => 60 ply
const REPORT_PLY_THRESHOLD = REPORT_MOVE_THRESHOLD_FULL_MOVES * 2;

// --- Bot helpers (lightweight, no engine) ---
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialEval(chess) {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_VALUE[sq.type] ?? 0;
      score += sq.color === "w" ? v : -v;
    }
  }
  return score;
}

function pickWeightedRandom(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.item;
  }
  return items[items.length - 1]?.item ?? null;
}

function isCheckCompat(ch) {
  return (
    (typeof ch.isCheck === "function" && ch.isCheck()) ||
    (typeof ch.inCheck === "function" && ch.inCheck()) ||
    false
  );
}

// --- Dynamic nudge system ---
const NUDGE_COOLDOWN_MS = 20000;
const NUDGE_MIN_VISIBLE_MS = 4500;
const NUDGE_MAX_VISIBLE_MS = 10000;
const NUDGE_AFTER_MOVE_GRACE_MS = 900;
const NUDGE_SHOW_PROB = 0.45;

function normalizeSegment(seg) {
  const s = String(seg || "").trim();
  if (!s) return "UNKNOWN";
  return s.toUpperCase();
}

function pickNudgeMessage({ segment, thinkTimeMs, hoverBurst }) {
  const seg = normalizeSegment(segment);

  if (seg === "HESITANT")
    return "Players like you often perform better when they trust their first instinct.";
  if (seg === "IMPULSIVE")
    return "Players with your style benefit from pausing before committing.";
  if (seg === "REFLECTIVE" || seg === "CAREFUL")
    return "Your calm pace is working — keep scanning checks/captures.";
  if (seg === "UNSTABLE")
    return "Consistency tends to create stronger positions over time.";

  if (hoverBurst >= 8)
    return "Try trusting your first idea — too much exploring can slow you down.";
  if (thinkTimeMs >= 4200)
    return "Take a second — then commit. Overthinking can cost you momentum.";
  if (thinkTimeMs <= 900)
    return "Quick moves are risky — a brief pause can boost accuracy.";

  return "Take a second. Then commit.";
}

function getBehavioralHint({ segment, hoverBurst, thinkTimeMs }) {
  const seg = normalizeSegment(segment);
  if (seg === "HESITANT")
    return "Pick ONE candidate move, quickly check checks/captures, then commit.";
  if (seg === "IMPULSIVE")
    return "Before moving: scan (1) opponent captures, (2) your king safety, (3) checks.";
  if (seg === "REFLECTIVE" || seg === "CAREFUL")
    return "Good pace — prioritize forcing lines (checks/captures) to convert advantages.";
  if (seg === "UNSTABLE")
    return "Use a consistent routine: checks → captures → threats → develop.";

  if (hoverBurst >= 8)
    return "You’re exploring a lot — shortlist 2 moves and pick the safer one.";
  if (thinkTimeMs <= 900)
    return "Slow down: ask ‘what’s my opponent’s best reply?’ before dropping.";
  if (thinkTimeMs >= 4200)
    return "Avoid perfect-move hunting: choose a solid plan and commit.";
  return "Scan checks/captures first. If none: improve a piece.";
}

function getTacticalHint(ch) {
  try {
    const legal = ch.moves({ verbose: true });
    if (!legal.length) return "No legal moves.";

    const checks = legal.filter(
      (m) => (m.san || "").includes("+") || (m.san || "").includes("#")
    );
    const captures = legal.filter(
      (m) => (m.flags || "").includes("c") || (m.flags || "").includes("e")
    );

    if (checks.length) {
      const sample = checks.slice(0, 3).map((m) => m.san).join(", ");
      return `Look for checks: ${sample}. Start with forcing moves.`;
    }

    if (captures.length) {
      const sample = captures.slice(0, 3).map((m) => m.san).join(", ");
      return `Look for captures: ${sample}. Compare piece values before trading.`;
    }

    return "No immediate checks/captures. Improve development and king safety.";
  } catch {
    return "Hint unavailable for this position.";
  }
}

function gameOutcomeLabel(ch) {
  try {
    if (!ch.isGameOver()) return null;

    // chess.js variants naming can differ, so be defensive
    const isCheckmate =
      (typeof ch.isCheckmate === "function" && ch.isCheckmate()) ||
      (typeof ch.inCheckmate === "function" && ch.inCheckmate());

    const isStalemate =
      (typeof ch.isStalemate === "function" && ch.isStalemate()) ||
      (typeof ch.inStalemate === "function" && ch.inStalemate());

    const isDraw =
      (typeof ch.isDraw === "function" && ch.isDraw()) ||
      (typeof ch.inDraw === "function" && ch.inDraw());

    if (isCheckmate) return "CHECKMATE";
    if (isStalemate) return "STALEMATE";
    if (isDraw) return "DRAW";
    return "GAME OVER";
  } catch {
    return "GAME OVER";
  }
}
function fmt(n, d = 1) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(d);
}

function getBehaviorInsight(stats) {
  const moveCount = stats?.moves ?? stats?.moveCount ?? 0;
  const avgThinkTime = stats?.avgThinkTime ?? 0; // seconds
  const blunderRate = stats?.blunderRate ?? 0;   // %
  const hoverCount = stats?.hoverCount ?? 0;
  const hintsUsed = stats?.hintsUsed ?? 0;

  const hoversPerMove = moveCount > 0 ? hoverCount / moveCount : 0;

  // ✅ warming up
  if (moveCount < 6) {
    return {
      label: "Warming up",
      text: `Not enough stable data yet (moves=${moveCount}). Play a few more moves to lock in a reliable profile.`
    };
  }

  // Impulsive
  if (avgThinkTime <= 2.2 && blunderRate >= 25) {
    return {
      label: "Impulsive",
      text:
        `You play very fast (avgThink≈${fmt(avgThinkTime)}s) while making many costly mistakes (blunderRate=${fmt(blunderRate, 0)}%). ` +
        `That combo strongly indicates impulsive decisions rather than calculated lines.`
    };
  }

  // Reflective
  if (avgThinkTime >= 6.0 && blunderRate <= 20) {
    return {
      label: "Reflective",
      text:
        `You take your time (avgThink≈${fmt(avgThinkTime)}s) and your mistakes stay controlled (blunderRate=${fmt(blunderRate, 0)}%). ` +
        `This pattern matches reflective play: deeper evaluation before committing.`
    };
  }

  // Hesitant
  if (avgThinkTime >= 4.0 && hoversPerMove >= 4.0) {
    return {
      label: "Hesitant",
      text:
        `You spend longer per move (avgThink≈${fmt(avgThinkTime)}s) and explore many squares (hovers/move≈${fmt(hoversPerMove)}). ` +
        `That suggests hesitation: lots of searching before finally committing.`
    };
  }

  // Explorer
  if (hoversPerMove >= 5.0) {
    return {
      label: "Explorer",
      text:
        `Your exploration is very high (hovers/move≈${fmt(hoversPerMove)}). ` +
        `That can be strong, but it’s most effective when you shortlist 1–2 candidate moves instead of scanning everything.`
    };
  }

  // Unstable (alleen als echt)
  if (blunderRate >= 35) {
    return {
      label: "Unstable",
      text:
        `Your blunder rate is very high (${fmt(blunderRate, 0)}%), which points to inconsistent execution or focus. ` +
        `Stabilizing your routine (checks → captures → threats) should reduce these spikes.`
    };
  }

  // Balanced default
  return {
    label: "Balanced",
    text:
      `Your pace and accuracy are fairly consistent (avgThink≈${fmt(avgThinkTime)}s, blunderRate=${fmt(blunderRate, 0)}%). ` +
      `Exploration is moderate (hovers/move≈${fmt(hoversPerMove)}), which fits a balanced decision style overall.`
  };
}

export default function Home() {
  const [uid, setUid] = useState(() => getUid());

  const [gameId, setGameId] = useState(() => {
    const u = getUid();
    return sessionStorage.getItem(gameKey(u)) || null;
  });

  const [chess, setChess] = useState(() => {
    const u = getUid();
    const savedFen = sessionStorage.getItem(fenKey(u));
    return savedFen ? new Chess(savedFen) : new Chess();
  });

  const [status, setStatus] = useState("ready");
  const [lastQuality, setLastQuality] = useState(null);

  const [interventions, setInterventions] = useState({});
  const [confirmMoves, setConfirmMoves] = useState(false);
  // ===== Confirm-move UI (random, in-app modal) =====
const CONFIRM_PROB = 0.22;           // 22% chance per move (tweak)
const CONFIRM_COOLDOWN_MS = 25000;   // min 25s between prompts

const [confirmOpen, setConfirmOpen] = useState(false);
const pendingConfirmMoveRef = useRef(null);
const lastConfirmAtRef = useRef(0);


  const [nudgeEnabled, setNudgeEnabled] = useState(true);

  const [nudge, setNudge] = useState(null);
  const lastNudgeAtRef = useRef(0);
  const nudgeHideTimerRef = useRef(null);
  const nudgeMaxTimerRef = useRef(null);

  const [uidFlash, setUidFlash] = useState(false);
  const [uidChangeMsg, setUidChangeMsg] = useState("");

  const thinkStartRef = useRef(performance.now());
  const startedForUidRef = useRef(null);

  const pendingMovesRef = useRef([]);
  const flushingRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);

  const botThinkingRef = useRef(false);
  const botTimerRef = useRef(null);
  const [botThinking, setBotThinking] = useState(false);

  const recentFastMovesRef = useRef(0);
  const recentBlundersRef = useRef(0);

  const [segment, setSegment] = useState("UNKNOWN");
  const [profileStats, setProfileStats] = useState(null);

  const hoverBurstRef = useRef({ count: 0, windowStart: 0 });

  const [hintOpen, setHintOpen] = useState(false);
  const [hintData, setHintData] = useState(null);

  // ===== REPORT STATE =====
  const [reportOpen, setReportOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportLocked, setReportLocked] = useState(false); // if game over => lock board
  const reportShownForThresholdRef = useRef(false); // prevent spam at 30 moves
  const reportOpenRef = useRef(false);

  useEffect(() => {
    reportOpenRef.current = reportOpen;
  }, [reportOpen]);

  function parseGameId(resp) {
    return resp?.gameId || resp?.id || resp?.data?.gameId || resp?.data?.id || null;
  }

  function cancelBot() {
    if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    botTimerRef.current = null;
    botThinkingRef.current = false;
    setBotThinking(false);
  }

  function clearNudgeTimers() {
    if (nudgeHideTimerRef.current) window.clearTimeout(nudgeHideTimerRef.current);
    if (nudgeMaxTimerRef.current) window.clearTimeout(nudgeMaxTimerRef.current);
    nudgeHideTimerRef.current = null;
    nudgeMaxTimerRef.current = null;
  }

  function hideNudgeSoft(delayMs = 0) {
    clearNudgeTimers();
    nudgeHideTimerRef.current = window.setTimeout(() => {
      setNudge(null);
      nudgeHideTimerRef.current = null;
    }, Math.max(0, delayMs));
  }

  function showNudge({ msg, reason }) {
    const now = Date.now();
    if (now - lastNudgeAtRef.current < NUDGE_COOLDOWN_MS) return;

    lastNudgeAtRef.current = now;
    clearNudgeTimers();

    setNudge({
      msg,
      reason,
      shownAt: now,
      segmentAtShow: segment
    });

    nudgeMaxTimerRef.current = window.setTimeout(() => {
      setNudge(null);
      nudgeMaxTimerRef.current = null;
    }, NUDGE_MAX_VISIBLE_MS);
  }

  // ✅ UPDATED: includes moveCountNow to avoid “lag”
  function maybeShowNudge({ thinkTimeMs, hoverBurst, moveCountNow }) {
    const movesFromApi = profileStats?.moves ?? 0;
    const movesFromBoard = typeof moveCountNow === "number" ? Math.floor(moveCountNow / 2) : 0;
    const moves = Math.max(movesFromApi, movesFromBoard);

    if (moves < 6) return; // ✅ no nudges during warming up
    if (!nudgeEnabled) return;
    if (nudge) return;

    const tooFast = thinkTimeMs <= 900;
    const tooSlow = thinkTimeMs >= 4200;
    const tooManyHovers = hoverBurst >= 8;

    let reason = null;
    if (tooManyHovers) reason = "hoverBurst";
    else if (tooSlow) reason = "tooSlow";
    else if (tooFast) reason = "tooFast";
    else return;

    if (Math.random() > NUDGE_SHOW_PROB) return;

    const msg = pickNudgeMessage({ segment, thinkTimeMs, hoverBurst });
    showNudge({ msg, reason });
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      cancelBot();
      clearNudgeTimers();
    };
  }, []);
function shouldAskConfirmNow(nextFullMoves) {
  if (!confirmMoves) return false;
  if (confirmOpen) return false;

  const now = Date.now();
  if (now - lastConfirmAtRef.current < CONFIRM_COOLDOWN_MS) return false;

  // niet meteen in het begin
  if ((nextFullMoves ?? 0) < 4) return false;

  return Math.random() < CONFIRM_PROB;
}

  async function refreshProfile(forUid) {
    try {
      const p = await getProfile(forUid);
      setSegment(normalizeSegment(p?.segment ?? "UNKNOWN"));
      setProfileStats(p?.stats ?? null);
    } catch (e) {
      track("profile_fetch_error", { message: String(e?.message || e) });
    }
  }

  async function ensureGameStarted(forUid, force = false) {
    const cached = sessionStorage.getItem(gameKey(forUid));
    if (cached && !force) {
      setGameId(cached);
      return cached;
    }

    if (startedForUidRef.current === forUid) return null;
    startedForUidRef.current = forUid;

    try {
      setStatus((s) => (s === "saving" || s === "bot" ? s : "starting"));
      const g = await startGame(forUid);
      const gid = parseGameId(g);
      if (!gid) throw new Error("startGame returned no gameId");

      sessionStorage.setItem(gameKey(forUid), gid);
      setGameId(gid);

      track("game_start", { uid: forUid, gameId: gid, force });
      return gid;
    } catch (e) {
      startedForUidRef.current = null;
      track("game_start_error", { message: String(e?.message || e) });
      setStatus("error");
      return null;
    } finally {
      setStatus((s) => (s === "saving" || s === "bot" ? s : "ready"));
    }
  }

  async function flushPendingMoves(gid, forUid) {
    if (!gid || flushingRef.current) return;
    flushingRef.current = true;

    try {
      const queue = pendingMovesRef.current.filter((m) => m.uid === forUid);
      pendingMovesRef.current = pendingMovesRef.current.filter((m) => m.uid !== forUid);
      setPendingCount(pendingMovesRef.current.length);

      for (const m of queue) {
        await submitMove({ ...m, gameId: gid });
      }
      track("pending_moves_flushed", { uid: forUid, count: queue.length });
    } catch (e) {
      track("pending_moves_flush_error", { message: String(e?.message || e) });
    } finally {
      flushingRef.current = false;
    }
  }

  // --- BOT LOGIC ---
  function chooseBotMode() {
    if (recentBlundersRef.current >= 2) return "trap";
    if (recentFastMovesRef.current >= 2) return "bait";
    return "baseline";
  }

  function chooseBotMove(ch) {
    const legal = ch.moves({ verbose: true });
    if (!legal.length) return null;

    const mode = chooseBotMode();

    const scored = legal.map((m) => {
      const tmp = new Chess(ch.fen());
      tmp.move(m);
      const evalAfter = materialEval(tmp);
      const turn = ch.turn();
      const perspectiveScore = turn === "w" ? evalAfter : -evalAfter;
      const givesCheck = isCheckCompat(tmp);
      return { m, perspectiveScore, givesCheck };
    });

    let picked = null;
    let intent = "solid";

    if (mode === "baseline") {
      const sorted = [...scored].sort((a, b) => b.perspectiveScore - a.perspectiveScore);
      const top = sorted.slice(0, 3);
      picked = pickWeightedRandom(top.map((x, idx) => ({ item: x.m, weight: 3 - idx })));
      intent = "solid";
    } else if (mode === "bait") {
      const sorted = [...scored].sort((a, b) => a.perspectiveScore - b.perspectiveScore);
      const n = Math.max(2, Math.floor(sorted.length * 0.2));
      const worst = sorted.slice(0, n);
      picked = pickWeightedRandom(worst.map((x) => ({ item: x.m, weight: 1 })));
      intent = "hang_piece";
    } else if (mode === "trap") {
      const checks = scored.filter((x) => x.givesCheck);
      if (checks.length) {
        picked = pickWeightedRandom(checks.map((x) => ({ item: x.m, weight: 1 })));
        intent = "give_check";
      } else {
        const sorted = [...scored].sort((a, b) => b.perspectiveScore - a.perspectiveScore);
        picked = sorted[0]?.m ?? null;
        intent = "pressure";
      }
    }

    return { move: picked, mode, intent };
  }

function openReport({ reason, chessAfter, isFinal }) {
  if (reportOpenRef.current) return;

  const outcome = gameOutcomeLabel(chessAfter) || "MIDGAME";

  const stats = profileStats ?? null;

  const plyFromHistory = chessAfter?.history?.().length ?? 0;
  const fullMovesFromHistory = Math.floor(plyFromHistory / 2);

  const fullMovesFromStats = stats?.moves ?? 0;

  const fullMoves = Math.max(fullMovesFromStats, fullMovesFromHistory);
  const ply = fullMoves * 2;

  const insight = getBehaviorInsight(stats);

  const data = {
    reason,
    outcome,
    isFinal: !!isFinal,
    ply,
    fullMoves,
    lastQuality: lastQuality ?? null,
    segment: normalizeSegment(segment),
    stats,
    insight
  };

  setReportData(data);
  setReportLocked(!!isFinal);
  setReportOpen(true);

  track("report_open", {
    uid,
    reason,
    outcome,
    ply,
    fullMoves,
    isFinal: !!isFinal
  });
}

 function maybeTriggerReport(chAfter, { afterPlayerMove = false } = {}) {
  if (!chAfter) return;

  // 1) game over => always show report (and lock)
  if (chAfter.isGameOver && chAfter.isGameOver()) {
    openReport({ reason: "gameOver", chessAfter: chAfter, isFinal: true });
    return;
  }

  // 2) threshold report (only once per game)
  // Prefer DB/profile stats (moves) because chess.js history can be empty
  // when you reconstructed from FEN (new Chess(fen)).
  const statsMoves = profileStats?.moves ?? 0;

  const plyFromHistory = chAfter?.history?.().length ?? 0;
  const fullMovesFromHistory = Math.floor(plyFromHistory / 2);

  const fullMovesNow = Math.max(statsMoves, fullMovesFromHistory);

  if (
    !reportShownForThresholdRef.current &&
    fullMovesNow >= REPORT_MOVE_THRESHOLD_FULL_MOVES
  ) {
    reportShownForThresholdRef.current = true;
    openReport({ reason: "threshold", chessAfter: chAfter, isFinal: false });
  }
}

  function queueBotResponse(nextChessAfterPlayer, meta) {
    if (!nextChessAfterPlayer || nextChessAfterPlayer.isGameOver()) {
      // player already ended game
      return;
    }
    if (botThinkingRef.current) return;

    botThinkingRef.current = true;
    setBotThinking(true);
    setStatus("bot");

    const botThinkMs = 450 + Math.floor(Math.random() * 700);

    botTimerRef.current = window.setTimeout(async () => {
      botTimerRef.current = null;

      try {
        let gid = gameId;
        if (!gid) gid = await ensureGameStarted(uid, true);
        if (gid) await flushPendingMoves(gid, uid);

        const base = new Chess(nextChessAfterPlayer.fen());
        const pick = chooseBotMove(base);
        if (!pick?.move) return;

        const fenBefore = base.fen();
        const played = base.move(pick.move);
        const fenAfter = base.fen();

        sessionStorage.setItem(fenKey(uid), fenAfter);
        setChess(base);
        thinkStartRef.current = performance.now();

        const botUci = `${played.from}${played.to}${played.promotion ?? ""}`;
        const botPly = base.history().length;

        track("bot_move", {
          uid,
          gameId: gid || null,
          botMode: pick.mode,
          botIntent: pick.intent,
          thinkMs: botThinkMs,
          fenBefore,
          fenAfter,
          uci: botUci,
          san: played.san,
          plyAfter: botPly,
          playerLast: meta
        });

        if (gid) {
          try {
            await submitMove({
              uid,
              gameId: gid,
              fenBefore,
              uci: botUci,
              san: played.san,
              ply: botPly,
              thinkTimeMs: botThinkMs,
              isBot: true
            });
            track("bot_move_saved", { uid, gameId: gid, ply: botPly, botMode: pick.mode });
          } catch (e) {
            track("bot_move_save_error", { message: String(e?.message || e) });
          }
        }

        // ✅ after bot move: maybe report
        // note: profileStats might lag, but threshold uses board ply -> no lag
        maybeTriggerReport(base, { afterPlayerMove: false });

        // refresh profile in background
        refreshProfile(uid);
      } catch (e) {
        track("bot_move_error", { message: String(e?.message || e) });
      } finally {
        botThinkingRef.current = false;
        setBotThinking(false);
        setStatus("ready");
      }
    }, botThinkMs);
  }

  // resync when coming back
  useEffect(() => {
    const storedUid = getUid();
    if (storedUid && storedUid !== uid) {
      setUid(storedUid);
      const savedFen = sessionStorage.getItem(fenKey(storedUid));
      setChess(savedFen ? new Chess(savedFen) : new Chess());
      setGameId(sessionStorage.getItem(gameKey(storedUid)) || null);
      startedForUidRef.current = null;
      cancelBot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when uid changes
  useEffect(() => {
    if (!uid) return;

    const savedFen = sessionStorage.getItem(fenKey(uid));
    setChess(savedFen ? new Chess(savedFen) : new Chess());

    const cachedGame = sessionStorage.getItem(gameKey(uid));
    setGameId(cachedGame || null);

    thinkStartRef.current = performance.now();
    setLastQuality(null);

    recentFastMovesRef.current = 0;
    recentBlundersRef.current = 0;
    cancelBot();

    clearNudgeTimers();
    setNudge(null);

    setHintOpen(false);
    setHintData(null);

    // reset report flags for new uid/game
    setReportOpen(false);
    setReportData(null);
    setReportLocked(false);
    reportShownForThresholdRef.current = false;

    refreshProfile(uid);
  }, [uid]);

  // start game forced
  useEffect(() => {
    if (!uid) return;
    let alive = true;

    (async () => {
      const gid = await ensureGameStarted(uid, true);
      if (!alive) return;
      if (gid) await flushPendingMoves(gid, uid);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // interventions (admin)
  useEffect(() => {
    if (!uid) return;

    let alive = true;
    (async () => {
      try {
        const iv = await getInterventions(uid);
        if (!alive) return;
        setInterventions(iv?.interventions || {});
      } catch (e) {
        track("interventions_error", { message: String(e?.message || e) });
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid]);

  // confirmMoves from admin; nudge can be toggled by admin
  useEffect(() => {
    setConfirmMoves(!!interventions.confirmMoves);
    if (typeof interventions.nudgeTakeASecond === "boolean") {
      setNudgeEnabled(interventions.nudgeTakeASecond);
    }
  }, [interventions]);

  function resetGame() {
    const oldUid = uid;

    sessionStorage.removeItem(fenKey(oldUid));
    sessionStorage.removeItem(gameKey(oldUid));

    const freshUid = newUid();
    newSessionId();

    sessionStorage.removeItem(fenKey(freshUid));
    sessionStorage.removeItem(gameKey(freshUid));

    pendingMovesRef.current = pendingMovesRef.current.filter((m) => m.uid !== oldUid);
    setPendingCount(pendingMovesRef.current.length);

    cancelBot();
    clearNudgeTimers();
    setNudge(null);

    setHintOpen(false);
    setHintData(null);

    // report reset
    setReportOpen(false);
    setReportData(null);
    setReportLocked(false);
    reportShownForThresholdRef.current = false;

    setChess(new Chess());
    setGameId(null);
    thinkStartRef.current = performance.now();
    setLastQuality(null);

    startedForUidRef.current = null;

    setUid(freshUid);

    track("game_reset_new_uid", { oldUid, newUid: freshUid });

    setUidChangeMsg(`New UID generated: ${freshUid}`);
    setUidFlash(true);
    window.setTimeout(() => setUidFlash(false), 1200);
    window.setTimeout(() => setUidChangeMsg(""), 2500);

    setStatus("starting");
  }
function applyMove(sourceSquare, targetSquare, piece) {
  track("drop_attempt", { from: sourceSquare, to: targetSquare, piece });

  // lock wanneer report final / bot / report open
  if (reportLocked || botThinking || reportOpen) {
    track("move_blocked_ui_lock", { reportLocked, botThinking, reportOpen });
    return false;
  }

  const fenBefore = chess.fen();
  const next = new Chess(fenBefore);

  const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
  if (!move) {
    track("illegal_move", { from: sourceSquare, to: targetSquare, piece });
    return false;
  }

  const thinkTimeMs = performance.now() - thinkStartRef.current;

  if (thinkTimeMs < 900) recentFastMovesRef.current += 1;
  else recentFastMovesRef.current = Math.max(0, recentFastMovesRef.current - 1);


  // close hint AFTER confirm
  setHintOpen(false);
  setHintData(null);

  const hb = hoverBurstRef.current.count;
  const moveCountNow = next.history().length; // ply
  maybeShowNudge({ thinkTimeMs, hoverBurst: hb, moveCountNow });

  if (nudge) {
    const now = Date.now();
    const visibleFor = now - (nudge.shownAt || now);
    if (visibleFor >= NUDGE_MIN_VISIBLE_MS) {
      hideNudgeSoft(NUDGE_AFTER_MOVE_GRACE_MS);
    }
  }

  hoverBurstRef.current.count = 0;
  hoverBurstRef.current.windowStart = Date.now();

  sessionStorage.setItem(fenKey(uid), next.fen());
  setChess(next);
  thinkStartRef.current = performance.now();

  const payload = {
    uid,
    gameId: gameId || undefined,
    fenBefore,
    uci: `${sourceSquare}${targetSquare}`,
    san: move.san,
    ply: next.history().length,
    thinkTimeMs: Math.round(thinkTimeMs)
  };

  const playerMetaForBot = {
    uci: payload.uci,
    san: payload.san,
    thinkTimeMs: payload.thinkTimeMs,
    ply: payload.ply,
    quality: lastQuality ?? null
  };

  // report check
  maybeTriggerReport(next, { afterPlayerMove: true });

  if (!gameId) {
    pendingMovesRef.current.push(payload);
    setPendingCount(pendingMovesRef.current.length);
    track("move_queued_no_game", { uid, ply: payload.ply });

    (async () => {
      const gid = await ensureGameStarted(uid, true);
      if (gid) await flushPendingMoves(gid, uid);

      if (!(next.isGameOver && next.isGameOver())) {
        queueBotResponse(next, playerMetaForBot);
      }
      refreshProfile(uid);
    })();

    setStatus("starting");
    return true;
  }

  setStatus("saving");
  submitMove(payload)
    .then((r) => {
      setLastQuality(r.quality);
      track("move_saved", { quality: r.quality, thinkTimeMs: payload.thinkTimeMs });

      if (r.quality === "blunder") recentBlundersRef.current += 1;
      else recentBlundersRef.current = Math.max(0, recentBlundersRef.current - 1);

      if (!(next.isGameOver && next.isGameOver())) {
        queueBotResponse(next, { ...playerMetaForBot, quality: r.quality });
      }

      refreshProfile(uid);
    })
    .catch(async (e) => {
      const msg = String(e?.message || e);
      track("move_save_error", { message: msg });

      if (msg.includes("P2003") || msg.includes("Move_gameId_fkey")) {
        sessionStorage.removeItem(gameKey(uid));
        setGameId(null);
        startedForUidRef.current = null;

        pendingMovesRef.current.push(payload);
        setPendingCount(pendingMovesRef.current.length);
        track("move_requeued_after_fk", { uid, ply: payload.ply });

        const gid = await ensureGameStarted(uid, true);
        if (gid) await flushPendingMoves(gid, uid);
      }

      if (!(next.isGameOver && next.isGameOver())) {
        queueBotResponse(next, playerMetaForBot);
      }
      refreshProfile(uid);
    })
    .finally(() => setStatus("ready"));

  return true;
}

 function onPieceDrop(sourceSquare, targetSquare, piece) {
  // snelle lock (applyMove checkt ook)
  if (reportLocked || botThinking || reportOpen) return false;

  // simuleren om te zien of het een legale move is + fullmoves tellen
  const tmp = new Chess(chess.fen());
  const m = tmp.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
  if (!m) return false;

const currentFullMoves = profileStats?.moves ?? 0; // komt van DB/profile
const nextFullMoves = currentFullMoves + 1;        // na jouw move

  // ✅ random confirm modal (enkel als admin confirmMoves true)
  if (shouldAskConfirmNow(nextFullMoves)) {
    pendingConfirmMoveRef.current = { sourceSquare, targetSquare, piece };
    setConfirmOpen(true);
    track("confirm_shown", { uid, from: sourceSquare, to: targetSquare });
    return false; // snapback: we spelen move pas na "Yes"
  }

  // normaal: move uitvoeren
  return applyMove(sourceSquare, targetSquare, piece);
}


  function onSquareClick(square) {
    track("square_click", { square });
  }

  function onSquareRightClick(square) {
    track("square_right_click", { square });
  }

  function onMouseOverSquare(square) {
    track("hover", { square });

    const now = Date.now();
    const win = hoverBurstRef.current;

    if (!win.windowStart || now - win.windowStart > 10000) {
      win.windowStart = now;
      win.count = 0;
    }
    win.count += 1;
  }

  function buildHintPayload(ch) {
    const hb = hoverBurstRef.current.count;
    const thinkTimeMs = performance.now() - thinkStartRef.current;

    const behavioral = getBehavioralHint({
      segment,
      hoverBurst: hb,
      thinkTimeMs
    });

    const tactical = getTacticalHint(ch);

    return {
      behavioral,
      tactical,
      segment,
      hoverBurst: hb,
      thinkTimeMs: Math.round(thinkTimeMs),
      fen: ch.fen()
    };
  }

  function buildAndShowHint(ch, { silent = false } = {}) {
    const data = buildHintPayload(chess instanceof Chess ? ch : chess);

    setHintData(data);
    setHintOpen(true);

    if (!silent) {
      track("hint_used", {
        kind: "dynamic_panel",
        segment: data.segment,
        hoverBurst: data.hoverBurst,
        thinkTimeMs: data.thinkTimeMs
      });
    }

    refreshProfile(uid);
  }

  function toggleHint() {
    if (hintOpen) {
      setHintOpen(false);
      return;
    }
    buildAndShowHint(chess);
  }

  // ✅ board should not be draggable when locked / modal open
const draggable = !botThinking && !reportLocked && !reportOpen && !confirmOpen;

  const segmentBadge = useMemo(() => normalizeSegment(segment), [segment]);

  const movesFromApi = profileStats?.moves ?? 0;
  const isWarmingUp = movesFromApi < 6;

  function closeReportContinue() {
    track("report_close_continue", { uid, locked: reportLocked });
    setReportOpen(false);

    // if not final, let them continue
    if (!reportLocked) {
      setReportData(null);
    }
  }

  function reportTitle() {
    if (!reportData) return "Report";
    if (reportData.reason === "gameOver") return `Post-Game Report • ${reportData.outcome}`;
    if (reportData.reason === "threshold") return `Checkpoint Report • Move ${reportData.fullMoves}`;
    return "Report";
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      {/* LEFT */}
      <div className="card boardCard" style={{ flex: "0 0 420px" }}>
        <div className="chessboard-safe">
          <div className="chessboard-frame">
            <Chessboard
              position={chess.fen()}
              onPieceDrop={onPieceDrop}
              onSquareClick={onSquareClick}
              onSquareRightClick={onSquareRightClick}
              onMouseOverSquare={onMouseOverSquare}
              arePiecesDraggable={draggable}
              boardWidth={BOARD_WIDTH}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={resetGame}>
            New game (new UID)
          </button>
          <button className="btn btn-primary" onClick={toggleHint} disabled={reportOpen}>
            {hintOpen ? "Hide hint" : "Hint"}
          </button>
        </div>

        {/* ✅ HINT PANEL */}
        {hintOpen && hintData && (
          <div className="hintBox">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>Hint</strong>
              <span className="badge">segment: {segmentBadge}</span>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ opacity: 0.9, marginBottom: 6 }}>
                Play tip
              </div>
              <div style={{ lineHeight: 1.35 }}>{hintData.behavioral}</div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ opacity: 0.9, marginBottom: 6 }}>
                Position tip
              </div>
              <div style={{ lineHeight: 1.35 }}>{hintData.tactical}</div>
            </div>

            <div className="small" style={{ marginTop: 10, opacity: 0.7 }}>
              signals: hoverBurst={hintData.hoverBurst} • thinkTime≈
              {Math.round(hintData.thinkTimeMs / 100) / 10}s
            </div>
          </div>
        )}

        {/* ✅ dynamic nudge */}
        {nudgeEnabled && nudge && (
          <div className="nudgeBox">
            <strong style={{ display: "block", marginBottom: 4 }}>Tip</strong>
            {nudge.msg}
          </div>
        )}

        <p className="small" style={{ marginTop: 10, opacity: 0.85 }}>
          Opponent: <span className="badge">Adaptive bot</span>
        </p>

        {botThinking && (
          <p className="small" style={{ marginTop: 8, opacity: 0.85 }}>
            🤖 Bot is thinking...
          </p>
        )}
      </div>

      {/* RIGHT */}
      <div className="card" style={{ flex: "1 1 420px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className={`badge ${uidFlash ? "flash" : ""}`} title="Unique user identifier (per game/person)">
            UID: {uid}
          </span>

          <span className="badge">API: {status}</span>
        </div>

        {uidChangeMsg && (
          <p className="small" style={{ marginTop: 10, opacity: 0.95 }}>
            ✅ {uidChangeMsg}
          </p>
        )}

        <hr />

        <h3 style={{ marginTop: 0 }}>What gets collected</h3>
        <ul className="small">
          <li>Every navigation, click, hover (downsampled), focus/blur, hint usage</li>
          <li>Each move: SAN/UCI, think time, and a simple move-quality label</li>
          <li>Bot moves saved too (DB move + bot_move event with metadata)</li>
          <li>Device metadata: timezone/language/screen size/user-agent (trimmed)</li>
        </ul>

        <h3>Last move</h3>
        <p className="small">
          Quality label: <span className="badge">{lastQuality ?? "—"}</span>
        </p>

        <h3>Segment (live)</h3>
        <p className="small">
          segment:{" "}
          <span className={`badge ${isWarmingUp ? "" : ""}`}>
            {isWarmingUp ? "WARMING UP" : segmentBadge}
          </span>
        </p>

        {profileStats && (
          <p className="small" style={{ opacity: 0.85 }}>
            signals: avgThink={profileStats.avgThinkTime}s • blunderRate={profileStats.blunderRate}% • hovers=
            {profileStats.hoverCount} • hovers/move={profileStats.hoversPerMove} • hints={profileStats.hintsUsed}
          </p>
        )}

        <h3>Influence toggles (from admin)</h3>
        <ul className="small">
          <li>
            confirmMoves: <b>{String(confirmMoves)}</b>
          </li>
          <li>
            nudgeTakeASecond: <b>{String(interventions.nudgeTakeASecond ?? "default-on")}</b>
          </li>
        </ul>

        <p className="small">
          (Admin can change these per UID in the dashboard. This demonstrates “data → profile → influence”.)
        </p>

        <p className="small" style={{ opacity: 0.85 }}>
          GameId: <span className="badge">{gameId ?? "—"}</span>
        </p>

        <p className="small" style={{ opacity: 0.75 }}>
          Pending moves: <span className="badge">{pendingCount}</span>
        </p>
      </div>
{/* ===== CONFIRM MOVE MODAL ===== */}
{confirmOpen && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      zIndex: 9998
    }}
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) {
        lastConfirmAtRef.current = Date.now();
        setConfirmOpen(false);
        pendingConfirmMoveRef.current = null;
        track("confirm_cancel_outside", { uid });
      }
    }}
  >
    <div
      className="card"
      style={{
        width: "min(520px, 95vw)",
        borderRadius: 18
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginTop: 0 }}>Are you sure?</h3>
    

      <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button
          className="btn"
          onClick={() => {
            lastConfirmAtRef.current = Date.now();
            setConfirmOpen(false);
            pendingConfirmMoveRef.current = null;
            track("confirm_cancel", { uid });
          }}
        >
          No, cancel
        </button>

        <button
          className="btn btn-primary"
          onClick={() => {
            const m = pendingConfirmMoveRef.current;
            pendingConfirmMoveRef.current = null;

            lastConfirmAtRef.current = Date.now();
            setConfirmOpen(false);

            track("confirm_accept", { uid });
            if (m) applyMove(m.sourceSquare, m.targetSquare, m.piece);
          }}
        >
          Yes, play move
        </button>
      </div>
    </div>
  </div>
)}

      {/* ===== REPORT MODAL ===== */}
      {reportOpen && reportData && (
        <div
          className="reportOverlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999
          }}
          onMouseDown={(e) => {
            // click outside closes only if not final
            if (e.target === e.currentTarget && !reportLocked) closeReportContinue();
          }}
        >
          <div
            className="reportModal card"
            style={{
              width: "min(720px, 96vw)",
              maxHeight: "90vh",
              overflow: "auto",
              borderRadius: 18
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{reportTitle()}</h3>
              <span className="badge">UID: {uid}</span>
            </div>

            <hr />

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="badge">Outcome: {reportData.outcome}</span>
              <span className="badge">Moves: {reportData.fullMoves}</span>
              <span className="badge">Segment: {reportData.segment}</span>
              <span className="badge">Last quality: {reportData.lastQuality ?? "—"}</span>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="small" style={{ opacity: 0.9, marginBottom: 6 }}>
                Snapshot
              </div>
              <div className="small" style={{ opacity: 0.85 }}>
                {reportData.stats ? (
                  <>
                    avgThink={reportData.stats.avgThinkTime}s • blunderRate={reportData.stats.blunderRate}% • hovers=
                    {reportData.stats.hoverCount} • hovers/move={reportData.stats.hoversPerMove} • hints=
                    {reportData.stats.hintsUsed}
                  </>
                ) : (
                  <>No stats yet.</>
                )}
              </div>
            </div>

          <div style={{ marginTop: 14 }}>
  <div className="small" style={{ opacity: 0.9, marginBottom: 6 }}>
    Conclusion (from your data)
  </div>

  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
    <span className="badge">
      Style: {reportData.insight?.label ?? "—"}
    </span>
  </div>

  <div style={{ marginTop: 8, lineHeight: 1.35 }}>
    {reportData.insight?.text ?? "No conclusion yet."}
  </div>

  {reportData.stats && (
    <div className="small" style={{ marginTop: 10, opacity: 0.75 }}>
      Evidence: moves={reportData.stats.moves ?? "—"} • avgThink={reportData.stats.avgThinkTime ?? "—"}s •
      blunderRate={reportData.stats.blunderRate ?? "—"}% • hovers/move={reportData.stats.hoversPerMove ?? "—"} •
      hints={reportData.stats.hintsUsed ?? "—"}
    </div>
  )}
</div>


            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              {!reportLocked && (
                <button className="btn" onClick={closeReportContinue}>
                  OK, continue
                </button>
              )}
              <button className="btn btn-primary" onClick={resetGame}>
                New game
              </button>
            </div>

            {reportLocked && (
              <p className="small" style={{ marginTop: 10, opacity: 0.8 }}>
                Game ended. Start a new game to continue.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
