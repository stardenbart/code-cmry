import { ok, section } from "./harness.mjs";
import { getCiaIdentityText, isCiaIdentityQuestion } from "../src/services/ciaIdentity.js";

// Berkas ini sebelumnya memakai node:test/node:assert, harness yang TIDAK
// dibaca tests/run-all.mjs. Akibatnya berkas ini tidak pernah tampil di
// keluaran suite dan kegagalan di dalamnya tidak pernah menggagalkan build.
// Ditulis ulang memakai harness proyek supaya benar-benar dihitung.

section("Teks identitas memuat empat elemen inti dan bersih dari emoji/em dash");

const teks = getCiaIdentityText();
ok("menyebut nama CIA", teks.includes("CIA (Cimory Intelligence Assistant)"), teks);
ok("menyebut lokasi CMD Plant Sentul", teks.includes("CMD Plant Sentul"), teks);
ok("menyebut Power BI", teks.includes("Power BI"), teks);
ok("menyebut cara bertanya via tag CIA", teks.includes("tag CIA"), teks);
ok("tidak ada em dash", !teks.includes("—"), teks);
ok("tidak ada emoji",
  !/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(teks),
  teks);

section("Kasus positif: pertanyaan identitas dikenali");

for (const q of ["cia itu apa", "kamu siapa", "siapa kamu", "bisa bantu apa aja", "apa fungsimu", "apa tugas kamu"]) {
  ok(`positif: "${q}"`, isCiaIdentityQuestion(q) === true, `dapat ${isCiaIdentityQuestion(q)}`);
}

section("Kasus negatif: pertanyaan data nyata TIDAK boleh dibajak jadi perkenalan");

// isCiaIdentityQuestion diperiksa PALING AWAL di tryAnswerLocally, untuk
// jalur web maupun WhatsApp. Pola yang kelewat lebar di sini membuat
// pertanyaan data dijawab dengan perkenalan, dan user mengira bot rusak.
const kasusNegatif = [
  "berapa losses hari ini",
  "kenapa downtime Tetra Line 3 tinggi",
  "update informasi terbaru dong",
  "lembur departemen apa yang paling tinggi",
  "siapa PIC dashboard OEE",
  "apa penyebab NC di CMD 2",
  "jelasin performance minggu ini",
  // Celah tambahan: kata "apa" dan "siapa" muncul luas di pertanyaan data,
  // jadi kombinasinya sengaja diuji lebih lebar dari daftar minimal spec.
  "mesin apa yang paling sering downtime",
  "berapa persentase OEE hari ini",
  "siapa operator shift 2 hari ini",
  "line apa saja yang running",
  "kapan maintenance terakhir dilakukan",
];

for (const q of kasusNegatif) {
  ok(`negatif: "${q}"`, isCiaIdentityQuestion(q) === false, `dapat ${isCiaIdentityQuestion(q)}`);
}

section("Masukan rusak tidak melempar dan selalu jatuh ke false");

for (const [label, nilai] of [
  ["string kosong", ""],
  ["null", null],
  ["undefined", undefined],
  ["angka", 123],
  ["object", { foo: "bar" }],
  ["array", ["cia", "itu", "apa"]],
]) {
  let hasil;
  let melempar = false;
  try {
    hasil = isCiaIdentityQuestion(nilai);
  } catch (err) {
    melempar = true;
    hasil = err?.message;
  }
  ok(`${label} -> tidak melempar`, melempar === false, String(hasil));
  ok(`${label} -> false`, hasil === false, String(hasil));
}

section("Pertanyaan identitas dalam bentuk lain juga dikenali");

// Kejadian nyata: user mencoba "siapa kamu", "perkenalkan diri kamu", dan
// "apa cia", lalu ketiganya dijawab "pertanyaan ini belum bisa saya jawab".
// Dua sebabnya: polanya hanya memuat "cia itu apa", dan jalur WhatsApp tidak
// pernah memanggil pemeriksaan ini sama sekali.
const IDENTITAS = [
  "siapa kamu",
  "kamu siapa",
  "@CODE AI siapa kamu",
  "@6281234567890 kamu siapa",
  "perkenalkan diri kamu",
  "perkenalan dong",
  "kenalan dong",
  "apa cia",
  "apa itu cia",
  "cia itu apa",
  "cia apaan",
  "bisa bantu apa aja",
  "kamu bisa apa",
  "fungsinya apa",
  "apa tugas kamu",
  "tugasmu apa",
  "gunanya apa",
];
for (const t of IDENTITAS) {
  ok(`identitas: ${t}`, isCiaIdentityQuestion(t) === true, "tidak dikenali");
}

section("Pertanyaan data TIDAK boleh dibajak jalur identitas");

// Ini bagian yang menahan perbaikan di atas supaya tidak jadi masalah baru.
// Pola yang terlalu lebar akan menjawab perkenalan untuk pertanyaan yang
// seharusnya menarik angka, dan user akan mengira botnya rusak.
const DATA = [
  "apa penyebab downtime tetra pak line 3",
  "apa saja kendala produksi hari ini",
  "apa yang terjadi di cmd 3",
  "berapa output uht milk 250 ml kemarin",
  "siapa PIC dashboard OEE",
  "bandingkan downtime minggu ini",
  "jelaskan deviasi cmd 3",
  "apa deviasi paling tinggi di cmd 3",
  "rekap overtime hari sabtu",
];
for (const t of DATA) {
  ok(`bukan identitas: ${t.slice(0, 40)}`, isCiaIdentityQuestion(t) === false, "dibajak jalur identitas");
}

section("Masukan rusak tidak melempar");

ok("kosong", isCiaIdentityQuestion("") === false, "true atau melempar");
ok("null", isCiaIdentityQuestion(null) === false, "true atau melempar");
ok("angka", isCiaIdentityQuestion(123) === false, "true atau melempar");
ok("hanya mention", isCiaIdentityQuestion("@CODE AI") === false, "true atau melempar");
