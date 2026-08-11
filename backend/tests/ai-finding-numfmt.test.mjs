import { ok, section } from "./harness.mjs";
import { susunKonteksTemuan } from "../src/services/findingContext.js";
import { formatNumber } from "../src/services/tabular.js";

// Perbaikan Important #4: angka temuan diformat beda aturan dengan angka
// dashboard. fmt lokal findingContext.js dulu memakai maximumFractionDigits
// berbeda dari formatter kanonik tabular.js untuk rentang 10-1000 — nilai yang
// sama disebut berbeda di blok temuan dan di dashboard sumbernya.

section("Nilai di rentang 10-1000 identik antara blok temuan dan formatter kanonik");

const NILAI = 56.35;
const kanonik = formatNumber(NILAI);

const blok = susunKonteksTemuan([{
  dashboardId: 45, dashboardTitle: "Technical Downtime ORS", umurJam: 5,
  ringkasan: "Serac Line 3 downtime tertinggi",
  angka: [{ measure: "(M) DT Tech in Hour", nilai: NILAI }],
  belumTerjawab: null,
}]);

ok(`angka ${NILAI} muncul sebagai "${kanonik}" di blok temuan`, blok.includes(kanonik), blok);
ok("bukan bentuk fmt lama (3 desimal)", !blok.includes("56,350"), blok);
