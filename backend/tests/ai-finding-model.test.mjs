// ─────────────────────────────────────────────────────────────────────────────
// Uji ini memakai akun sekali pakai, bukan akun nyata — pola yang sama dipakai
// tests/user-role.test.mjs untuk alasan yang sama persis.
//
// Versi sebelumnya memakai "user pertama/terakhir berdasar id" sebagai fixture,
// dan itu akun NYATA yang bisa sedang dipakai sungguhan. Dua akibatnya:
//   1. simpanTemuan memakai ON DUPLICATE KEY UPDATE atas (user_id, dashboard_id).
//      Kalau akun itu memang punya temuan asli di dashboard yang sama dipakai
//      uji, uji ini MENIMPA isinya dengan data palsu, lalu MENGHAPUSNYA di
//      akhir — bukan cuma membaca, tapi merusak memori asli user tersebut.
//   2. temuanAktif(userId) membaca SEMUA temuan milik user itu, bukan hanya
//      yang dibuat uji. Kalau akun itu punya temuan asli lain yang segar
//      (dari pemakaian sungguhan yang berjalan bersamaan), asersi seperti
//      "aktif.length === 1" gagal bukan karena bug, tapi karena data asli
//      ikut terhitung.
//
// Akun sekali pakai membuat DUA masalah itu tidak mungkin terjadi: baru
// dibuat, tidak punya temuan apa pun, dan dihapus di akhir (di blok finally,
// supaya tetap jalan walau ada asersi yang gagal) — ai_finding-nya ikut lenyap
// lewat ON DELETE CASCADE di fk_finding_user, tanpa perlu DELETE manual yang
// berisiko salah sasaran.
// ─────────────────────────────────────────────────────────────────────────────

import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  simpanTemuan, temuanAktif, turnTerakhirTersaring, hapusTemuan,
} from "../src/models/findingModel.js";

const sql = db.promise();

const [[admin]] = await sql.query("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
const ADMIN = tokenFor(admin.id, admin.username);

const NAMA_PROBE_A = "__uji_finding_a__";
const NAMA_PROBE_B = "__uji_finding_b__";

async function buatProbe(nama) {
  const dibuat = await req("POST", "/api/add-user", {
    token: ADMIN,
    body: {
      nama, username: nama, password: "SandiUjiTidakDipakai123",
      departemen: "Plant", tipe_akses: "Department Access Only",
    },
  });
  if (dibuat.status !== 200) throw new Error(`gagal membuat akun probe ${nama}: ${dibuat.status}`);
  const semua = await req("GET", "/api/users", { token: ADMIN });
  const probe = (semua.body || []).find((u) => u.username === nama);
  if (!probe) throw new Error(`akun probe ${nama} tidak ditemukan sesudah dibuat`);
  return probe.id;
}

async function hapusProbe(id) {
  if (id) await req("DELETE", `/api/delete-user/${id}`, { token: ADMIN });
}

let USER = null;
let USER_LAIN = null;

try {
  USER = await buatProbe(NAMA_PROBE_A);
  USER_LAIN = await buatProbe(NAMA_PROBE_B);

  const DASH_A = 44;
  const DASH_B = 45;

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

  section("hapusTemuan menghapus satu dashboard");

  const dihapus = await hapusTemuan(USER, DASH_A);
  ok("hapus mengembalikan jumlah baris", dihapus >= 0, String(dihapus));
} finally {
  // Wajib jalan walau ada asersi yang gagal di atas. Menghapus akun probe
  // menghapus SELURUH ai_finding miliknya lewat ON DELETE CASCADE — tidak ada
  // DELETE manual yang bisa salah sasaran ke data akun lain.
  section("Akun probe dibersihkan");

  await hapusProbe(USER);
  await hapusProbe(USER_LAIN);

  if (USER || USER_LAIN) {
    const [[sisa]] = await sql.query(
      "SELECT COUNT(*) n FROM ai_finding WHERE user_id IN (?, ?)",
      [USER || 0, USER_LAIN || 0]
    );
    ok("tidak ada sisa temuan milik akun probe", Number(sisa.n) === 0, `sisa ${sisa.n}`);
  }

  const [[sisaUser]] = await sql.query(
    "SELECT COUNT(*) n FROM users WHERE username IN (?, ?)", [NAMA_PROBE_A, NAMA_PROBE_B]
  );
  ok("akun probe tidak tersisa", Number(sisaUser.n) === 0, `sisa ${sisaUser.n}`);
}
