import React, { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getUid, newUid, newSessionId } from "../lib/uid";
import { track } from "../lib/tracker";
import { getInterventions, startGame, submitMove } from "../lib/api";

function ms(n) {
  return `${Math.round(n)}ms`;
}

export default function Home() {
  // ✅ UID is now state so it can change
  const [uid, setUid] = useState(() => getUid());

  const [gameId, setGameId] = useState(null);
  const [chess, setChess] = useState(() => new Chess());
  const [status, setStatus] = useState("ready");
  const [lastQuality, setLastQuality] = useState(null);

  const [interventions, setInterventions] = useState({});
  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudge, setNudge] = useState(false);

  // ✅ UI feedback when UID changes
  const [uidFlash, setUidFlash] = useState(false);
  const [uidChangeMsg, setUidChangeMsg] = useState("");

  const thinkStartRef = useRef(performance.now());

  // Start game whenever UID changes (Option A)
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const g = await startGame(uid);
        if (!alive) return;

        setGameId(g.gameId);
        track("game_start", { gameId: g.gameId, uid });

        const iv = await getInterventions(uid);
        if (!alive) return;

        setInterventions(iv.interventions || {});
      } catch (e) {
        // keep UI usable even if API hiccups
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid]);

  useEffect(() => {
    // Apply admin interventions (data influences UI)
    setConfirmMoves(!!interventions.confirmMoves);
    setNudge(!!interventions.nudgeTakeASecond);
  }, [interventions]);

  function resetGame() {
    // ✅ Option A: new game = new person
    const oldUid = uid;
    const freshUid = newUid();
    newSessionId(); // optional but clean separation in your DB/events

    setChess(new Chess());
    thinkStartRef.current = performance.now();
    setLastQuality(null);

    // update UID (triggers /game/start + interventions fetch)
    setUid(freshUid);

    // tracking
    track("game_reset_new_uid", { oldUid, newUid: freshUid, oldGameId: gameId });

    // ✅ UI feedback for jury
    setUidChangeMsg(`New UID generated: ${freshUid}`);
    setUidFlash(true);
    window.setTimeout(() => setUidFlash(false), 1200);
    window.setTimeout(() => setUidChangeMsg(""), 2500);
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

    // subtle influence: confirm modal for users admin flagged
    if (confirmMoves) {
      const ok = window.confirm("Confirm this move?");
      track("confirm_prompt", { ok });
      if (!ok) return false;
    }

    setStatus("saving");

    submitMove({
      uid,
      gameId,
      fenBefore,
      uci: `${sourceSquare}${targetSquare}`,
      san: move.san,
      ply: next.history().length,
      thinkTimeMs: Math.round(thinkTimeMs)
    })
      .then((r) => {
        setLastQuality(r.quality);
        track("move_saved", { quality: r.quality, thinkTimeMs: Math.round(thinkTimeMs) });
      })
      .catch(() => {
        track("move_save_error", {});
      })
      .finally(() => {
        setStatus("ready");
      });

    setChess(next);
    thinkStartRef.current = performance.now();
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
          <button className="btn" onClick={resetGame}>New game (new UID)</button>
          <button className="btn" onClick={useHint}>Hint</button>
        </div>

        {nudge && (
          <p className="small" style={{ marginTop: 10 }}>
            🧠 Nudge: take 5 seconds before committing your move.
          </p>
        )}
      </div>

      <div className="card" style={{ flex: "1 1 420px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          {/* ✅ UID visibly "flashes" when changed */}
          <span
            className="badge"
            style={{
              borderColor: uidFlash ? "#7CFFB2" : undefined,
              boxShadow: uidFlash ? "0 0 0 2px rgba(124,255,178,0.25)" : "none",
              transition: "all 250ms ease"
            }}
            title="Unique user identifier (per game/person)"
          >
            UID: {uid}
          </span>

          <span className="badge">API: {status}</span>
        </div>

        {/* ✅ short message so jury can't miss it */}
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
      </div>
    </div>
  );
}
