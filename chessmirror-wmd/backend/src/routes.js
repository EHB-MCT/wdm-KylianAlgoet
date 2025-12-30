import express from "express";
import { nanoid } from "nanoid";
import { prisma } from "./prisma.js";
import { hashIp, computeSegment } from "./util.js";
import { validateEvent } from "./middleware/validateEvent.js";
import { adminAuth } from "./middleware/adminAuth.js";
import { Chess } from "chess.js";
import { labelMoveQuality } from "./analysis/moveQuality.js";
import { getBehaviorInsight } from "./analysis/behaviorInsight.js";

export const router = express.Router();

async function upsertUserFromEvent(e) {
  const user = await prisma.user.upsert({
    where: { uid: e.uid },
    update: {
      tz: e.meta?.tz,
      lang: e.meta?.lang,
      userAgent: e.meta?.userAgent?.slice(0, 256),
      screenW: e.meta?.screenW,
      screenH: e.meta?.screenH,
    },
    create: {
      uid: e.uid,
      tz: e.meta?.tz,
      lang: e.meta?.lang,
      userAgent: e.meta?.userAgent?.slice(0, 256),
      screenW: e.meta?.screenW,
      screenH: e.meta?.screenH,
      profile: { create: {} },
    },
    include: { profile: true },
  });

  const session = await prisma.session.upsert({
    where: { id: e.sessionId },
    update: {},
    create: {
      id: e.sessionId,
      userId: user.id,
      ipHash: hashIp(e.ip),
    },
  });

  return { user, session };
}

