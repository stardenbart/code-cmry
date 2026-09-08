// Backfill Plant/Department: idempotent & non-destruktif.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { backfillPlantDepartment } from "../scripts/backfill-plant-department.mjs";

const sql = db.promise();

section("Backfill jalan (run 1)");
const r1 = await backfillPlantDepartment(sql);
ok("Sentul id valid", Number.isInteger(r1.sentulId) && r1.sentulId > 0);
ok("ada department dibuat", r1.departments >= 1, String(r1.departments));

section("Semua dashboard terpetakan ke plant + department");
{
  const [[{ n }]] = await sql.query("SELECT COUNT(*) n FROM dashboards WHERE plant_id IS NULL");
  ok("tidak ada dashboard tanpa plant", Number(n) === 0, `${n} tanpa plant`);
  const [[{ m }]] = await sql.query("SELECT COUNT(*) m FROM dashboards WHERE department_id IS NULL");
  ok("tidak ada dashboard tanpa department", Number(m) === 0, `${m} tanpa dept`);
}

section("Semua user punya plant Sentul");
{
  const [[{ users }]] = await sql.query("SELECT COUNT(*) users FROM users");
  const [[{ mapped }]] = await sql.query(
    "SELECT COUNT(DISTINCT user_id) mapped FROM user_plants WHERE plant_id=?", [r1.sentulId]);
  ok("semua user ter-assign Sentul", Number(mapped) === Number(users), `${mapped}/${users}`);
}

section("Idempotent (run 2 tidak menambah/duplikat)");
{
  const [[{ b }]] = await sql.query("SELECT COUNT(*) b FROM user_plants");
  const r2 = await backfillPlantDepartment(sql);
  const [[{ a }]] = await sql.query("SELECT COUNT(*) a FROM user_plants");
  ok("dashboard sudah termap -> 0 update", r2.dashboardsMapped === 0, String(r2.dashboardsMapped));
  ok("user_plants tidak bertambah", Number(a) === Number(b), `${b}->${a}`);
  const [[{ dep1 }]] = await sql.query(
    "SELECT COUNT(*) dep1 FROM departments WHERE plant_id=?", [r1.sentulId]);
  ok("jumlah department stabil", Number(dep1) === r1.departments, `${dep1} vs ${r1.departments}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
