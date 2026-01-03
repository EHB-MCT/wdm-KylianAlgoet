import React, { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getUid, newUid, newSessionId } from "../lib/uid";
import { track } from "../lib/tracker";
import { getInterventions, startGame, submitMove } from "../lib/api";

const fenKey = (uid) => `cm_fen_${uid}`;
const gameKey = (uid) => `cm_game_${uid}`;

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
  return score; // + = white better, - = black better
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

// chess.js compatibility: v0 uses inCheck(), v1 uses isCheck()
function isCheckCompat(ch) {
  return (
    (typeof ch.isCheck === "function" && ch.isCheck()) ||
    (typeof ch.inCheck === "function" && ch.inCheck()) ||
    false
  );
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

  const [status, setStatus] = useState("ready"); // ready | starting | saving | bot | error
  const [lastQuality, setLastQuality] = useState(null);

  const [interventions, setInterventions] = useState({});
  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudge, setNudge] = useState(false);

  const [uidFlash, setUidFlash] = useState(false);
  const [uidChangeMsg, setUidChangeMsg] = useState("");

  const thinkStartRef = useRef(performance.now());
  const startedForUidRef = useRef(null);

  // queue moves while gameId is not ready
  const pendingMovesRef = useRef([]);
  const flushingRef = useRef(false);

  // --- BOT STATE ---
  const botThinkingRef = useRef(false); // internal guard (no re-render)
  const botTimerRef = useRef(null);

  // ✅ UI state (causes re-render) — THIS FIXES YOUR “1 move then stuck”
  const [botThinking, setBotThinking] = useState(false);

  // small behavior memory (client-side) to make bot “stimulus”
  const recentFastMovesRef = useRef(0);
  const recentBlundersRef = useRef(0);

  function parseGameId(resp) {
    return resp?.gameId || resp?.id || resp?.data?.gameId || resp?.data?.id || null;
  }

  function cancelBot() {
    if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    botTimerRef.current = null;
    botThinkingRef.current = false;
    setBotThinking(false); // ✅ unlock UI
  }

  // cleanup on unmount
  useEffect(() => {
    return () => cancelBot();
  }, []);

  async function ensureGameStarted(forUid, force = false) {
    const cached = sessionStorage.getItem(gameKey(forUid));

    // use cache only if not forcing
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

  function queueBotResponse(nextChessAfterPlayer, meta) {
    if (!nextChessAfterPlayer || nextChessAfterPlayer.isGameOver()) return;
    if (botThinkingRef.current) return;

    botThinkingRef.current = true;
    setBotThinking(true); // ✅ re-render -> unlock later works
    setStatus("bot");

    const botThinkMs = 450 + Math.floor(Math.random() * 700);

    botTimerRef.current = window.setTimeout(async () => {
      botTimerRef.current = null;

      try {
        // Ensure game exists (DB might be wiped)
        let gid = gameId;
        if (!gid) gid = await ensureGameStarted(uid, true);
        if (gid) await flushPendingMoves(gid, uid);

        const base = new Chess(nextChessAfterPlayer.fen());
        const pick = chooseBotMove(base);
        if (!pick?.move) return;

        const fenBefore = base.fen();
        const played = base.move(pick.move);
        const fenAfter = base.fen();

        // Update UI immediately
        sessionStorage.setItem(fenKey(uid), fenAfter);
        setChess(base);
        thinkStartRef.current = performance.now();

        const botUci = `${played.from}${played.to}${played.promotion ?? ""}`;
        const botPly = base.history().length;

        // 1) Log bot move as event (rich metadata)
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
          playerLast: meta,
        });

        // 2) Also store bot move in moves table
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
                isBot: true, 

            });
            track("bot_move_saved", { uid, gameId: gid, ply: botPly, botMode: pick.mode });
          } catch (e) {
            track("bot_move_save_error", { message: String(e?.message || e) });
          }
        }
      } catch (e) {
        track("bot_move_error", { message: String(e?.message || e) });
      } finally {
        botThinkingRef.current = false;
        setBotThinking(false); // ✅ unlock UI
        setStatus("ready");
      }
    }, botThinkMs);
  }

  // resync when coming back from /admin etc
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

  // when uid changes: load fen + gameId
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
  }, [uid]);

  // ✅ start game on mount/uid change (FORCED) so docker down -v never breaks cache
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

  // interventions never block play
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

  useEffect(() => {
    setConfirmMoves(!!interventions.confirmMoves);
    setNudge(!!interventions.nudgeTakeASecond);
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

    cancelBot();

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

  function onPieceDrop(sourceSquare, targetSquare, piece) {
    track("drop_attempt", { from: sourceSquare, to: targetSquare, piece });

    // ✅ block while bot is thinking (state, not ref)
    if (botThinking) {
      track("move_blocked_bot_turn", { from: sourceSquare, to: targetSquare });
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

    if (confirmMoves) {
      const ok = window.confirm("Confirm this move?");
      track("confirm_prompt", { ok });
      if (!ok) return false;
    }

    // update UI immediately
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
      thinkTimeMs: Math.round(thinkTimeMs),
    };

    const playerMetaForBot = {
      uci: payload.uci,
      san: payload.san,
      thinkTimeMs: payload.thinkTimeMs,
      ply: payload.ply,
      quality: lastQuality ?? null,
    };

    // If gameId missing, queue + start in background
    if (!gameId) {
      pendingMovesRef.current.push(payload);
      track("move_queued_no_game", { uid, ply: payload.ply });

      (async () => {
        const gid = await ensureGameStarted(uid, true);
        if (gid) await flushPendingMoves(gid, uid);
        queueBotResponse(next, playerMetaForBot);
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

        queueBotResponse(next, { ...playerMetaForBot, quality: r.quality });
      })
      .catch(async (e) => {
        const msg = String(e?.message || e);
        track("move_save_error", { message: msg });

        // ✅ FK / stale gameId recovery after docker down -v
        if (msg.includes("P2003") || msg.includes("Move_gameId_fkey")) {
          sessionStorage.removeItem(gameKey(uid));
          setGameId(null);
          startedForUidRef.current = null;

          pendingMovesRef.current.push(payload);
          track("move_requeued_after_fk", { uid, ply: payload.ply });

          const gid = await ensureGameStarted(uid, true);
          if (gid) await flushPendingMoves(gid, uid);
        }

        queueBotResponse(next, playerMetaForBot);
      })
      .finally(() => setStatus("ready"));

    return true;
  }

  function onSquareClick(square) {
    track("square_click", { square });
  }

  function onSquareRightClick(square) {
    track("square_right_click", { square });
  }

  function onMouseOverSquare(square) {
    track("hover", { square });
  }

  function useHint() {
    track("hint_used", { kind: "nudge" });
    alert("Hint: slow down and scan captures/checks first.");
  }

  // ✅ IMPORTANT: use STATE so board updates when bot stops thinking
  const draggable = !botThinking;

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "0 0 420px" }}>
        <Chessboard
          position={chess.fen()}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          onSquareRightClick={onSquareRightClick}
          onMouseOverSquare={onMouseOverSquare}
          arePiecesDraggable={draggable}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={resetGame}>
            New game (new UID)
          </button>
          <button className="btn" onClick={useHint}>
            Hint
          </button>
        </div>

        {nudge && (
          <p className="small" style={{ marginTop: 10 }}>
            🧠 Nudge: take 5 seconds before committing your move.
          </p>
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

      <div className="card" style={{ flex: "1 1 420px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span
            className="badge"
            style={{
              borderColor: uidFlash ? "#7CFFB2" : undefined,
              boxShadow: uidFlash ? "0 0 0 2px rgba(124,255,178,0.25)" : "none",
              transition: "all 250ms ease",
            }}
            title="Unique user identifier (per game/person)"
          >
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

        <h3>Influence toggles (from admin)</h3>
        <ul className="small">
          <li>
            confirmMoves: <b>{String(confirmMoves)}</b>
          </li>
          <li>
            nudgeTakeASecond: <b>{String(nudge)}</b>
          </li>
        </ul>

        <p className="small">
          (Admin can change these per UID in the dashboard. This demonstrates “data → profile → influence”.)
        </p>

        <p className="small" style={{ opacity: 0.85 }}>
          GameId: <span className="badge">{gameId ?? "—"}</span>
        </p>

        <p className="small" style={{ opacity: 0.75 }}>
          Pending moves: <span className="badge">{pendingMovesRef.current.length}</span>
        </p>
      </div>
    </div>
  );
}
