import { ok, section } from "./harness.mjs";
import { instruksiPenyaring, bacaHasilPenyaring } from "../src/services/findingDistiller.js";

// Perbaikan Critical #2: nama orang dan supplier tidak boleh masuk temuan.
// Ini keputusan pemilik proyek: penjagaan berbasis POLA teks yang jelas bukan
// nama measure, BUKAN pendeteksi entitas nama bebas.

section("Instruksi melarang nama orang/supplier/vendor/pelanggan secara tegas");

const ins = instruksiPenyaring();
ok("melarang nama orang", /nama orang/i.test(ins), ins);
ok("melarang nama supplier", /nama supplier/i.test(ins), ins);
ok("menyuruh sebut peran saja", /peran/i.test(ins), ins);

section("measure yang berupa nama perusahaan dibuang seluruhnya");

const hasil1 = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "Losses PM naik di CMD 2",
  angka: [
    { measure: "PT Sumber Makmur Jaya", nilai: 5 },
    { measure: "% Losses Packing", nilai: 0.1 },
  ],
}));
ok("measure nama perusahaan dibuang", !hasil1.angka.some((a) => /Sumber Makmur/i.test(a.measure)),
  JSON.stringify(hasil1.angka));
ok("measure normal tetap ada", hasil1.angka.some((a) => a.measure === "% Losses Packing"),
  JSON.stringify(hasil1.angka));
ok("hanya satu angka yang tersisa", hasil1.angka.length === 1, JSON.stringify(hasil1.angka));
ok("ditandai namaTersensor", hasil1.namaTersensor === true, JSON.stringify(hasil1));

section("Ringkasan yang memuat nama perusahaan disensor, sisanya utuh");

const hasil2 = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "Losses tertinggi disebabkan PT Sumber Makmur Jaya pada CMD 2",
  angka: [],
}));
ok("nama perusahaan tersensor", !/Sumber Makmur/i.test(hasil2.ringkasan), hasil2.ringkasan);
ok("kata peran menggantikan nama", /\[supplier\]/i.test(hasil2.ringkasan), hasil2.ringkasan);
ok("sisa kalimat tetap utuh", hasil2.ringkasan.includes("Losses tertinggi disebabkan") &&
  hasil2.ringkasan.includes("pada CMD 2"), hasil2.ringkasan);
ok("ditandai namaTersensor", hasil2.namaTersensor === true);

section("Sapaan orang (Bpk/Ibu/Sdr) juga tersensor di belumTerjawab");

const hasil3 = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "x",
  angka: [],
  belumTerjawab: "perlu konfirmasi ke Bpk Joko Santoso soal penyebabnya",
}));
ok("sapaan orang tersensor", !/Joko Santoso/i.test(hasil3.belumTerjawab), hasil3.belumTerjawab);
ok("kata peran operator dipakai", /\[operator\]/i.test(hasil3.belumTerjawab), hasil3.belumTerjawab);

section("Sapaan kasual Pak/Bu (bukan hanya Bpk/Ibu formal) tertangkap");

// Sumber jalur ini adalah percakapan chat kasual, dan di register itu "Pak"
// justru bentuk yang paling umum dipakai, bukan "Bpk" yang lebih formal.
const hasilPak = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "Pak Joko menyebabkan downtime naik di Line 2",
  angka: [],
}));
ok("nama sesudah Pak tersensor", !/Joko/i.test(hasilPak.ringkasan), hasilPak.ringkasan);
ok("kata peran operator dipakai (Pak)", /\[operator\]/i.test(hasilPak.ringkasan), hasilPak.ringkasan);

const hasilBu = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "Konfirmasi ke Bu Sri soal penyebab losses",
  angka: [],
}));
ok("nama sesudah Bu tersensor", !/\bSri\b/.test(hasilBu.ringkasan), hasilBu.ringkasan);
ok("kata peran operator dipakai (Bu)", /\[operator\]/i.test(hasilBu.ringkasan), hasilBu.ringkasan);

section("Kata biasa yang mirip sapaan (buat/pakai) TIDAK ikut tersensor");

// "Bu" dan "Pak" case-sensitive, dan \s+ WAJIB langsung sesudah token sapaan —
// dua penjagaan itu bersama mencegah "buat"/"pakai" ikut tertangkap, baik
// huruf kecil di tengah kalimat maupun huruf besar karena mengawali kalimat.
for (const teks of [
  "buat laporan losses bulan ini",
  "pakai filter periode Juli",
  "Buat laporan losses bulan ini",   // awal kalimat, huruf besar
  "Pakai filter periode Juli",       // awal kalimat, huruf besar
]) {
  const hasil = bacaHasilPenyaring(JSON.stringify({ ringkasan: teks, angka: [] }));
  ok(`"${teks}" tidak tersensor`, hasil.ringkasan === teks && hasil.namaTersensor === false,
    JSON.stringify(hasil));
}

section("Teks tanpa pola nama tidak ditandai dan tidak berubah");

const hasil4 = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "Losses PM naik di CMD 2",
  angka: [{ measure: "% Losses Packing", nilai: 0.1 }],
  belumTerjawab: "penyebab kenaikannya",
}));
ok("ringkasan tidak berubah", hasil4.ringkasan === "Losses PM naik di CMD 2", hasil4.ringkasan);
ok("namaTersensor false", hasil4.namaTersensor === false, JSON.stringify(hasil4));
