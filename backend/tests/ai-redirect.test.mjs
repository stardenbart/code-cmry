import { ok, section } from "./harness.mjs";
import {
  ringkasKatalogUntukPengalihan, aturanPengalihanUntukInstruksi,
} from "../src/services/dashboardRedirect.js";

const DASHBOARDS = [
  { id: 1, title: "Losses Report", department: "Production", description: "<p>Losses RM dan PM per CMD</p>", canOpen: true },
  { id: 2, title: "Technical Downtime ORS", department: "Maintenance", description: "Downtime per mesin beserta issue", canOpen: true },
  { id: 3, title: "Rahasia Direksi", department: "Finance", description: "Gaji", canOpen: false },
];

section("Katalog pengalihan HANYA memuat dashboard yang boleh dibuka");

const ringkas = ringkasKatalogUntukPengalihan(DASHBOARDS);
// Menyebut nama dashboard beserta isinya sudah membocorkan informasi, jadi yang
// tidak boleh dibuka tidak boleh muncul sama sekali.
ok("dua dashboard lolos", ringkas.length === 2, JSON.stringify(ringkas.map((r) => r.title)));
ok("yang terlarang tidak muncul", !ringkas.some((r) => /Rahasia/.test(r.title)), JSON.stringify(ringkas));
ok("membawa id", ringkas[0].id === 1);
ok("membawa departemen", ringkas[0].department === "Production");

section("HTML di deskripsi dibuang");

ok("tag html hilang", !/[<>]/.test(ringkas[0].ringkas), ringkas[0].ringkas);
ok("isi deskripsi tetap ada", /Losses RM/.test(ringkas[0].ringkas), ringkas[0].ringkas);

section("Penyaringan pada bentuk data NYATA dari getCatalogForUser (hasAccess, tanpa canOpen)");

const BENTUK_NYATA = [
  { id: 10, title: "Dashboard Boleh", department: "Ops", description: "isi", hasAccess: true },
  { id: 11, title: "Dashboard Terlarang", department: "Ops", description: "isi", hasAccess: false },
  { id: 12, title: "Dashboard Tanpa Properti Akses", department: "Ops", description: "isi" },
];

const ringkasNyata = ringkasKatalogUntukPengalihan(BENTUK_NYATA);
ok("hasAccess true lolos", ringkasNyata.some((r) => r.id === 10), JSON.stringify(ringkasNyata));
ok("hasAccess false tersaring", !ringkasNyata.some((r) => r.id === 11), JSON.stringify(ringkasNyata));
ok("tanpa properti akses tersaring", !ringkasNyata.some((r) => r.id === 12), JSON.stringify(ringkasNyata));
ok("hanya satu yang lolos", ringkasNyata.length === 1, JSON.stringify(ringkasNyata));

section("Katalog dibatasi jumlahnya");

const banyak = Array.from({ length: 60 }, (_, i) => ({
  id: i, title: `Dashboard ${i}`, department: "X", description: "y".repeat(300), canOpen: true,
}));
ok("dibatasi 40", ringkasKatalogUntukPengalihan(banyak).length === 40,
  String(ringkasKatalogUntukPengalihan(banyak).length));

section("Aturan pengalihan menuntut nama nyata, bukan kategori umum");

const aturan = aturanPengalihanUntukInstruksi(ringkas);
ok("memuat nama dashboard", aturan.includes("Technical Downtime ORS"), aturan.slice(0, 300));
ok("melarang menyebut dashboard di luar daftar", /hanya.*daftar|jangan.*di luar/i.test(aturan), aturan);
// Dari perilaku sistem ini sendiri: pertanyaan umum ditolak sebagai ambigu
// sementara yang menyebut nama spesifik langsung terjawab.
ok("meminta contoh pertanyaan menyebut nama nyata", /nama.*(mesin|spesifik|nyata)/i.test(aturan), aturan);
ok("meminta menawarkan menjawab langsung", /tawarkan|mau saya/i.test(aturan), aturan);
