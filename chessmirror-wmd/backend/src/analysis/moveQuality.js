/**
 * Heuristic "move quality":
 * - If after the move, the moved piece can be captured immediately by opponent
 *   and the capture is legal, we label it as a "blunder" (hung piece).
 *
 * This is intentionally simple so it runs fast and fully local.
 */
export function labelMoveQuality(chess, lastMove) {
  // lastMove from chess.js has {from,to,piece,color,san,flags,...}
  if (!lastMove) return "good";

  const to = lastMove.to;
  // switch turn to opponent already happened in chess.js after move
  // Check if opponent has any legal move capturing the piece on `to`
  const legalMoves = chess.moves({ verbose: true });
  const canCaptureTo = legalMoves.some(m => m.to === to && m.flags.includes("c"));

  return canCaptureTo ? "blunder" : "good";
}
