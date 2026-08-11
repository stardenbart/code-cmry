import { ok, section } from "./harness.mjs";
import { sudahDisapa, tandaiSudahDisapa, lupakanSapaan } from "../src/models/waGroupIntroModel.js";
import db from "../src/config/db.js";

// JID buatan yang jelas-jelas tidak mungkin bertabrakan dengan grup nyata.
// Ada bug sebelumnya di proyek ini di mana uji menghapus data milik akun
// sungguhan, jadi baris yang dihapus di akhir HARUS hanya baris uji ini.
const JID_UJI = "0000000000-fixture-wa-group-intro@g.us";

section("Grup baru belum pernah disapa");

// Dibersihkan dulu di depan, jaga-jaga kalau run sebelumnya gagal di
// tengah jalan dan sempat menyisakan baris.
await lupakanSapaan(JID_UJI);

ok("grup baru -> belum disapa", (await sudahDisapa(JID_UJI)) === false);

section("Sesudah ditandai, grup jadi sudah disapa");

await tandaiSudahDisapa(JID_UJI);
ok("sesudah ditandai -> sudah disapa", (await sudahDisapa(JID_UJI)) === true);

section("Menandai dua kali tetap satu baris, tidak melempar duplicate key");

let melempar = false;
try {
  await tandaiSudahDisapa(JID_UJI);
} catch {
  melempar = true;
}
ok("tandai kedua tidak melempar", melempar === false);

const [rows] = await db.promise().query(
  "SELECT COUNT(*) AS n FROM wa_group_intro WHERE group_jid = ?",
  [JID_UJI]
);
ok("tetap satu baris untuk JID ini", Number(rows[0].n) === 1, `dapat ${rows[0].n}`);

section("Pembersihan diri");

await lupakanSapaan(JID_UJI);
ok("sesudah dilupakan -> belum disapa lagi", (await sudahDisapa(JID_UJI)) === false);

const [sisa] = await db.promise().query(
  "SELECT COUNT(*) AS n FROM wa_group_intro WHERE group_jid = ?",
  [JID_UJI]
);
ok("baris fixture benar-benar terhapus", Number(sisa[0].n) === 0, `dapat ${sisa[0].n}`);
