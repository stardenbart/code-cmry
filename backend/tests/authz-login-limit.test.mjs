import { ok, section, req } from "./harness.mjs";

section("Rate-limit login per username");

// Username acak supaya tidak mengunci akun nyata dan tidak terpengaruh
// percobaan dari test sebelumnya.
const victim = `__brute_${Date.now()}`;
let got429 = false;
let attempts = 0;

for (let i = 0; i < 14; i += 1) {
  attempts += 1;
  const r = await req("POST", "/api/login", {
    body: { username: victim, password: `tebakan-${i}` },
  });
  if (r.status === 429) { got429 = true; break; }
}
ok("percobaan berulang akhirnya kena 429", got429, `setelah ${attempts} percobaan`);

// Username lain tidak boleh ikut terkunci — pembatasan per username, bukan per
// IP. Di kantor banyak orang berbagi satu IP publik.
const lain = await req("POST", "/api/login", {
  body: { username: `__orang_lain_${Date.now()}`, password: "x" },
});
ok("username lain tidak ikut terkunci", lain.status !== 429, `dapat ${lain.status}`);
