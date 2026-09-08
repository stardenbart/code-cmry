import db from "../../config/db.js";

const sql = db.promise();

function uniqueIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function actorId(actor) {
  const value = Number(actor?.userId ?? actor?.id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function loadUserDashboardIds(actor) {
  const userId = actorId(actor);
  if (!userId) return [];
  const [rows] = await sql.query(
    `SELECT d.id
       FROM dashboards d
       JOIN users u ON u.id = ?
       LEFT JOIN user_dashboard_access uda
              ON uda.dashboard_id = d.id AND uda.user_id = u.id
      WHERE d.active = 1
        AND (u.tipe_akses = 'All Access' OR uda.user_id IS NOT NULL)
        AND (u.cross_plant_access = 1
             OR d.plant_id IS NULL
             OR d.plant_id IN (SELECT plant_id FROM user_plants WHERE user_id = u.id))
      ORDER BY d.id`,
    [userId],
  );
  return rows.map((row) => String(row.id));
}

export async function loadCentralizedDashboardIds() {
  const [rows] = await sql.query("SELECT id FROM dashboards WHERE active = 1 ORDER BY id");
  return rows.map((row) => String(row.id));
}

const DEFAULT_DEPS = { loadUserDashboardIds, loadCentralizedDashboardIds };

export async function resolveEvidenceScope(input = {}, deps = DEFAULT_DEPS) {
  const surface = typeof input.surface === "string" ? input.surface : "dashboard";
  const centralized = input.accessMode === "centralized"
    && input.trustedInternal === true
    && ["whatsapp", "schedule"].includes(surface);
  const validActor = actorId(input.actor);

  let allowedDashboardIds = [];
  if (centralized) {
    allowedDashboardIds = uniqueIds(await deps.loadCentralizedDashboardIds());
  } else if (validActor) {
    allowedDashboardIds = uniqueIds(await deps.loadUserDashboardIds({ ...input.actor, userId: validActor }));
  }

  const allowed = new Set(allowedDashboardIds);
  const requested = uniqueIds(input.preferredDashboardIds);
  const preferredDashboardIds = requested.filter((id) => allowed.has(id));
  const deniedPreferredDashboardIds = requested.filter((id) => !allowed.has(id));
  const denied = allowedDashboardIds.length === 0;

  return {
    allowedDashboardIds,
    preferredDashboardIds,
    deniedPreferredDashboardIds,
    mode: centralized ? "centralized" : "user_acl",
    denied,
    errorCode: denied ? "ACCESS_DENIED" : null,
  };
}

