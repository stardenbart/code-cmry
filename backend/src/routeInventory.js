// ─────────────────────────────────────────────────────────────────────────────
// Route inventory.
//
// defaultDeny guarantees authentication. It cannot guarantee AUTHORIZATION —
// nothing stops a new endpoint from being added without deciding whether it is
// admin-only. This map makes that decision mandatory: a route missing from it
// fails the test suite.
// ─────────────────────────────────────────────────────────────────────────────

/** Walks the Express router stack and returns every registered /api route. */
export function listApiRoutes(app) {
  const out = [];

  const mountPathOf = (layer) => {
    // Express stores the mount path as a regexp. Recovering it is undocumented,
    // so anything unrecognised yields "" and the route shows up unprefixed —
    // visible in the test output rather than silently mis-filed.
    const src = layer.regexp?.source;
    if (!src || src === "^\\/?(?=\\/|$)") return "";
    const m = src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
    if (!m) return "";
    return "/" + m[1].replace(/\\\//g, "/");
  };

  const walk = (stack, prefix = "") => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) out.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
      }
    }
  };

  walk(app._router?.stack || app.router?.stack || []);
  return out.filter((r) => r.path.startsWith("/api"));
}

export const ROUTE_CLASSIFICATION = new Map([
  // public
  ["POST /api/login", "public"],
  ["POST /api/register", "public"],
  ["GET /api/check-token", "public"],
  ["GET /api/approve-via-email", "public"],
  ["GET /api/reject-via-email", "public"],
  ["GET /api/approve-user-via-email", "public"],
  ["GET /api/reject-user-via-email", "public"],
  ["GET /api/portal-links/", "public"],

  // authenticated
  ["GET /api/dashboards/", "authenticated"],
  ["POST /api/request-access", "authenticated"],
  ["POST /api/cancel-request", "authenticated"],
  ["POST /api/refresh-token", "authenticated"],
  ["GET /api/powerbi/embed-config/:dashboardKey", "authenticated"],
  ["GET /api/powerbi/embed-config-by-report/:reportId", "authenticated"],
  ["GET /api/ai/status", "authenticated"],
  ["GET /api/ai/quota", "authenticated"],
  ["PUT /api/ai/key", "authenticated"],
  ["DELETE /api/ai/key", "authenticated"],
  ["PUT /api/ai/model", "authenticated"],
  ["POST /api/ai/ask", "authenticated"],
  ["POST /api/ai/navigate", "authenticated"],
  // Memori temuan lintas dashboard. authenticated, bukan selfOrAdmin: identitas
  // diambil dari token dan TIDAK pernah dari parameter, jadi tidak ada id user
  // yang bisa dipalsukan. Pola yang sama dipakai POST /api/ai/ask.
  ["GET /api/ai/finding", "authenticated"],
  ["POST /api/ai/finding/distill", "authenticated"],
  ["GET /api/ai/history/:dashboardId", "authenticated"],
  ["POST /api/perf/", "authenticated"],
  ["DELETE /api/ai/history/:dashboardId", "authenticated"],

  // Chat CIA lintas dashboard. authenticated dengan alasan yang sama seperti
  // /api/ai/finding: user diambil dari token, tidak pernah dari parameter.
  // Rute :id memang memakai parameter, tapi itu id PERCAKAPAN, dan
  // getConversation menuntut user_id pemiliknya, jadi id milik orang lain
  // mengembalikan 404, bukan isinya. Seluruhnya juga dijaga requireCiaAccess.
  ["POST /api/ai/unified/ask", "authenticated"],
  ["POST /api/ai/unified/suggest", "authenticated"],
  ["GET /api/ai/unified/conversations", "authenticated"],
  ["GET /api/ai/unified/conversations/:id/turns", "authenticated"],
  ["DELETE /api/ai/unified/conversations/:id", "authenticated"],

  // selfOrAdmin
  ["PUT /api/users/:id/password", "selfOrAdmin"],
  ["GET /api/dashboard-access-status/:userId", "selfOrAdmin"],
  ["GET /api/users/:userId/dashboard-access", "selfOrAdmin"],
  ["GET /api/access-requests-log/:userId", "selfOrAdmin"],
  ["GET /api/access/:userId", "selfOrAdmin"],
  ["GET /api/notifications/count/:userId", "selfOrAdmin"],
  ["PUT /api/notifications/mark-read/:userId", "selfOrAdmin"],

  // adminOnly
  ["GET /api/users", "adminOnly"],
  ["POST /api/add-user", "adminOnly"],
  ["PUT /api/update-user/:id", "adminOnly"],
  ["DELETE /api/delete-user/:id", "adminOnly"],
  ["PUT /api/approve-user/:id", "adminOnly"],
  ["PUT /api/decline-user/:id", "adminOnly"],
  ["GET /api/requests", "adminOnly"],
  ["PUT /api/approve-request/:id", "adminOnly"],
  ["PUT /api/decline-request/:id", "adminOnly"],
  ["POST /api/users/:userId/dashboard-access", "adminOnly"],
  ["POST /api/dashboards/", "adminOnly"],
  ["PUT /api/dashboards/:id", "adminOnly"],
  ["DELETE /api/dashboards/:id", "adminOnly"],
  ["GET /api/portal-links/all", "adminOnly"],
  ["POST /api/portal-links/", "adminOnly"],
  ["PUT /api/portal-links/:id", "adminOnly"],
  ["DELETE /api/portal-links/:id", "adminOnly"],
  ["GET /api/report-setting/", "authenticated"],
  ["PUT /api/report-setting/", "adminOnly"],
  ["GET /api/ai/provider", "authenticated"],
  ["PUT /api/ai/provider", "adminOnly"],
  ["PUT /api/ai/universal-key", "adminOnly"],
  ["DELETE /api/ai/universal-key", "adminOnly"],
  ["GET /api/perf/summary", "adminOnly"],
  ["GET /api/ai/coverage", "adminOnly"],

  // Panen inventaris visual. Semuanya adminOnly: isinya struktur internal
  // seluruh dashboard, dan endpoint tulisnya mengubah dasar perhitungan KPI.
  ["GET /api/summary/harvest-plan", "adminOnly"],
  ["POST /api/summary/visual-usage", "adminOnly"],
  ["GET /api/summary/harvest-status", "adminOnly"],

  // Manual trigger dan status job. adminOnly: /run dan /send bisa mengirim pesan
  // sungguhan ke grup manajemen, dan /job-status memuat konfigurasi pengiriman.
  ["POST /api/summary/run", "adminOnly"],
  ["POST /api/summary/send", "adminOnly"],
  ["POST /api/summary/run-and-send", "adminOnly"],
  ["GET /api/summary/job-status", "adminOnly"],

  // Control-plane Admin CIA. Semuanya adminOnly: analytics penggunaan seluruh
  // kanal, trace request, dan pengelolaan hak akses CIA per user.
  ["GET /api/admin/cia/overview", "adminOnly"],
  ["GET /api/admin/cia/usage", "adminOnly"],
  ["GET /api/admin/cia/health", "adminOnly"],
  ["GET /api/admin/cia/filters", "adminOnly"],
  ["GET /api/admin/cia/requests/:requestId", "adminOnly"],
  ["GET /api/admin/cia/access", "adminOnly"],
  ["PUT /api/admin/cia/access/:userId", "adminOnly"],
  ["GET /api/admin/cia/settings", "adminOnly"],
]);