// Track micro-events
router.post("/track/event", validateEvent, async (req, res) => {
  try {
    const e = req.cleanedEvent;
    e.ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket.remoteAddress;

    const { user, session } = await upsertUserFromEvent(e);

    // Store event
    await prisma.event.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        ts: new Date(e.ts),
        type: e.type,
        payload: e.payload ?? {},
      },
    });

    // Increment hintCount when relevant
    if (e.type === "hint_used") {
      const profile = await prisma.profile.findUnique({
        where: { userId: user.id },
      });
      const next = (profile?.hintCount ?? 0) + 1;

      const updated = await prisma.profile.update({
        where: { userId: user.id },
        data: { hintCount: next },
      });

      await prisma.profile.update({
        where: { userId: user.id },
        data: { segment: computeSegment(updated) },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start a new game for a user
router.post("/game/start", async (req, res) => {
  const { uid } = req.body || {};
  if (!uid || typeof uid !== "string")
    return res.status(400).json({ error: "uid required" });

  const user = await prisma.user.upsert({
    where: { uid },
    update: {},
    create: { uid, profile: { create: {} } },
  });

  const game = await prisma.game.create({ data: { userId: user.id } });
  res.json({ gameId: game.id });
});

// Submit a move + think time + FEN before move (so backend can evaluate)
router.post("/game/move", async (req, res) => {
  try {
    const { uid, gameId, fenBefore, uci, san, ply, thinkTimeMs } = req.body || {};
    if (!uid || !gameId || !fenBefore || !uci || !san || typeof ply !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }

    const user = await prisma.user.findUnique({
      where: { uid },
      include: { profile: true },
    });
    if (!user) return res.status(404).json({ error: "Unknown uid" });

    // Move quality heuristic
    const chess = new Chess(fenBefore);
    const move = chess.move(
      {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      },
      { sloppy: true }
    );

    const quality = labelMoveQuality(chess, move);

    // Store move
    await prisma.move.create({
      data: {
        gameId,
        ply,
        uci,
        san,
        thinkTimeMs: Math.max(0, Math.min(600000, thinkTimeMs ?? 0)),
        quality,
      },
    });

    // Update profile aggregates
    const prev =
      user.profile ?? (await prisma.profile.create({ data: { userId: user.id } }));

    const moveCount = prev.moveCount + 1;
    const blunderCount = prev.blunderCount + (quality === "blunder" ? 1 : 0);

    // incremental avg
    const avgThinkTimeMs = Math.round(
      (prev.avgThinkTimeMs * prev.moveCount + (thinkTimeMs ?? 0)) / moveCount
    );

    const updated = await prisma.profile.update({
      where: { userId: user.id },
      data: { moveCount, blunderCount, avgThinkTimeMs },
    });

    await prisma.profile.update({
      where: { userId: user.id },
      data: { segment: computeSegment(updated) },
    });

    res.json({ ok: true, quality });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== Admin routes =====
router.get("/admin/users", adminAuth, async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { profile: true },
  });

  res.json(
    users.map((u) => ({
      uid: u.uid,
      createdAt: u.createdAt,
      segment: u.profile?.segment ?? "unknown",
      moveCount: u.profile?.moveCount ?? 0,
      blunderCount: u.profile?.blunderCount ?? 0,
      avgThinkTimeMs: u.profile?.avgThinkTimeMs ?? 0,
      hintCount: u.profile?.hintCount ?? 0,
    }))
  );
});

router.get("/admin/users/:uid/profile", adminAuth, async (req, res) => {
  const uid = req.params.uid;

  const user = await prisma.user.findUnique({
    where: { uid },
    include: { profile: true },
  });
  if (!user) return res.status(404).json({ error: "Not found" });

  // ✅ FIX 1: ensure profile exists so we can safely spread + read fields
  if (!user.profile) {
    user.profile = await prisma.profile.create({ data: { userId: user.id } });
  }

  // trend data: last 200 moves
  const games = await prisma.game.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { moves: { orderBy: { ply: "asc" }, take: 200 } },
  });

  const flatMoves = games
    .flatMap((g) =>
      g.moves.map((m) => ({
        gameId: g.id,
        ply: m.ply,
        thinkTimeMs: m.thinkTimeMs,
        quality: m.quality,
        createdAt: m.createdAt,
      }))
    )
    .slice(-200);

  // recent events (sample) + hoverCount
  const events = await prisma.event.findMany({
    where: { userId: user.id },
    orderBy: { ts: "desc" },
    take: 200,
  });

  const hoverCount = events.filter((e) => e.type === "hover").length;

  const moveCount = user.profile.moveCount ?? 0;
  const blunderCount = user.profile.blunderCount ?? 0;
  const avgThinkTimeMs = user.profile.avgThinkTimeMs ?? 0;

  const blunderRate = moveCount > 0 ? Math.round((blunderCount / moveCount) * 100) : 0;

  const stats = {
    avgThinkTime: Math.round((avgThinkTimeMs / 1000) * 10) / 10, // seconds (1 dec)
    blunderRate,
    hoverCount,
  };

  const insight = getBehaviorInsight(stats);
  const segment = insight.label;

  // ✅ FIX 2: persist computed segment (Optie B) (profile guaranteed now)
  if (user.profile.segment !== segment) {
    user.profile = await prisma.profile.update({
      where: { userId: user.id },
      data: { segment },
    });
  }

  res.json({
    uid: user.uid,
    createdAt: user.createdAt,
    meta: {
      tz: user.tz,
      lang: user.lang,
      userAgent: user.userAgent,
      screenW: user.screenW,
      screenH: user.screenH,
    },

    // keep backward compatibility for frontend
    profile: {
      ...user.profile,
      segment,
    },

    // NEW: insight + segment + extra metrics
    segment,
    insight,
    stats,

    moves: flatMoves,

    // OPTIONAL: show sample events in admin profile response
    recentEvents: events.slice(0, 25),
  });
});

router.get("/admin/users/:uid/events", adminAuth, async (req, res) => {
  const uid = req.params.uid;
  const user = await prisma.user.findUnique({ where: { uid } });
  if (!user) return res.status(404).json({ error: "Not found" });

  const take = Math.min(500, Math.max(1, parseInt(req.query.take ?? "200", 10)));
  const events = await prisma.event.findMany({
    where: { userId: user.id },
    orderBy: { ts: "desc" },
    take,
  });

  res.json(events);
});

router.post("/admin/users/:uid/interventions", adminAuth, async (req, res) => {
  const uid = req.params.uid;
  const user = await prisma.user.findUnique({ where: { uid } });
  if (!user) return res.status(404).json({ error: "Not found" });

  const interventions = req.body?.interventions ?? {};
  const decision = await prisma.adminDecision.create({
    data: {
      userId: user.id,
      interventions,
    },
  });

  res.json({ ok: true, decisionId: decision.id });
});

router.get("/interventions/:uid", async (req, res) => {
  // user-facing fetch (no admin password): last decision for uid
  const uid = req.params.uid;
  const user = await prisma.user.findUnique({ where: { uid } });
  if (!user) return res.json({ interventions: {} });

  const last = await prisma.adminDecision.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({ interventions: last?.interventions ?? {} });
});
