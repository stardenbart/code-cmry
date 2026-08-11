// Menjaga kamus nilai: penghubung antara kata yang dipakai user dan nilai yang
// benar-benar tersimpan di model Power BI.
//
// Kenapa ini penting sampai perlu dijaga uji: skema hidup dari Power BI memberi
// nama tabel dan kolom, tapi TIDAK memberi isi kolomnya. Tanpa kamus ini, filter
// ditulis dengan kata user ("Pasuruan") padahal data menyimpan kode ("CMDPSR"),
// hasilnya nol baris, dan nol baris terbaca seperti "tidak ada downtime".
// Kegagalannya berupa angka yang terdengar pasti, jadi tidak terlihat sebagai
// kegagalan dan hanya uji yang bisa menangkapnya.
import { ok, section } from "./harness.mjs";
import { kamusNilai, aturanKomparasi } from "../src/services/aiKnowledge.js";

section("Yang wajib selalu ikut");

// Tabrakan gedung CMD1-6 dengan plant CMDPSR/CMDSMG/CMDSTL adalah kekeliruan
// termahal di kamus ini, jadi kedua daftar dikirim untuk pertanyaan apa pun.
const kosong = kamusNilai("");
ok("plant codes selalu ada", /CMDPSR/.test(kosong), kosong.slice(0, 80));
ok("building codes selalu ada", /CMD1/.test(kosong), kosong.slice(0, 80));
ok("peringatan tabrakan ikut", /gedung/i.test(kosong), "tidak ada peringatan");

section("Subbagian mesin hanya ikut kalau pertanyaannya soal mesin");

const tanyaMesin = kamusNilai("kenapa downtime tetra pak line 3 tinggi");
ok("nama mesin ikut", /Tetra Pak Line 3 250ml/.test(tanyaMesin), "tidak ada");
ok(
  "nama mesin lengkap dengan varian yang mirip",
  /Tetra Pak Line 5 250ml/.test(tanyaMesin),
  "daftar mesin terpotong"
);

const tanyaLembur = kamusNilai("rekap overtime hari sabtu periode cutoff juli");
ok("nama mesin TIDAK ikut", !/Evergreen ESL 950ml/.test(tanyaLembur), "mesin ikut padahal tidak relevan");

section("Subbagian produk ikut untuk pertanyaan output");

const tanyaProduk = kamusNilai("output uht milk 250ml week ini berapa totalnya");
ok("subgroup produk ikut", /UHT Milk 250 ml/.test(tanyaProduk), "tidak ada");
ok("varian PSR disebut", /UHT Milk 250 ml PSR/.test(tanyaProduk), "ambiguitas PSR hilang");
ok("aturan abai spasi disebut", /space/i.test(tanyaProduk), "aturan pencocokan hilang");

section("Subbagian status ikut untuk pertanyaan perbaikan");

const tanyaStatus = kamusNilai("bagaimana status perbaikan downtime serac blow moulding");
ok("status downtime ikut", /CLOSED/.test(tanyaStatus), "tidak ada");
ok("catatan casing tidak konsisten ikut", /monitoring/.test(tanyaStatus), "tidak ada");

section("Jenis produksi ikut untuk pertanyaan planning dan PO");

const tanyaPo = kamusNilai("berapa achievement production output dibandingkan total PO kemarin");
ok("Jenis produksi ikut", /Delay Produksi/.test(tanyaPo), "tidak ada");
ok("status hold ikut", /Hold QC/.test(tanyaPo), "tidak ada");

section("Batas ukuran ditegakkan");

// Batas kecil sengaja dipakai untuk membuktikan pemangkasnya jalan. Pemangkas
// yang menambahkan penanda SESUDAH memotong sudah dua kali melewati batasnya
// sendiri di proyek ini, jadi yang diuji adalah panjang akhirnya.
const dipangkas = kamusNilai("tetra pak line 3 uht milk 250ml status perbaikan", { maks: 300 });
ok("tidak melewati batas plus penanda", dipangkas.length <= 300 + 60, `${dipangkas.length}`);
ok("penanda pemangkasan disebut", /dipotong/.test(dipangkas), "dipangkas tanpa memberi tahu");

section("Aturan komparasi hanya muncul saat dibutuhkan");

// Pertanyaan lookup biasa tidak boleh membawa aturan perbandingan. Prompt yang
// membawa aturan tentang sesuatu yang tidak ditanyakan membuat model
// mengomentari perbandingan yang tidak diminta.
ok(
  "pertanyaan tanpa perbandingan tidak membawa aturannya",
  aturanKomparasi("berapa total output uht milk 250 ml") === "",
  "aturan ikut padahal tidak diminta"
);

const komparasi = aturanKomparasi("downtime hari ini naik dibanding minggu lalu tidak");
ok("measure Prev disebut", /\(T\) DT Prev Week/.test(komparasi), "tidak ada");
ok("aturan sebut basis perbandingan", /basis/i.test(komparasi), "tidak ada");

const kuartal = aturanKomparasi("bandingkan downtime q1 dan q2");
ok("pola quarter ikut", /Dim_Date\[Quarter\]/.test(kuartal), "tidak ada");
ok("peringatan pin tahun ikut", /pin the year/i.test(kuartal), "peringatan tahun hilang");

const lembur = aturanKomparasi("rekap overtime hari libur periode cutoff juli");
ok("aturan cut off ikut", /13th/.test(lembur) || /cut-off/i.test(lembur), "tidak ada");
ok(
  "kalender libur hanya 2026 disebut",
  /Dim_Liburnasional2026/.test(lembur),
  "batas tahun kalender libur hilang"
);
ok(
  "kolom Jenis Hari Lembur berspasi belakang disebut",
  /Jenis Hari Lembur /.test(lembur),
  "nama kolom persisnya hilang"
);

section("Masukan rusak tidak melempar");

ok("kamus null aman", typeof kamusNilai(null) === "string", "melempar");
ok("kamus angka aman", typeof kamusNilai(123) === "string", "melempar");
ok("kamus undefined aman", typeof kamusNilai(undefined) === "string", "melempar");
ok("komparasi null aman", typeof aturanKomparasi(null) === "string", "melempar");
ok("komparasi angka aman", typeof aturanKomparasi(123) === "string", "melempar");
