import crypto from "crypto";

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function computeSegment(profile) {
  // Very simple segmentation rules (good enough for WMD demo)
  const blunderRate = profile.moveCount > 0 ? profile.blunderCount / profile.moveCount : 0;
  if (profile.hintCount >= 5) return "learner";
  if (profile.avgThinkTimeMs <= 2500 && blunderRate >= 0.15) return "impulsive";
  if (profile.avgThinkTimeMs >= 7000 && blunderRate <= 0.08) return "careful";
  return "unknown";
}
