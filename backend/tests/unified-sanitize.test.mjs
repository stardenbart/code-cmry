// Sanitasi di jalur chat lintas dashboard.
//
// Jalur ini lebih berisiko daripada jalur satu dashboard, bukan kurang: user
// mencentang BEBERAPA dashboard sekaligus, jadi satu pertanyaan bisa membawa
// snapshot Lembur Plant (gaji, NIK) bersama snapshot produksi dalam satu
// muatan yang sama.
//
// Versi pertama chat lintas dashboard mengirim snapshot MENTAH. Tidak ada satu
// pun galat yang terbit karenanya, dan memang tidak akan pernah: data yang
// bocor tidak menimbulkan error, ia hanya sampai ke tempat yang salah. Uji ini
// ada supaya kemunduran itu berbunyi.
//
// Sama seperti ai-finding-sanitize.test.mjs, Gemini TIDAK dipanggil. Yang diuji
// adalah persis apa yang controller lakukan sebelum dan sesudah panggilan itu.
import { ok, section } from "./harness.mjs";
import { createSanitizer } from "../src/services/aiSanitizer.js";
import { buildMultiDashboardContext } from "../src/services/aiContext.js";

const sanitizer = createSanitizer({ secret: "test-secret" });

section("Snapshot dari BEBERAPA dashboard sama-sama digosok");

// Dua dashboard sekaligus, persis bentuk yang dikirim UnifiedChatPanel.
const snapshotMentah = [
  {
    visuals: [{
      title: "Downtime per mesin",
      columns: ["Nama Operator", "Downtime"],
      rows: [["Budi Santoso", 12]],
    }],
  },
  {
    visuals: [{
      title: "Lembur",
      columns: ["Nama", "NIK", "Gaji"],
      rows: [["Siti Rahayu", "3201234567890001", 8500000]],
    }],
  },
];
const dashboards = [
  { id: 1, title: "Technical Downtime Report", department: "Engineering" },
  { id: 2, title: "Lembur Plant", department: "HR" },
];

const snapshotAman = snapshotMentah.map((s) => sanitizer.sanitizeSnapshot(s));
const konteks = buildMultiDashboardContext(snapshotAman, dashboards, 18000);

ok("nama dari dashboard PERTAMA tidak lolos", !konteks.includes("Budi Santoso"), konteks.slice(0, 400));
// Dashboard kedua sama pentingnya: menggosok yang pertama saja adalah bentuk
// kebocoran yang paling mudah terlewat, karena uji satu dashboard tetap hijau.
ok("nama dari dashboard KEDUA tidak lolos", !konteks.includes("Siti Rahayu"), konteks.slice(0, 400));
ok("NIK tidak lolos", !konteks.includes("3201234567890001"), konteks.slice(0, 400));
ok("angka gaji tidak lolos", !konteks.includes("8500000"), konteks.slice(0, 400));

// Angka operasional TIDAK boleh ikut tergosok: kalau downtime hilang, jawabannya
// jadi tidak berdata sama sekali, dan itu kegagalan yang berbeda tapi sama parah.
ok("angka operasional tetap terbaca", konteks.includes("12"), konteks.slice(0, 400));

section("Teks bebas ikut digosok, lalu dipulihkan untuk user");

const pertanyaan = "kenapa Budi Santoso sering telat reset mesin?";
const pertanyaanAman = sanitizer.sanitizeText(pertanyaan);
ok("nama di PERTANYAAN tidak lolos", !pertanyaanAman.includes("Budi Santoso"), pertanyaanAman);

const token = pertanyaanAman.match(/ORANG_[0-9a-f]+/)?.[0];
ok("pertanyaan memakai token pengganti", Boolean(token), pertanyaanAman);

// Yang digosok adalah apa yang menyeberang ke model, BUKAN apa yang dibaca
// user. Tanpa restore, user melihat ORANG_1 alih-alih nama sungguhan.
const balasanModel = `Menurut data, ${token} tercatat 12 menit downtime.`;
const dibaca = sanitizer.restore(balasanModel);
ok("jawaban yang dibaca user memuat nama asli", dibaca.includes("Budi Santoso"), dibaca);
ok("tidak ada token tersisa di jawaban", !/ORANG_[0-9a-f]+/.test(dibaca), dibaca);

section("Ingatan lintas percakapan ikut digosok");

// Ingatan diambil dari kolom database yang tersimpan DE-TOKENIZED. Mengirimnya
// apa adanya membatalkan sanitasi turn sebelumnya lewat pintu belakang.
const ingatan = "- [Downtime Agustus] tanya: siapa operator terlama?\n  jawab: Budi Santoso, 12 menit";
const ingatanAman = sanitizer.sanitizeText(ingatan);
ok("nama di ingatan tidak lolos", !ingatanAman.includes("Budi Santoso"), ingatanAman);
