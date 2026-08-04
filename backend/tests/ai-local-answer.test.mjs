import { ok, section } from "./harness.mjs";
import { tryAnswerLocally } from "../src/services/aiLocalAnswer.js";

// Snapshot tiruan yang bentuknya sama dengan yang dikirim frontend.
const snapshot = {
  filters: ["Bulan is Juli 2026"],
  pagesRead: ["OEE & Downtime"],
  visuals: [
    {
      title: "Downtime per Mesin",
      columns: ["Mesin", "Downtime (Jam)"],
      rows: [
        ["ABP Line 2", "12,5"],
        ["Serac 2", "8"],
        ["Filler A", "3,5"],
        ["Capper B", "1"],
      ],
      rowCount: 4,
    },
  ],
};

const dashboard = { id: 1, title: "OEE & Downtime", department: "Plant" };

section("TOTAL dijawab dari statistik");

const total = tryAnswerLocally({ question: "Berapa total downtime?", snapshot, dashboard });
ok("terjawab", total.answered === true, JSON.stringify(total));
ok("intent TOTAL", total.intent === "TOTAL", total.intent);
// 12,5 + 8 + 3,5 + 1 = 25
ok("angkanya benar", /\b25\b/.test(total.text), total.text);
ok("menyertakan konteks filter", /Juli 2026/.test(total.text), total.text);

section("MAX menyebut baris pemenang");

const max = tryAnswerLocally({ question: "Mesin mana yang downtime paling tinggi?", snapshot, dashboard });
ok("terjawab", max.answered === true, JSON.stringify(max));
ok("menyebut ABP Line 2", /ABP Line 2/i.test(max.text), max.text);
ok("menyebut 12,5 atau 12.5", /12[.,]5/.test(max.text), max.text);

section("TOP_N mengembalikan N baris teratas");

const top = tryAnswerLocally({ question: "top 3 mesin downtime tertinggi", snapshot, dashboard });
ok("terjawab", top.answered === true, JSON.stringify(top));
ok("memuat tiga nama teratas",
  /ABP Line 2/i.test(top.text) && /Serac 2/i.test(top.text) && /Filler A/i.test(top.text), top.text);
ok("tidak memuat yang keempat", !/Capper B/i.test(top.text), top.text);

section("AVG dan COUNT");

const avg = tryAnswerLocally({ question: "rata-rata downtime berapa?", snapshot, dashboard });
ok("AVG terjawab", avg.answered === true, JSON.stringify(avg));
ok("rata-rata 6,25", /6[.,]25/.test(avg.text), avg.text);

const count = tryAnswerLocally({ question: "ada berapa mesin?", snapshot, dashboard });
ok("COUNT terjawab", count.answered === true, JSON.stringify(count));
ok("menyebut 4", /\b4\b/.test(count.text), count.text);

section("VALUE_OF mencari barisnya");

const nilai = tryAnswerLocally({ question: "downtime mesin Serac 2 berapa?", snapshot, dashboard });
ok("terjawab", nilai.answered === true, JSON.stringify(nilai));
ok("menyebut 8", /\b8\b/.test(nilai.text), nilai.text);

const tidakAda = tryAnswerLocally({ question: "downtime mesin Tidak Ada Ini berapa?", snapshot, dashboard });
ok("entitas tidak ketemu TIDAK dijawab", tidakAda.answered === false, JSON.stringify(tidakAda));

section("FILTER_STATE menyebut filter aktif");

const filter = tryAnswerLocally({ question: "filter apa yang aktif sekarang?", snapshot, dashboard });
ok("terjawab", filter.answered === true, JSON.stringify(filter));
ok("menyebut filternya", /Juli 2026/.test(filter.text), filter.text);

section("Pertanyaan analitis DITOLAK, bukan dijawab");

for (const q of [
  "Kenapa downtime naik drastis bulan ini?",
  "Coba analisa root cause dari top 3 downtime",
  "Berikan top 3 line dengan downtime tertinggi Q1 vs Q2",
]) {
  const hasil = tryAnswerLocally({ question: q, snapshot, dashboard });
  ok(`ditolak: "${q.slice(0, 42)}"`, hasil.answered === false, JSON.stringify(hasil));
}

section("Snapshot kosong atau tanpa kolom angka ditolak");

ok("snapshot null ditolak",
  tryAnswerLocally({ question: "Berapa total downtime?", snapshot: null, dashboard }).answered === false);
ok("visual tanpa angka ditolak",
  tryAnswerLocally({
    question: "Berapa total downtime?",
    snapshot: { visuals: [{ title: "Catatan", columns: ["Keterangan"], rows: [["halo"]], rowCount: 1 }], filters: [] },
    dashboard,
  }).answered === false);

section("Dua kolom angka yang sama-sama cocok ditolak (ambigu)");

