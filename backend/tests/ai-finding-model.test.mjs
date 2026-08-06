import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  simpanTemuan, temuanAktif, turnTerakhirTersaring, hapusTemuan,
} from "../src/models/findingModel.js";

const sql = db.promise();

// User nyata dari database: user_id punya foreign key ke users(id), jadi id
// hantu akan gagal dengan ER_NO_REFERENCED_ROW_2.
const [[u]] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const [[u2]] = await sql.query("SELECT id FROM users ORDER BY id DESC LIMIT 1");
const USER = u.id;
const USER_LAIN = u2.id;
const DASH_A = 44;
const DASH_B = 45;

await sql.query("DELETE FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]);

section("Temuan disimpan dan dibaca kembali");

const s1 = await simpanTemuan({
  userId: USER, dashboardId: DASH_A,
  ringkasan: "Losses PM naik di CMD 2",
  angka: [{ measure: "% Losses Packing", nilai: 0.001 }],
  belumTerjawab: "penyebab kenaikannya",
  turnTerakhir: 10,
});
ok("tersimpan", s1.disimpan === true, JSON.stringify(s1));

const aktif = await temuanAktif(USER);
ok("satu temuan terbaca", aktif.length === 1, `dapat ${aktif.length}`);
ok("ringkasan utuh", aktif[0].ringkasan === "Losses PM naik di CMD 2", aktif[0].ringkasan);
ok("angka terbaca sebagai array", Array.isArray(aktif[0].angka), typeof aktif[0].angka);
ok("nama measure ikut", aktif[0].angka[0].measure === "% Losses Packing");
ok("umur dalam jam ikut", typeof aktif[0].umurJam === "number", typeof aktif[0].umurJam);

section("Menyimpan ulang menyegarkan, tidak menumpuk");

await simpanTemuan({
  userId: USER, dashboardId: DASH_A,
  ringkasan: "Losses PM naik di CMD 2 dan CMD 3",
  angka: [], belumTerjawab: null, turnTerakhir: 12,
});
const aktif2 = await temuanAktif(USER);
ok("tetap satu baris", aktif2.length === 1, `dapat ${aktif2.length}`);
ok("ringkasan tersegarkan", /CMD 3/.test(aktif2[0].ringkasan), aktif2[0].ringkasan);
ok("turn terakhir tersegarkan", (await turnTerakhirTersaring(USER, DASH_A)) === 12);

section("Temuan user lain TIDAK pernah terbawa");

// Kebocorannya berbentuk kalimat analisa, bukan tabel, jadi tidak akan terlihat
// saat ditinjau manusia. Karena itu diuji eksplisit.
await simpanTemuan({
  userId: USER_LAIN, dashboardId: DASH_B,
  ringkasan: "RAHASIA user lain", angka: [], belumTerjawab: null, turnTerakhir: 1,
});
const punyaUser = await temuanAktif(USER);
ok("temuan user lain tidak muncul",
  !punyaUser.some((t) => /RAHASIA/.test(t.ringkasan)),
  JSON.stringify(punyaUser.map((t) => t.ringkasan)));

section("Jendela 12 jam menyaring saat MEMBACA, bukan menghapus");

await sql.query(
  "UPDATE ai_finding SET disegarkan_pada = DATE_SUB(NOW(), INTERVAL 13 HOUR) WHERE user_id = ? AND dashboard_id = ?",
  [USER, DASH_A]
);
ok("temuan tua tidak dibawa", (await temuanAktif(USER)).length === 0);

const [[masih]] = await sql.query(
  "SELECT COUNT(*) n FROM ai_finding WHERE user_id = ? AND dashboard_id = ?", [USER, DASH_A]
);
// Barisnya TETAP ada: jendela menyaring saat membaca supaya riwayat temuan
// masih bisa dilihat bila nanti dibutuhkan.
ok("barisnya tidak dihapus", Number(masih.n) === 1, `sisa ${masih.n}`);
ok("jendela bisa dilebarkan", (await temuanAktif(USER, { jamKebelakang: 24 })).length === 1);

section("Batas jumlah dashboard dihormati");

for (let i = 0; i < 6; i += 1) {
  await simpanTemuan({
    userId: USER, dashboardId: 100 + i,
    ringkasan: `temuan ${i}`, angka: [], belumTerjawab: null, turnTerakhir: i,
  });
}
ok("maksimum 4 dashboard", (await temuanAktif(USER)).length === 4,
  `dapat ${(await temuanAktif(USER)).length}`);

section("Data uji dibersihkan");

const dihapus = await hapusTemuan(USER, DASH_A);
ok("hapus mengembalikan jumlah baris", dihapus >= 0, String(dihapus));
await sql.query("DELETE FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]);
const [[sisa]] = await sql.query(
  "SELECT COUNT(*) n FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]
);
ok("tidak ada sisa", Number(sisa.n) === 0, `sisa ${sisa.n}`);
