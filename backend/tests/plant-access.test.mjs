// Plant access gate: user hanya melihat dashboard plant-nya kecuali lintas-plant.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { setUserPlants, allowedDashboardIdsForUser, createPlant, deletePlant, createDepartment } from "../src/models/plantModel.js";

const sql = db.promise();
const cleanup = { users: [], dashboards: [], plants: [] };

const [sr] = await sql.query("SELECT id FROM plants WHERE name='Sentul' LIMIT 1");
const sentulId = sr[0].id;

// Plant kedua + dashboard di dalamnya (fixture).
const plantBId = await createPlant({ name: "ZZ Test Plant", code: "ZZ9" });
cleanup.plants.push(plantBId);
const deptBId = await createDepartment({ plantId: plantBId, name: "ZZ Dept" });
const [dins] = await sql.query(
  "INSERT INTO dashboards (title, url, department, active, plant_id, department_id) VALUES ('ZZ Dash B','http://x','ZZ Dept',1,?,?)",
  [plantBId, deptBId]);
const dashB = dins.insertId;
cleanup.dashboards.push(dashB);

// User All Access, hanya di-assign Sentul, cross_plant_access=0.
const [uins] = await sql.query(
  "INSERT INTO users (nama, departemen, tipe_akses, username, password, approved, role, cross_plant_access) VALUES ('ZZ User','X','All Access',?, 'x', 1, 'user', 0)",
  [`zzuser_${Date.now()}`]);
const userId = uins.insertId;
cleanup.users.push(userId);
await setUserPlants(userId, [sentulId]);

try {
  section("Own-plant only");
  const own = await allowedDashboardIdsForUser(userId);
  ok("All Access melihat dashboard Sentul", own.length > 0, String(own.length));
  ok("TIDAK melihat dashboard plant lain", !own.includes(String(dashB)),
    `dashB=${dashB} bocor`);

  section("Assign plant kedua -> dashboard-nya muncul");
  await setUserPlants(userId, [sentulId, plantBId]);
  const two = await allowedDashboardIdsForUser(userId);
  ok("dashboard plant kedua kini terlihat", two.includes(String(dashB)));

  section("Cross-plant flag -> semua plant terlihat walau tak di-assign");
  await setUserPlants(userId, [sentulId]); // lepas plant B
  await sql.query("UPDATE users SET cross_plant_access=1 WHERE id=?", [userId]);
  const cross = await allowedDashboardIdsForUser(userId);
  ok("cross-plant melihat dashboard plant lain", cross.includes(String(dashB)));

  section("Department Access Only tanpa grant -> tidak lihat apa pun");
  await sql.query("UPDATE users SET tipe_akses='Department Access Only', cross_plant_access=0 WHERE id=?", [userId]);
  const dep = await allowedDashboardIdsForUser(userId);
  ok("tanpa grant eksplisit -> kosong", dep.length === 0, String(dep.length));
} finally {
  for (const id of cleanup.users) await sql.query("DELETE FROM users WHERE id=?", [id]);
  for (const id of cleanup.dashboards) await sql.query("DELETE FROM dashboards WHERE id=?", [id]);
  for (const id of cleanup.plants) await deletePlant(id); // CASCADE dept
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
