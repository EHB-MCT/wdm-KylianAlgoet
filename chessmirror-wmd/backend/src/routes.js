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

/**
 * HARD FIX: Race-safe user+profile creation.
 * - Create user if missing (createMany + skipDuplicates)
 * - Always update meta
 * - Ensure profile exists (createMany + skipDuplicates)
 * - Return user with profile
 */
async function getOrCreateUser(uid, meta = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [
        {
          uid,
          tz: meta?.tz,
          lang: meta?.lang,
          userAgent: meta?.userAgent?.slice(0, 256),
          screenW: meta?.screenW,
          screenH: meta?.screenH,
        },
      ],
      skipDuplicates: true,
    });

    await tx.user.update({
      where: { uid },
      data: {
        tz: meta?.tz,
        lang: meta?.lang,
        userAgent: meta?.userAgent?.slice(0, 256),
        screenW: meta?.screenW,
        screenH: meta?.screenH,
      },
    });

    const user = await tx.user.findUnique({ where: { uid } });
    if (!user) throw new Error("User not found after createMany");

    await tx.profile.createMany({
      data: [{ userId: user.id }],
      skipDuplicates: true,
    });

    return tx.user.findUnique({
      where: { uid },
      include: { profile: true },
    });
  });
}

async function ensureProfile(userId) {
  await prisma.profile.createMany({
    data: [{ userId }],
    skipDuplicates: true,
  });
  return prisma.profile.findUnique({ where: { userId } });
}

async function safeUserByUid(uid) {
  const user = await prisma.user.findUnique({
    where: { uid },
    include: { profile: true },
  });
  if (!user) return null;

  if (!user.profile) {
    user.profile = await ensureProfile(user.id);
  }
  return user;
}

async function upsertSessionForEvent(userId, sessionId, ip) {
  return prisma.session.upsert({
    where: { id: sessionId },
    update: {},
    create: {
      id: sessionId,
      userId,
      ipHash: hashIp(ip),
    },
  });
}

// ===== Track micro-events =====
router.post("/track/event", validateEvent, async (req, res) => {
  try {
    const e = req.cleanedEvent;

    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const user = await getOrCreateUser(e.uid, e.meta);
    if (!user) return res.status(500).json({ error: "User create failed" });

    const session = await upsertSessionForEvent(user.id, e.sessionId, ip);

    await prisma.event.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        ts: new Date(e.ts),
        type: e.type,
        payload: e.payload ?? {},
      },
    });

    if (e.type === "hint_used") {
      const profile = user.profile ?? (await ensureProfile(user.id));
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
    res.status(500).json({ error: "Server error", code: err?.code });
  }
});

// ===== Game start =====
router.post("/game/start", async (req, res) => {
  try {
    const { uid, meta } = req.body || {};
    if (!uid || typeof uid !== "string") {
      return res.status(400).json({ error: "uid required" });
    }

    const user = await getOrCreateUser(uid, meta || {});
    if (!user) return res.status(500).json({ error: "User create failed" });

    const game = await prisma.game.create({
      data: { userId: user.id },
      select: { id: true },
    });

    return res.json({ gameId: game.id });
  } catch (err) {
    console.error("START ERROR:", err);
    return res.status(500).json({ error: "Server error", code: err?.code });
  }
});

