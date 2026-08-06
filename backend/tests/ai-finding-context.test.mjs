import { ok, section } from "./harness.mjs";
import {
  susunKonteksTemuan, aturanTemuanUntukInstruksi, BATAS_KONTEKS_TEMUAN,
} from "../src/services/findingContext.js";

const TEMUAN = [
  {
    dashboardId: 44, dashboardTitle: "Losses Report", umurJam: 2,
    ringkasan: "Losses PM naik di CMD 2",
    angka: [{ measure: "% Losses Packing", nilai: 0.001 }, { measure: "Losses RM (IDR)", nilai: 24677 }],
    belumTerjawab: "penyebab kenaikannya",
  },
  {
    dashboardId: 45, dashboardTitle: "Technical Downtime ORS", umurJam: 5,
    ringkasan: "Serac Line 3 downtime tertinggi",
    angka: [{ measure: "(M) DT Tech in Hour", nilai: 56.35 }],
    belumTerjawab: null,
  },
];

section("Blok temuan diberi label tegas");

const blok = susunKonteksTemuan(TEMUAN);
// Tanpa label tegas, model menyebut angka Losses seolah berasal dari dashboard
// yang sedang dibuka, dan pembacanya tidak punya cara mengetahuinya.
ok("menyebut bahwa ini dari dashboard LAIN", /DASHBOARD LAIN/i.test(blok), blok.slice(0, 120));
ok("menyebut bukan dashboard yang dibuka", /bukan.*dashboard yang sedang dibuka/i.test(blok), blok.slice(0, 200));

section("Setiap temuan membawa sumber, umur, angka, dan yang belum terjawab");

ok("nama dashboard ikut", blok.includes("Losses Report"));
ok("umur jam ikut", /2 jam/.test(blok), blok);
ok("nama measure ikut", blok.includes("% Losses Packing"));
ok("nilai ikut", /24\.677|24677/.test(blok), blok);
ok("belum terjawab ikut", blok.includes("penyebab kenaikannya"));
ok("temuan kedua juga masuk", blok.includes("Technical Downtime ORS"));

section("Tidak ada temuan berarti string kosong, bukan blok kosong");

// Blok berlabel tapi tanpa isi membuat model menyebut "tidak ada temuan
// sebelumnya" padahal user tidak menanyakannya.
ok("array kosong -> string kosong", susunKonteksTemuan([]) === "");
ok("null -> string kosong", susunKonteksTemuan(null) === "");
ok("undefined -> string kosong", susunKonteksTemuan(undefined) === "");

section("Batas karakter ditegakkan dan pemangkasannya DISEBUT");

const banyak = Array.from({ length: 12 }, (_, i) => ({
  dashboardId: i, dashboardTitle: `Dashboard dengan nama panjang nomor ${i}`, umurJam: i,
  ringkasan: "x".repeat(300),
  angka: [{ measure: `Measure panjang ${i}`, nilai: i }],
  belumTerjawab: "y".repeat(200),
}));
const besar = susunKonteksTemuan(banyak);
ok(`panjang ${besar.length} tidak melewati ${BATAS_KONTEKS_TEMUAN}`,
  besar.length <= BATAS_KONTEKS_TEMUAN, String(besar.length));
// Pemangkasan yang tidak disebut membuat model menganalisis data lebih sempit
// sambil menganggapnya lengkap.
ok("pemangkasan disebut", /dipangkas|tidak semua/i.test(besar), besar.slice(-160));

section("Aturan instruksi menuntut sumber angka disebut");

const aturan = aturanTemuanUntukInstruksi();
ok("mewajibkan menyebut dashboard sumber", /sebut.*dashboard/i.test(aturan), aturan);
ok("melarang mencampur dengan dashboard sekarang", /jangan/i.test(aturan), aturan);
