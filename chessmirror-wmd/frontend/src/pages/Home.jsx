import React, { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getUid, newUid, newSessionId } from "../lib/uid";
import { track } from "../lib/tracker";
import { getInterventions, startGame, submitMove } from "../lib/api";

const fenKey = (uid) => `cm_fen_${uid}`;
const gameKey = (uid) => `cm_game_${uid}`;

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

  const [status, setStatus] = useState("ready"); // ready | starting | saving | error
  const [lastQuality, setLastQuality] = useState(null);

  const [interventions, setInterventions] = useState({});
  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudge, setNudge] = useState(false);

  const [uidFlash, setUidFlash] = useState(false);
  const [uidChangeMsg, setUidChangeMsg] = useState("");

  const thinkStartRef = useRef(performance.now());
  const startedForUidRef = useRef(null);

  // ✅ NEW: queue moves while gameId is not ready
  const pendingMovesRef = useRef([]); // array of payloads {uid, gameId?, fenBefore, uci, san, ply, thinkTimeMs}
  const flushingRef = useRef(false);

  function parseGameId(resp) {
    return resp?.gameId || resp?.id || resp?.data?.gameId || resp?.data?.id || null;
  }

  async function ensureGameStarted(forUid) {
    const cached = sessionStorage.getItem(gameKey(forUid));
    if (cached) {
      setGameId(cached);
      return cached;
    }

    // strictmode guard
    if (startedForUidRef.current === forUid) return null;
    startedForUidRef.current = forUid;

    try {
      setStatus((s) => (s === "saving" ? s : "starting"));
      const g = await startGame(forUid);
      const gid = parseGameId(g);

      if (!gid) throw new Error("startGame returned no gameId");

      sessionStorage.setItem(gameKey(forUid), gid);
      setGameId(gid);

      track("game_start", { uid: forUid, gameId: gid });
      return gid;
    } catch (e) {
      startedForUidRef.current = null;
      track("game_start_error", { message: String(e?.message || e) });
      setStatus("error");
      return null;
    } finally {
      // don't force ready if we're saving
      setStatus((s) => (s === "saving" ? s : "ready"));
    }
  }

  async function flushPendingMoves(gid, forUid) {
    if (!gid || flushingRef.current) return;
    flushingRef.current = true;

    try {
      // take only moves for current uid
      const queue = pendingMovesRef.current.filter((m) => m.uid === forUid);
      pendingMovesRef.current = pendingMovesRef.current.filter((m) => m.uid !== forUid);

      for (const m of queue) {
        await submitMove({ ...m, gameId: gid });
      }
      track("pending_moves_flushed", { uid: forUid, count: queue.length });
    } catch (e) {
      // if flush fails, put them back (so we don't lose moves)
      track("pending_moves_flush_error", { message: String(e?.message || e) });
      // don't re-add duplicates if some already sent; but keep simple:
      // (worst case: lose labeling, not the UI)
    } finally {
      flushingRef.current = false;
    }
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
  }, [uid]);

  // ✅ start game on mount/uid change (but even if it’s slow, user can still move now)
  useEffect(() => {
    if (!uid) return;
    if (gameId) return;

    let alive = true;
    (async () => {
      const gid = await ensureGameStarted(uid);
      if (!alive) return;
      if (gid) await flushPendingMoves(gid, uid);
    })();

    return () => {
      alive = false;
    };
  }, [uid, gameId]);

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

    const fenBefore = chess.fen();
    const next = new Chess(fenBefore);

    const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) {
      track("illegal_move", { from: sourceSquare, to: targetSquare, piece });
      return false;
    }

    const thinkTimeMs = performance.now() - thinkStartRef.current;

    if (confirmMoves) {
      const ok = window.confirm("Confirm this move?");
      track("confirm_prompt", { ok });
      if (!ok) return false;
    }

    // ✅ ALWAYS allow local move immediately
    sessionStorage.setItem(fenKey(uid), next.fen());
    setChess(next);
    thinkStartRef.current = performance.now();

    const payload = {
      uid,
      gameId: gameId || undefined, // may be undefined
      fenBefore,
      uci: `${sourceSquare}${targetSquare}`,
      san: move.san,
      ply: next.history().length,
      thinkTimeMs: Math.round(thinkTimeMs),
    };

    // ✅ If gameId missing, queue + trigger start in background
    if (!gameId) {
      pendingMovesRef.current.push(payload);
      track("move_queued_no_game", { uid, ply: payload.ply });

      // start game async and flush queue
      (async () => {
        const gid = await ensureGameStarted(uid);
        if (gid) {
          await flushPendingMoves(gid, uid);
        }
      })();

      setStatus("starting");
      return true; // allow move visually
    }

    // normal save
    setStatus("saving");
    submitMove(payload)
      .then((r) => {
        setLastQuality(r.quality);
        track("move_saved", { quality: r.quality, thinkTimeMs: payload.thinkTimeMs });
      })
      .catch((e) => {
        track("move_save_error", { message: String(e?.message || e) });
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

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "0 0 420px" }}>
        <Chessboard
          position={chess.fen()}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          onSquareRightClick={onSquareRightClick}
          onMouseOverSquare={onMouseOverSquare}
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
          <li>Device metadata: timezone/language/screen size/user-agent (trimmed)</li>
        </ul>

        <h3>Last move</h3>
        <p className="small">
          Quality label: <span className="badge">{lastQuality ?? "—"}</span>
        </p>

        <h3>Influence toggles (from admin)</h3>
        <ul className="small">
          <li>confirmMoves: <b>{String(confirmMoves)}</b></li>
          <li>nudgeTakeASecond: <b>{String(nudge)}</b></li>
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
