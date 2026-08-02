import { ok, section } from "./harness.mjs";
import { isAdmin, loadUser } from "../src/middleware/auth.js";

section("Fondasi: kolom role & helper isAdmin");

ok("isAdmin true untuk role admin", isAdmin({ role: "admin" }) === true);
ok("isAdmin false untuk role user", isAdmin({ role: "user" }) === false);
ok("isAdmin false untuk user tanpa role", isAdmin({}) === false);
ok("isAdmin false untuk null", isAdmin(null) === false);
ok("isAdmin TIDAK lagi memakai username",
  isAdmin({ username: "digital.transformation", role: "user" }) === false);

const admin = await loadUser(4);
ok("loadUser mengembalikan role dari database", admin?.role === "admin",
  JSON.stringify(admin));

const missing = await loadUser(999999);
ok("loadUser mengembalikan null untuk id tidak dikenal", missing === null);
