import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const ADMIN = tokenFor(4, "digital.transformation");

// User biasa: diambil dari database supaya uji tidak bergantung pada satu id
// yang bisa saja dihapus.
const [[biasa]] = await db.promise().query(
  "SELECT id, username FROM users WHERE role <> 'admin' AND approved = 1 ORDER BY id LIMIT 1"
);
const USER = tokenFor(biasa.id, biasa.username);

section("GET /api/ai/coverage hanya untuk admin");

const anon = await req("GET", "/api/ai/coverage");
ok("tanpa token ditolak", anon.status === 401, `dapat ${anon.status}`);

const bukanAdmin = await req("GET", "/api/ai/coverage", { token: USER });
ok("user biasa ditolak", bukanAdmin.status === 403, `dapat ${bukanAdmin.status}`);

section("Bentuk ringkasan");

const res = await req("GET", "/api/ai/coverage", { token: ADMIN });
ok("admin dapat 200", res.status === 200, `dapat ${res.status}`);
ok("ada total", typeof res.body?.total === "number", JSON.stringify(res.body)?.slice(0, 200));
ok("ada lokal", typeof res.body?.lokal === "number", JSON.stringify(res.body?.lokal));
ok("persenLokal antara 0 dan 100",
  res.body?.persenLokal >= 0 && res.body?.persenLokal <= 100, String(res.body?.persenLokal));
ok("lokal tidak melebihi total", res.body.lokal <= res.body.total,
  `${res.body.lokal} > ${res.body.total}`);
ok("perIntent berupa array", Array.isArray(res.body?.perIntent), JSON.stringify(res.body?.perIntent));
ok("hariTerakhir dilaporkan", res.body?.hariTerakhir === 14, String(res.body?.hariTerakhir));

section("Baris yang mendahului instrumentasi dipisahkan");

// Persentase dihitung hanya atas pertanyaan yang melewati pengenal intent.
// Memasukkan baris lama ke pembagi membuat angkanya selalu nyaris nol selama
// dua minggu pertama, dan itu akan dibaca sebagai kegagalan fitur.
ok("tercatat dan belumTercatat dilaporkan",
  typeof res.body?.tercatat === "number" && typeof res.body?.belumTercatat === "number",
  JSON.stringify({ tercatat: res.body?.tercatat, belumTercatat: res.body?.belumTercatat }));
ok("tercatat + belumTercatat sama dengan total",
  Number(res.body.tercatat) + Number(res.body.belumTercatat) === Number(res.body.total),
  `${res.body.tercatat} + ${res.body.belumTercatat} != ${res.body.total}`);
ok("lokal tidak melebihi tercatat", Number(res.body.lokal) <= Number(res.body.tercatat),
  `${res.body.lokal} > ${res.body.tercatat}`);

section("Angka per intent konsisten dengan totalnya");

const jumlahPerIntent = (res.body.perIntent || []).reduce((s, x) => s + Number(x.jumlah), 0);
ok("jumlah perIntent sama dengan total", jumlahPerIntent === res.body.total,
  `${jumlahPerIntent} != ${res.body.total}`);

const lokalPerIntent = (res.body.perIntent || []).reduce((s, x) => s + Number(x.lokal), 0);
ok("lokal perIntent sama dengan lokal", lokalPerIntent === res.body.lokal,
  `${lokalPerIntent} != ${res.body.lokal}`);

for (const x of res.body.perIntent || []) {
  ok(`intent ${x.intent}: lokal tidak melebihi jumlah`, Number(x.lokal) <= Number(x.jumlah),
    `${x.lokal} > ${x.jumlah}`);
}