const ambigu = {
  filters: [],
  visuals: [{
    title: "Downtime",
    columns: ["Mesin", "Downtime Rencana", "Downtime Aktual"],
    rows: [["A", "5", "7"], ["B", "3", "9"]],
    rowCount: 2,
  }],
};
const hasilAmbigu = tryAnswerLocally({ question: "Berapa total downtime?", snapshot: ambigu, dashboard });
ok("kolom ambigu ditolak", hasilAmbigu.answered === false, JSON.stringify(hasilAmbigu));

section("Beberapa visual berangka: dipilih lewat kata di pertanyaan");

// Dashboard nyata hampir selalu punya lebih dari satu visual berangka. Menolak
// begitu jumlahnya lebih dari satu akan membuat fitur ini tidak pernah menyala.
const banyakVisual = {
  filters: ["Bulan is Juli 2026"],
  visuals: [
    {
      title: "Downtime per Mesin",
      columns: ["Mesin", "Downtime (Jam)"],
      rows: [["ABP Line 2", "12,5"], ["Serac 2", "8"]],
      rowCount: 2,
    },
    {
      title: "Output per Mesin",
      columns: ["Mesin", "Output (Karton)"],
      rows: [["ABP Line 2", "1000"], ["Serac 2", "2500"]],
      rowCount: 2,
    },
  ],
};

const pilihDowntime = tryAnswerLocally({ question: "Berapa total downtime?", snapshot: banyakVisual, dashboard });
ok("kata downtime memilih visual downtime", pilihDowntime.answered === true, JSON.stringify(pilihDowntime));
ok("angkanya 20,5", /20[.,]5/.test(pilihDowntime.text), pilihDowntime.text);

const pilihOutput = tryAnswerLocally({ question: "Berapa total output?", snapshot: banyakVisual, dashboard });
ok("kata output memilih visual output", pilihOutput.answered === true, JSON.stringify(pilihOutput));
ok("angkanya 3500", /3500/.test(pilihOutput.text), pilihOutput.text);

// Tanpa kata pembeda, tetap harus menolak.
const tanpaPetunjuk = tryAnswerLocally({ question: "Berapa totalnya?", snapshot: banyakVisual, dashboard });
ok("tanpa kata pembeda ditolak", tanpaPetunjuk.answered === false, JSON.stringify(tanpaPetunjuk));

section("Glosarium dijawab dari berkas pengetahuan, bukan dari snapshot");

// getGlossaryRows() mengembalikan STRING ber-newline, bukan array. Versi
// pertama memanggil .filter() di atasnya dan melempar TypeError, yang tidak
// tertangkap uji mana pun karena tidak ada uji glosarium. Sekarang ada.
const glosarium = tryAnswerLocally({ question: "Apa itu MTBF?", snapshot: null, dashboard });
ok("tidak melempar, mengembalikan objek",
  glosarium && typeof glosarium.answered === "boolean", JSON.stringify(glosarium));
ok("intent GLOSSARY", glosarium.intent === "GLOSSARY", glosarium.intent);
// Di mesin tanpa backend/knowledge/ (folder itu di-gitignore) ia menolak dengan
// alasan yang jelas, bukan crash. Keduanya hasil yang sah.
ok("terjawab atau ditolak dengan alasan",
  glosarium.answered === true || typeof glosarium.reason === "string", JSON.stringify(glosarium));
if (glosarium.answered) {
  ok("jawabannya menyebut MTBF", /MTBF/i.test(glosarium.text), glosarium.text.slice(0, 90));
}

const takAda = tryAnswerLocally({ question: "Apa itu ZZQX?", snapshot: null, dashboard });
ok("istilah tak dikenal ditolak", takAda.answered === false, JSON.stringify(takAda));

// Jawaban glosarium adalah teks yang dibaca user, jadi anotasi internal dan em
// dash tidak boleh ikut. Baris OEE memuat "(model: ... (source), ...)" dengan
// kurung bersarang: versi pertama memotongnya di kurung dalam dan menyisakan
// potongan menggantung.
for (const q of ["Apa itu MTBF?", "Kalo OEE itu apa?", "Apa itu OTIF?"]) {
  const h = tryAnswerLocally({ question: q, snapshot: null, dashboard });
  if (!h.answered) continue; // mesin tanpa backend/knowledge/
  ok(`"${q}" tanpa em dash`, !/—/.test(h.text), h.text.slice(0, 80));
  ok(`"${q}" tanpa anotasi internal`,
    !/\[Needs confirmation\]|\[Confirmed\]|\(model:/i.test(h.text), h.text.slice(0, 80));
}

section("Sifat: lebih baik menolak daripada salah");

// Snapshot dengan label yang mirip satu sama lain: "Line 1" juga cocok ke
// "Line 10", sehingga pencarian entitas jadi ambigu.
const mirip = {
  filters: [],
  visuals: [{
    title: "Downtime per Line",
    columns: ["Line", "Jam"],
    rows: [["Line 1", "4"], ["Line 10", "9"], ["Line 11", "2"]],
    rowCount: 3,
  }],
};
const hasilMirip = tryAnswerLocally({ question: "downtime line 1 berapa?", snapshot: mirip, dashboard });
ok("label ambigu ditolak", hasilMirip.answered === false, JSON.stringify(hasilMirip));
