// Menjaga supaya lapisan database tetap berupa pool, bukan koneksi tunggal.
//
// Regresi yang dijaga di sini sudah pernah terjadi dan mahal: dengan koneksi
// tunggal tanpa penyambungan ulang, satu gangguan MySQL sesaat membuat proses
// melayani 500 pada setiap rute berbasis database selamanya sampai direstart,
// dan satu-satunya jejaknya sebaris log di awal. Kegagalan seperti itu tidak
// terlihat sebagai kegagalan, jadi uji adalah satu-satunya penjaganya.
import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

section("Bentuknya pool, bukan koneksi tunggal");

// getConnection hanya ada pada pool. Penegasan ini memang menyentuh bentuk dan
// bukan perilaku, dan itu disengaja: bug yang diperbaiki PERSIS berupa "ini
// koneksi tunggal", jadi menjaga bentuknya adalah menjaga perbaikannya.
ok("mengekspos getConnection", typeof db.getConnection === "function", typeof db.getConnection);
ok("mengekspos promise()", typeof db.promise === "function", typeof db.promise);

section("Koneksi database memakai UTC");
const [zona] = await sql.query("SELECT @@session.time_zone AS zone");
ok("session MySQL dipaksa UTC", ["+00:00", "UTC"].includes(zona?.[0]?.zone), String(zona?.[0]?.zone));

section("Query dasar jalan");

const [dasar] = await sql.query("SELECT 1 AS ok");
ok("SELECT 1 mengembalikan 1", Number(dasar?.[0]?.ok) === 1, JSON.stringify(dasar));

section("Query bersamaan tidak saling menjatuhkan");

// Seluruh aplikasi memakai satu objek db ini, dan uji maupun permintaan nyata
// datang bersamaan. Dengan koneksi tunggal semuanya berbaris; dengan pool
// berjalan paralel. Yang diuji di sini bukan kecepatannya, melainkan bahwa tidak
// ada satu pun yang gagal karena berebut koneksi.
const bersamaan = await Promise.all(
  Array.from({ length: 12 }, (_, i) => sql.query("SELECT ? AS n", [i]))
);
const semuaBenar = bersamaan.every(([r], i) => Number(r?.[0]?.n) === i);
ok("dua belas query bersamaan semuanya benar", semuaBenar, `${bersamaan.length} hasil`);

section("Pool pulih sesudah satu koneksi mati");

// Inilah inti perbaikannya. Sebuah koneksi dimatikan secara paksa, meniru
// pemutusan sepihak oleh server atau firewall. Pada koneksi tunggal, sesudah ini
// setiap query berikutnya gagal dengan "connection is in closed state" dan tidak
// pernah pulih. Pada pool, koneksi rusak dibuang dan diganti.
const koneksi = await sql.getConnection();
koneksi.destroy();

let pulih = false;
let alasanGagal = "";
try {
  const [sesudah] = await sql.query("SELECT 2 AS ok");
  pulih = Number(sesudah?.[0]?.ok) === 2;
} catch (err) {
  alasanGagal = err?.code || err?.message || String(err);
}
ok("query sesudah koneksi dimatikan tetap berhasil", pulih, alasanGagal || "hasil tidak sesuai");

section("Kesalahan query tidak melumpuhkan pool");

// Query yang salah harus gagal sebagai query, bukan merusak lapisan database.
let queryRusakGagal = false;
try {
  await sql.query("SELECT * FROM tabel_yang_tidak_pernah_ada_untuk_uji");
} catch {
  queryRusakGagal = true;
}
ok("query ke tabel tak ada memang gagal", queryRusakGagal, "justru berhasil");

const [setelahRusak] = await sql.query("SELECT 3 AS ok");
ok(
  "query berikutnya tetap jalan sesudah query rusak",
  Number(setelahRusak?.[0]?.ok) === 3,
  JSON.stringify(setelahRusak)
);
