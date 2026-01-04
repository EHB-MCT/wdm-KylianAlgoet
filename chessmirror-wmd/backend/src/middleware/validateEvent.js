import { z } from "zod";
import { clamp } from "../util.js";

const EventSchema = z.object({
  uid: z.string().min(3).max(128),
  sessionId: z.string().min(3).max(128),
  ts: z.number().int().positive(), // ms since epoch
  type: z.string().min(1).max(64),
  payload: z.record(z.any()).optional().default({}),
  meta: z
    .object({
      tz: z.string().max(64).optional(),
      lang: z.string().max(32).optional(),
      userAgent: z.string().max(256).optional(),
      screenW: z.number().int().min(0).max(10000).optional(),
      screenH: z.number().int().min(0).max(10000).optional(),
    })
    .optional(),
});

export function validateEvent(req, res, next) {
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid event", details: parsed.error.flatten() });
  }

  const e = parsed.data;

  // ✅ force payload to be an object
  if (!e.payload || typeof e.payload !== "object") e.payload = {};

  // Clamp overly-large numeric payload fields if present
  if (typeof e.payload?.x === "number") e.payload.x = clamp(e.payload.x, -99999, 99999);
  if (typeof e.payload?.y === "number") e.payload.y = clamp(e.payload.y, -99999, 99999);

  // ✅ safety: cap payload size a bit (prevents spam / huge objects)
  const MAX_KEYS = 80;
  const MAX_STR = 2000;

  const entries = Object.entries(e.payload).slice(0, MAX_KEYS);
  e.payload = Object.fromEntries(
    entries.map(([k, v]) => {
      if (typeof v === "string" && v.length > MAX_STR) return [k, v.slice(0, MAX_STR)];
      return [k, v];
    })
  );

  req.cleanedEvent = e;
  next();
}
