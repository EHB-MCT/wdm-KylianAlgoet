import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getUid } from "../lib/uid";
import { track } from "../lib/tracker";
import { getInterventions, startGame, submitMove } from "../lib/api";

function ms(n){ return `${Math.round(n)}ms`; }

export default function Home() {
  const uid = useMemo(() => getUid(), []);
  const [gameId, setGameId] = useState(null);
  const [chess, setChess] = useState(() => new Chess());
  const [status, setStatus] = useState("ready");
  const [lastQuality, setLastQuality] = useState(null);
  const [interventions, setInterventions] = useState({});
  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudge, setNudge] = useState(false);

  const thinkStartRef = useRef(performance.now());

  useEffect(() => {
    (async () => {
      const g = await startGame(uid);
      setGameId(g.gameId);
      track("game_start", { gameId: g.gameId });

      const iv = await getInterventions(uid);
      setInterventions(iv.interventions || {});
    })();
  }, [uid]);

  useEffect(() => {
    // Apply admin interventions (data influences UI)
    setConfirmMoves(!!interventions.confirmMoves);
    setNudge(!!interventions.nudgeTakeASecond);
  }, [interventions]);

  function resetGame() {
    setChess(new Chess());
    thinkStartRef.current = performance.now();
    setLastQuality(null);
    track("game_reset", { gameId });
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

    // submit to backend for quality label + profiling
    setStatus("saving");
    submitMove({
      uid,
      gameId,
      fenBefore,
      uci: `${sourceSquare}${targetSquare}`,
      san: move.san,
      ply: next.history().length,
      thinkTimeMs: Math.round(thinkTimeMs)
    }).then((r) => {
      setLastQuality(r.quality);
      track("move_saved", { quality: r.quality, thinkTimeMs: Math.round(thinkTimeMs) });
    }).catch(() => {
      track("move_save_error", {});
    }).finally(() => {
      setStatus("ready");
    });

    // update local board
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
    // Not a chess engine hint—just a nudge event to demonstrate logging + profile
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
          <button className="btn" onClick={resetGame}>New game</button>
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
          <span className="badge">UID: {uid}</span>
          <span className="badge">API: {status}</span>
        </div>

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
