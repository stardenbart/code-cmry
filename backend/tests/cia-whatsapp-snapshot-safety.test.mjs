import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { createSanitizer } from "../src/services/aiSanitizer.js";
import {
  prepareSnapshotModelInput,
  sanitizeSnapshotModelAnswer,
} from "../src/services/whatsappQA.service.js";

section("WA snapshot menyanitasi entitas dan menghumanisasi identifier sebelum/sesudah model");
const sanitizer = createSanitizer({ secret: "snapshot-safety-test" });
const prepared = prepareSnapshotModelInput({
  question: "bagaimana Supplier AJI untuk OT_HOURS?",
  jendela: { mulaiTanggal: "2026-08-24", selesaiTanggal: "2026-08-30" },
  domains: [{
    domain: "cost", freshness: "fresh",
    kpi: [{
      jenis: "breakdown", kpi: "OT_HOURS", measures: ["'MeasureTable'[OT_HOURS]"],
      dimensi: "Supplier.Name", kolomTeksDipakai: [], n: 3, unit: "jam", status: "active",
      dateFilterApplied: true, baris: [{ label: "AJI", value: 7 }],
    }],
  }],
}, { sanitizer });
const serialized = JSON.stringify({ question: prepared.question, muatan: prepared.muatan });
ok("model packet tidak memuat entitas asli atau identifier teknis",
  !/AJI|OT_HOURS|MeasureTable|Supplier\.Name/.test(serialized)
    && /MITRA_/.test(serialized) && /Ot hours/.test(serialized) && /Supplier name/.test(serialized),
  serialized);

const safeAnswer = sanitizeSnapshotModelAnswer(
  "AJI punya OT_HOURS 7 pada Supplier.Name.", sanitizer,
);
ok("jawaban model disanitasi lagi dan label teknis tidak sampai ke user",
  !/AJI|OT_HOURS|Supplier\.Name/.test(safeAnswer)
    && /MITRA_/.test(safeAnswer) && /Ot hours/.test(safeAnswer) && /Supplier name/.test(safeAnswer),
  safeAnswer);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
