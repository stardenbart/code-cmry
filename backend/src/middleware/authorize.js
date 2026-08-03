// ─────────────────────────────────────────────────────────────────────────────
// Authorization layer for the CODE API.
//
// Default-deny: every /api path requires a valid token unless it appears in an
// explicit allowlist. This is the property that matters — a new endpoint added
// six months from now is protected without anyone remembering to protect it.
// Forgetting produces a loud 401, not a silent hole.
// ─────────────────────────────────────────────────────────────────────────────

import { verifyJWT, isAdmin, loadUser } from "./auth.js";

/**
 * Routes reachable without a token.
 *
 * Matched EXACTLY as "METHOD /path" — never by prefix, so allowlisting
 * "/api/login" cannot accidentally open "/api/login-bypass".
 */
export const PUBLIC_ROUTES = new Set([
  "POST /api/login",
  "POST /api/register",
  "GET /api/check-token",              // verifies the token itself
  "GET /api/approve-via-email",        // signed token lives in the query string
  "GET /api/reject-via-email",
  "GET /api/approve-user-via-email",
  "GET /api/reject-user-via-email",
  "GET /api/portal-links",             // landing page renders before login
]);

export function isPublicRoute(method, path) {
  // Express keeps a trailing slash when a router is mounted at the same path
  // as its own "/" route, so "/api/portal-links/" must match too.
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return PUBLIC_ROUTES.has(`${method} ${normalized}`);
}

/** Requires a token for every /api route that is not explicitly public. */
export function defaultDeny(req, res, next) {
  if (!req.path.startsWith("/api")) return next();   // static files, health check
  if (isPublicRoute(req.method, req.path)) return next();
  return verifyJWT(req, res, next);
}

/**
 * Balasan untuk token yang sah tapi akunnya sudah dihapus atau dicabut
 * persetujuannya.
 *
 * `code` ada supaya frontend bisa membedakan ini dari penolakan otorisasi biasa
 * ("butuh hak admin") tanpa mencocokkan teks pesan. Perbedaannya penting: yang
 * ini artinya sesi sudah tidak berlaku dan user harus dikeluarkan, sedangkan
 * yang lain hanya berarti akun aktif menyentuh sesuatu yang bukan haknya.
 */
const ACCOUNT_INACTIVE = { message: "Akun tidak aktif", code: "ACCOUNT_INACTIVE" };

/**
 * Admin-only. The role is read from the database, not from the token, so
 * revoking admin rights takes effect immediately instead of when the token
 * happens to expire.
 */
export async function requireAdmin(req, res, next) {
  try {
    const user = await loadUser(req.user?.id);
    if (!user || !user.approved) {
      return res.status(403).json(ACCOUNT_INACTIVE);
    }
    if (!isAdmin(user)) {
      return res.status(403).json({ message: "Butuh hak admin" });
    }
    req.dbUser = user;
    next();
  } catch (err) {
    console.error("❌ requireAdmin error:", err);
    res.status(500).json({ message: "Gagal memeriksa hak akses" });
  }
}

/**
 * The :param must belong to the caller, unless the caller is an admin.
 *
 * Comparison is numeric on purpose: req.params values are always strings while
 * the JWT carries a number, and "9" === 9 is false — a strict comparison would
 * reject the rightful owner of the data.
 */
export function requireSelfOrAdmin(paramName) {
  return async (req, res, next) => {
    try {
      const user = await loadUser(req.user?.id);
      if (!user || !user.approved) {
        return res.status(403).json(ACCOUNT_INACTIVE);
      }

      const target = Number(req.params[paramName]);
      if (Number.isFinite(target) && target === Number(user.id)) {
        req.dbUser = user;
        return next();
      }
      if (isAdmin(user)) {
        req.dbUser = user;
        return next();
      }
      return res.status(403).json({ message: "Kamu hanya bisa mengakses datamu sendiri" });
    } catch (err) {
      console.error("❌ requireSelfOrAdmin error:", err);
      res.status(500).json({ message: "Gagal memeriksa hak akses" });
    }
  };
}
