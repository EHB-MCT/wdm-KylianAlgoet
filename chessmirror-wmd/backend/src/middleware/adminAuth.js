export function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD || "admin123";
  const got = req.headers["x-admin-password"];
  if (!got || got !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