// ===== Submit move =====
router.post("/game/move", async (req, res) => {
  try {
    const {
      uid,
      gameId,
      fenBefore,
      uci,
      san,
      ply,
      thinkTimeMs,
      isBot, // ✅ NEW (frontend stuurt true voor bot moves)
    } = req.body || {};

    if (
      !uid ||
      !gameId ||
      !fenBefore ||
      !uci ||
      !san ||
      typeof ply !== "number"
    ) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const user = await safeUserByUid(uid);
    if (!user) return res.status(404).json({ error: "Unknown uid" });

    // ✅ HARD FK FIX: ensure the game exists (even after docker down -v)
    await prisma.game.upsert({
      where: { id: gameId },
      update: {},
      create: { id: gameId, userId: user.id },
    });

    // Validate move is legal (for BOTH player + bot)
    const chess = new Chess(fenBefore);
    const parsed = chess.move(
      {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      },
      { sloppy: true }
    );

    if (!parsed) {
      return res.status(400).json({ error: "Illegal/invalid move" });
    }

    const bot = !!isBot;

    // ✅ quality: only for PLAYER moves
    const quality = bot ? null : labelMoveQuality(chess, parsed);

    // ✅ create move, but dedupe if already exists (gameId, ply)
    try {
      await prisma.move.create({
        data: {
          gameId,
          ply,
          uci,
          san,
          thinkTimeMs: Math.max(0, Math.min(600000, thinkTimeMs ?? 0)),
          quality,
          isBot: bot,
        },
      });
    } catch (err) {
      // Unique constraint hit => retry/double-submit: return ok
      if (err?.code === "P2002") {
        return res.json({
          ok: true,
          quality: bot ? null : "ok",
          deduped: true,
          isBot: bot,
        });
      }
      throw err;
    }

    // ✅ Do NOT let bot moves affect profile or segment
    if (bot) {
      return res.json({ ok: true, quality: null, isBot: true });
    }

    // --- Player move => update profile stats ---
    const prev = user.profile ?? (await ensureProfile(user.id));

    const moveCount = (prev?.moveCount ?? 0) + 1;
    const blunderCount =
      (prev?.blunderCount ?? 0) + (quality === "blunder" ? 1 : 0);

    const prevMoveCount = prev?.moveCount ?? 0;
    const prevAvg = prev?.avgThinkTimeMs ?? 0;

    const avgThinkTimeMs = Math.round(
      (prevAvg * prevMoveCount + (thinkTimeMs ?? 0)) / moveCount
    );

    const updated = await prisma.profile.update({
      where: { userId: user.id },
      data: { moveCount, blunderCount, avgThinkTimeMs },
    });

    await prisma.profile.update({
      where: { userId: user.id },
      data: { segment: computeSegment(updated) },
    });

    return res.json({ ok: true, quality, isBot: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", code: err?.code });
  }
});

// ===== Admin routes =====
router.get("/admin/users", adminAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/users/:uid/profile", adminAuth, async (req, res) => {
  try {
    const uid = req.params.uid;

    const user = await prisma.user.findUnique({
      where: { uid },
      include: { profile: true },
    });
    if (!user) return res.status(404).json({ error: "Not found" });

    let profile = user.profile;
    if (!profile) profile = await ensureProfile(user.id);

    // Profile-based stats (HUMAN ONLY, because we never update profile on bot moves)
    const moveCount = profile?.moveCount ?? 0;
    const blunderCount = profile?.blunderCount ?? 0;
    const avgThinkTimeMs = profile?.avgThinkTimeMs ?? 0;
    const hintCount = profile?.hintCount ?? 0;

    const blunderRate =
      moveCount > 0 ? Math.round((blunderCount / moveCount) * 100) : 0;

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
          isBot: m.isBot,
          createdAt: m.createdAt,
        }))
      )
      .slice(-200);

    const events = await prisma.event.findMany({
      where: { userId: user.id },
      orderBy: { ts: "desc" },
      take: 200,
    });

    // Hovers are events, but we normalize by HUMAN moveCount (profile-based) for consistency
    const hoverCount = events.filter((e) => e.type === "hover").length;
    const hoversPerMove =
      moveCount > 0 ? Math.round((hoverCount / moveCount) * 10) / 10 : 0;

    const stats = {
      moves: moveCount,
      avgThinkTime: Math.round((avgThinkTimeMs / 1000) * 10) / 10,
      blunderRate,
      hintCount,
      hoverCount,
      hoversPerMove,
    };

    const insight = getBehaviorInsight(stats);
    const segment = insight.label;

    if (profile?.segment !== segment) {
      profile = await prisma.profile.update({
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
      profile: {
        ...profile,
        segment,
      },
      segment,
      insight,
      stats,
      moves: flatMoves, // includes bot+human for the chart/table, but stats ignore bot
      recentEvents: events.slice(0, 25),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/users/:uid/events", adminAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/users/:uid/interventions", adminAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/interventions/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const user = await prisma.user.findUnique({ where: { uid } });
    if (!user) return res.json({ interventions: {} });

    const last = await prisma.adminDecision.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ interventions: last?.interventions ?? {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
