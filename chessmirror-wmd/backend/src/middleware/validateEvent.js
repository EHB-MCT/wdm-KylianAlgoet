import { z } from "zod";
import { clamp } from "../util.js";

const EventSchema = z.object({
  uid: z.string().min(3).max(128),
  sessionId: z.string().min(3).max(128),
  ts: z.number().int().positive(), // ms since epoch
  type: z.string().min(1).max(64),
  payload: z.record(z.any()).default({}),
  // device metadata (optional)
  meta: z.object({
    tz: z.string().max(64).optional(),
    lang: z.string().max(32).optional(),
    userAgent: z.string().max(256).optional(),
    screenW: z.number().int().min(0).max(10000).optional(),
    screenH: z.number().int().min(0).max(10000).optional(),
  }).optional()
});

export function validateEvent(req, res, next) {
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
  }

  // basic cleaning: downsample hover spam with client-side, but also clamp payload sizes here
  const e = parsed.data;

  // Clamp overly-large numeric payload fields if present
  if (typeof e.payload?.x === "number") e.payload.x = clamp(e.payload.x, -99999, 99999);
  if (typeof e.payload?.y === "number") e.payload.y = clamp(e.payload.y, -99999, 99999);

  req.cleanedEvent = e;
  next();
}
