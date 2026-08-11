import { ok, section } from "./harness.mjs";
import { bolehDisapa } from "../src/services/whatsappListener.service.js";

// bolehDisapa() dulunya logika inline di dalam handler
// group-participants.update, jadi tidak bisa diuji tanpa menyalakan socket
// WhatsApp sungguhan. Diekstrak jadi fungsi murni supaya penjaganya sendiri
// bisa diperiksa di sini.

section("Grup terdaftar boleh disapa, grup lain ditolak");

const daftarGrup = ["1111-1@g.us", "2222-2@g.us"];

ok("grup terdaftar -> boleh",
  bolehDisapa({ jidGrup: "1111-1@g.us", daftarGrup }) === true);
ok("grup di luar daftar -> ditolak",
  bolehDisapa({ jidGrup: "9999-9@g.us", daftarGrup }) === false);

section("Menolak secara default untuk masukan rusak");

ok("jidGrup kosong -> ditolak",
  bolehDisapa({ jidGrup: "", daftarGrup }) === false);
ok("jidGrup null -> ditolak",
  bolehDisapa({ jidGrup: null, daftarGrup }) === false);
ok("jidGrup undefined -> ditolak",
  bolehDisapa({ daftarGrup }) === false);
ok("daftarGrup kosong -> menolak semua",
  bolehDisapa({ jidGrup: "1111-1@g.us", daftarGrup: [] }) === false);
ok("daftarGrup bukan array (string) -> menolak semua",
  bolehDisapa({ jidGrup: "1111-1@g.us", daftarGrup: "1111-1@g.us" }) === false);
ok("daftarGrup null -> menolak semua",
  bolehDisapa({ jidGrup: "1111-1@g.us", daftarGrup: null }) === false);
ok("argumen kosong sama sekali -> ditolak",
  bolehDisapa({}) === false);
ok("dipanggil tanpa argumen -> ditolak",
  bolehDisapa() === false);

section("JID perorangan ditolak walau kebetulan ada di daftar");

// Perkenalan ini hanya untuk grup. JID perorangan berakhiran @s.whatsapp.net,
// bukan @g.us, dan tidak boleh disapa meskipun string-nya ada di daftar grup
// (misalnya karena kesalahan konfigurasi WHATSAPP_GROUP_ID).
const daftarDenganPerorangan = ["6281234567890@s.whatsapp.net", "1111-1@g.us"];
ok("JID perorangan di daftar -> tetap ditolak",
  bolehDisapa({ jidGrup: "6281234567890@s.whatsapp.net", daftarGrup: daftarDenganPerorangan }) === false);
