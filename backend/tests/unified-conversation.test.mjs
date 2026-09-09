// Penyimpanan percakapan CIA lintas dashboard.
//
// Empat kegagalan yang dijaga di sini semuanya SUDAH pernah terjadi dan tidak
// satu pun terlihat sebagai kegagalan saat berjalan:
//   1. tabelnya tidak pernah dibuat (migrasi .js di repo tanpa runner .js),
//   2. JSON.parse dipanggil atas kolom JSON yang mysql2 sudah kembalikan
//      sebagai objek,
//   3. getTurns memberi N turn PERTAMA, bukan N TERAKHIR, jadi konteks model
//      membeku di awal percakapan panjang,
//   4. penomoran turn dari turns.length, yang bertabrakan dengan UNIQUE KEY
//      begitu ada satu turn terhapus.
//
// Uji ini menyentuh database sungguhan lalu membersihkan barisnya sendiri.
import { ok, section, summary } from "./harness.mjs";
import { pathToFileURL } from "url";
import db from "../src/config/db.js";
import {
  createConversation, addTurn, getTurns, getConversation, hitungTurn,
  hapusConversation, getUserConversations, ingatanLintasPercakapan,
  pemakaianByte, pangkasSampaiMuat, BATAS_BYTE_PER_USER,
} from "../src/services/unifiedConversationManager.js";

const sql = db.promise();

// User mana pun yang ada; barisnya dibuang lagi di akhir.
const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const userId = users[0]?.id;

section("Prasyarat");
ok("ada user untuk diuji", Boolean(userId), "tabel users kosong");

if (!userId) {
  process.exit(summary() ? 0 : 1);
}

const dibuat = [];
async function bikin(pertanyaan) {
  const c = await createConversation(userId, pertanyaan);
  dibuat.push(c.id);
  return c;
}

