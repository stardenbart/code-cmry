import { ok, section } from "./harness.mjs";
import {
  tanggalWib, jamWib, awalHariWibUtc, jendelaLaporan, nilaiCakupan,
  periodeLembur, periodeLemburUntukTanggal, tanggalCutoffLembur,
} from "../src/utils/dateWindow.util.js";

// Semua instant di uji ini ditulis dalam UTC eksplisit, jadi hasilnya tidak
// bergantung pada zona waktu mesin yang menjalankan uji. Uji yang lulus di
// laptop WIB tapi gagal di server UTC adalah uji yang tidak membuktikan apa pun.

section("Konversi WIB tidak bergantung zona mesin");

// 2026-08-04T16:30:00Z = 2026-08-04 23:30 WIB, masih hari yang sama.
ok("16:30Z -> tanggal 2026-08-04",
  tanggalWib(new Date("2026-08-04T16:30:00Z")) === "2026-08-04",
  `dapat ${tanggalWib(new Date("2026-08-04T16:30:00Z"))}`);
ok("16:30Z -> jam 23:30", jamWib(new Date("2026-08-04T16:30:00Z")) === "23:30",
  `dapat ${jamWib(new Date("2026-08-04T16:30:00Z"))}`);

// 2026-08-04T17:30:00Z = 2026-08-05 00:30 WIB, sudah lewat tengah malam WIB.
// Inilah kasus yang salah kalau perhitungan memakai komponen tanggal lokal.
ok("17:30Z sudah masuk 2026-08-05 di WIB",
  tanggalWib(new Date("2026-08-04T17:30:00Z")) === "2026-08-05",
  `dapat ${tanggalWib(new Date("2026-08-04T17:30:00Z"))}`);

ok("awal 2026-08-04 WIB = 2026-08-03T17:00:00Z",
  awalHariWibUtc("2026-08-04").toISOString() === "2026-08-03T17:00:00.000Z",
  `dapat ${awalHariWibUtc("2026-08-04").toISOString()}`);

section("Jendela laporan adalah hari sebelumnya menurut WIB");

// Job jalan 06:15 WIB tanggal 5 = 2026-08-04T23:15:00Z.
const j = jendelaLaporan(new Date("2026-08-04T23:15:00Z"));
ok("melaporkan 2026-08-04", j.tanggal === "2026-08-04", `dapat ${j.tanggal}`);
ok("mulai 2026-08-03T17:00Z", j.mulaiUtc.toISOString() === "2026-08-03T17:00:00.000Z", `dapat ${j.mulaiUtc.toISOString()}`);
ok("selesai 2026-08-04T17:00Z", j.selesaiUtc.toISOString() === "2026-08-04T17:00:00.000Z", `dapat ${j.selesaiUtc.toISOString()}`);

// Batas yang paling mudah salah: 00:30 WIB. Hari laporannya harus hari
// sebelumnya, bukan dua hari sebelumnya.
const jTengahMalam = jendelaLaporan(new Date("2026-08-04T17:30:00Z"));
ok("00:30 WIB tanggal 5 melaporkan tanggal 4", jTengahMalam.tanggal === "2026-08-04",
  `dapat ${jTengahMalam.tanggal}`);

section("Cakupan data dinilai dari batas hari, bukan dari seberapa baru");

// Kasus terukur 2026-08-04: refresh sukses terakhir tiap model, dinilai
// terhadap hari laporan 2026-08-04 dengan job jalan 06:15 WIB tanggal 5.
const jendela = jendelaLaporan(new Date("2026-08-04T23:15:00Z"));

// NC dan Deviasi refresh 00:00 WIB tanggal 5 = 2026-08-04T17:00Z, tepat di batas.
const nc = nilaiCakupan(new Date("2026-08-04T17:00:00Z"), jendela);
ok("refresh tepat di batas -> full", nc.freshness === "full", `dapat ${nc.freshness}`);
ok("full tidak punya cutoff", nc.cutoffWib === null, `dapat ${nc.cutoffWib}`);

// Lembur Plant refresh 17:30 WIB tanggal 4 = 2026-08-04T10:30Z.
const lembur = nilaiCakupan(new Date("2026-08-04T10:30:00Z"), jendela);
ok("Lembur Plant -> partial", lembur.freshness === "partial", `dapat ${lembur.freshness}`);
ok("cutoff terbaca 17:30", lembur.cutoffWib === "17:30", `dapat ${lembur.cutoffWib}`);

// Overtime refresh 17:00 WIB tanggal 4 = 2026-08-04T10:00Z.
const overtime = nilaiCakupan(new Date("2026-08-04T10:00:00Z"), jendela);
ok("Overtime cutoff 17:00", overtime.cutoffWib === "17:00", `dapat ${overtime.cutoffWib}`);

// Emission CMD refresh terakhir 2026-08-03T00:06 WIB = 2026-08-02T17:06Z,
// mendahului hari laporan sepenuhnya.
const emisi = nilaiCakupan(new Date("2026-08-02T17:06:00Z"), jendela);
ok("refresh mendahului hari laporan -> unavailable", emisi.freshness === "unavailable",
  `dapat ${emisi.freshness}`);

section("Masukan rusak tidak dipaksakan jadi angka");

for (const [label, nilai] of [["null", null], ["undefined", undefined], ["string sampah", "bukan tanggal"]]) {
  const r = nilaiCakupan(nilai, jendela);
  ok(`${label} -> unavailable`, r.freshness === "unavailable", `dapat ${r.freshness}`);
}

section("Periode lembur memakai cut-off tanggal 13, bukan bulan kalender");

// Aturan pemilik 2026-08-06: lembur bulan Juni berjalan 13 Juni sampai 12 Juli.
// Memakai bulan kalender akan menggeser hampir separuh kejadian ke bulan yang
// salah, dan angkanya tetap keluar tanpa error apa pun.
ok("cut-off bawaan tanggal 13", tanggalCutoffLembur() === 13, String(tanggalCutoffLembur()));

const juni = periodeLembur(2026, 6);
ok("Juni mulai 2026-06-13", juni.mulaiTanggal === "2026-06-13", juni.mulaiTanggal);
ok("Juni selesai 2026-07-12", juni.selesaiTanggal === "2026-07-12", juni.selesaiTanggal);
ok("labelnya menyebut bulannya", juni.label === "Juni 2026", juni.label);

// Desember menyeberang tahun. Tanpa penanganan ini, periodenya jadi
// 2026-12-13 sampai 2026-01-12 yang mundur ke belakang.
const des = periodeLembur(2026, 12);
ok("Desember selesai di tahun berikutnya", des.selesaiTanggal === "2027-01-12", des.selesaiTanggal);

// Batas yang paling mudah salah: tanggal 12 dan 13.
ok("tanggal 12 masih periode bulan sebelumnya",
  periodeLemburUntukTanggal("2026-08-12").label === "Juli 2026",
  periodeLemburUntukTanggal("2026-08-12").label);
ok("tanggal 13 sudah periode bulan berjalan",
  periodeLemburUntukTanggal("2026-08-13").label === "Agustus 2026",
  periodeLemburUntukTanggal("2026-08-13").label);
ok("awal Januari masuk periode Desember tahun lalu",
  periodeLemburUntukTanggal("2026-01-05").label === "Desember 2025",
  periodeLemburUntukTanggal("2026-01-05").label);