try {
  section("Tabelnya ada dan percakapan tersimpan");

  const conv = await bikin("Berapa OEE line 3 bulan ini?");
  ok("createConversation memberi id", Number.isInteger(conv.id) && conv.id > 0, String(conv.id));
  ok("judul diambil dari pertanyaan pertama", conv.judul === "Berapa OEE line 3 bulan ini?", conv.judul);

  const judulPanjang = "x".repeat(200);
  const convPanjang = await bikin(judulPanjang);
  ok("judul panjang dipotong supaya muat kolom", convPanjang.judul.length <= 80, String(convPanjang.judul.length));

  section("Kolom JSON kembali sebagai objek, bukan string");

  await addTurn(conv.id, 1, "tanya satu", [{ id: 7, title: "OEE" }], "jawab satu", {
    gemini: 10, retrievalMethod: "live_dax", confidence: "high",
    sources: [{ dashboardId: "7", dashboardName: "OEE" }], warnings: ["UJI"],
    evidenceContract: {
      concepts: ["downtime"], entities: [], periods: [],
      sources: [{ dashboardId: "7", dashboardName: "OEE" }], goals: [],
    },
  });
  const [satu] = await getTurns(conv.id, 6);
  ok("dashboards_queried berupa array", Array.isArray(satu.dashboards_queried), typeof satu.dashboards_queried);
  ok("isi array utuh", satu.dashboards_queried[0]?.id === 7, JSON.stringify(satu.dashboards_queried));
  ok("metadata evidence tersimpan", satu.retrieval_method === "live_dax"
    && satu.confidence === "high" && satu.sources?.length === 1 && satu.warnings?.[0] === "UJI",
  JSON.stringify(satu));
  ok("evidence contract dibaca dari tokens_used tanpa migration",
    satu.evidence_contract?.sources?.[0]?.dashboardId === "7", JSON.stringify(satu));

  section("getTurns memberi yang TERAKHIR, urut maju");

  for (let n = 2; n <= 9; n += 1) {
    await addTurn(conv.id, n, `tanya ${n}`, [], `jawab ${n}`, {});
  }
  const enam = await getTurns(conv.id, 6);
  ok("jumlahnya sesuai limit", enam.length === 6, String(enam.length));
  ok("mulai dari turn 4, bukan turn 1", enam[0].turn_number === 4, String(enam[0].turn_number));
  ok("berakhir di turn terbaru", enam[5].turn_number === 9, String(enam[5].turn_number));
  ok("urut maju", enam.every((t, i) => i === 0 || t.turn_number > enam[i - 1].turn_number), "urutan kacau");

  section("Penomoran turn tahan penghapusan");

  ok("hitungTurn membaca nomor tertinggi", (await hitungTurn(conv.id)) === 9, String(await hitungTurn(conv.id)));

  await sql.query("DELETE FROM ai_unified_turns WHERE conversation_id = ? AND turn_number = 3", [conv.id]);
  const berikut = (await hitungTurn(conv.id)) + 1;
  ok("nomor berikutnya tetap 10 walau ada turn terhapus", berikut === 10, String(berikut));

  let bentrok = false;
  try {
    await addTurn(conv.id, berikut, "tanya sepuluh", [], "jawab sepuluh", {});
  } catch (err) {
    bentrok = true;
    ok("addTurn tidak bentrok", false, err?.code || err?.message);
  }
  if (!bentrok) ok("addTurn tidak bentrok", true);

  section("Pemakaian byte terhitung dan atapnya 5GB");

  ok("batasnya 5GB", BATAS_BYTE_PER_USER === 5 * 1024 * 1024 * 1024, String(BATAS_BYTE_PER_USER));
  const byte = await pemakaianByte(userId);
  ok("pemakaian berupa angka positif", Number.isFinite(byte) && byte > 0, String(byte));

  // SENGAJA tidak menurunkan atapnya supaya pemangkasan berjalan: pangkas
  // membuang percakapan SUNGGUHAN milik user ini, dan uji tidak boleh
  // menghapus data orang. Yang diuji adalah sisi amannya, yaitu bahwa di
  // bawah atap tidak ada satu pun yang dibuang.
  const dibuang = await pangkasSampaiMuat(userId);
  ok("tidak membuang apa pun selama di bawah atap", dibuang === 0, String(dibuang));
  ok("pemakaian tidak berubah", (await pemakaianByte(userId)) === byte, "berubah");

  section("Hapus percakapan ikut membuang turn-nya");

  const convHapus = await bikin("percakapan untuk dihapus");
  await addTurn(convHapus.id, 1, "q", [], "a", {});
  await hapusConversation(convHapus.id);
  ok("percakapan hilang", (await getConversation(convHapus.id, userId)) === null, "masih ada");
  const [sisa] = await sql.query(
    "SELECT COUNT(*) AS n FROM ai_unified_turns WHERE conversation_id = ?", [convHapus.id]);
  ok("turn-nya ikut hilang lewat CASCADE", Number(sisa[0].n) === 0, String(sisa[0].n));

  section("Kepemilikan dijaga di lapisan data");

  const convMilik = await bikin("milik user ini");
  ok("user lain tidak bisa membacanya", (await getConversation(convMilik.id, userId + 999999)) === null, "terbaca");

  section("Ingatan lintas percakapan");

  const convA = await bikin("tren downtime mesin filling");
  await addTurn(convA.id, 1, "tren downtime mesin filling", [], "Downtime naik 12 persen.", {});
  const convB = await bikin("utas yang sedang dibuka");

  const ingatan = await ingatanLintasPercakapan(userId, convB.id);
  ok("utas yang sedang dibuka dikecualikan", ingatan.every((i) => i.id !== convB.id), "ikut terbawa");
  const jejak = ingatan.find((i) => i.id === convA.id);
  ok("utas lain terbawa", Boolean(jejak), "tidak ketemu");
  ok("cuplikan jawaban dipotong", (jejak?.cuplikanJawaban || "").length <= 300, String(jejak?.cuplikanJawaban?.length));

  section("Daftar riwayat");

  const daftar = await getUserConversations(userId, 30);
  ok("daftar berisi percakapan yang barusan dibuat", daftar.some((d) => d.id === convB.id), "tidak ada");
  ok("tiap baris membawa jumlah turn", daftar.every((d) => Number.isFinite(Number(d.jumlah_turn))), "kolom hilang");
} finally {
  for (const id of dibuat) {
    await sql.query("DELETE FROM ai_unified_conversations WHERE id = ?", [id]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
