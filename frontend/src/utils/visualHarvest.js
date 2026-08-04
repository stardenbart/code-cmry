// ─────────────────────────────────────────────────────────────────────────────
// Memanen nama field yang benar-benar tampil di setiap visual sebuah report.
//
// Sengaja TIDAK memakai captureReportSnapshot(): fungsi itu menarik ratusan
// baris data per visual karena memang untuk menjawab pertanyaan. Panen ini hanya
// butuh nama kolomnya, jadi maxRows = 1. Bedanya bukan kosmetik: 44 report
// dengan ratusan baris per visual akan memakan waktu sangat lama dan membebani
// Power BI tanpa satu pun barisnya dipakai.
// ─────────────────────────────────────────────────────────────────────────────

import { models } from "powerbi-client";
import { parseCSV } from "./powerbiData.js";

/**
 * Visual yang tidak membawa data analitis.
 *
 * "card" sengaja TIDAK masuk daftar ini, walau ukurannya kecil: justru kartu
 * yang paling sering memuat KPI utama seperti OEE atau total output, dan itu
 * tepat yang dicari panen ini.
 */
const LEWATI = new Set([
  "slicer", "textbox", "image", "shape", "actionButton", "basicShape",
]);

async function aman(fn, jatuhan = null) {
  try {
    return await fn();
  } catch {
    return jatuhan;
  }
}

/**
 * Memanen inventaris field satu report yang sudah ter-embed.
 *
 * Power BI menolak exportData untuk halaman yang belum pernah dirender, jadi
 * setiap halaman diaktifkan lebih dulu. Ini bukan kehati-hatian berlebihan:
 * tanpa mengaktifkan halaman, hanya halaman pertama yang menghasilkan field dan
 * inventarisnya akan terlihat lengkap padahal kosong untuk halaman lain.
 *
 * @param {object} report            Objek report dari powerbi-client.
 * @param {(pesan: string) => void} [lapor]  Callback kemajuan, opsional.
 * @returns {Promise<Array<{pageName: string, visualTitle: string, visualType: string, fields: string[], error?: string}>>}
 */
export async function panenFieldReport(report, lapor = () => {}) {
  const pages = (await aman(() => report.getPages(), [])) || [];
  const hasil = [];

  // Halaman aktif semula dipulihkan di akhir supaya panen tidak meninggalkan
  // report pada halaman yang bukan halaman awalnya.
  const semula = pages.find((p) => p.isActive);

  for (const page of pages) {
    const pageName = page.displayName || page.name;

    if (!page.isActive) {
      await aman(() => page.setActive());
      // Jeda pendek: setActive() selesai sebelum visualnya benar-benar dirender,
      // dan exportData pada visual yang belum dirender mengembalikan kosong.
      await new Promise((r) => setTimeout(r, 1200));
    }

    const visuals = (await aman(() => page.getVisuals(), [])) || [];
    lapor(`${pageName}: ${visuals.length} visual`);

    for (const visual of visuals) {
      if (LEWATI.has(visual.type)) continue;

      const dasar = {
        pageName,
        visualTitle: visual.title || visual.name || "",
        visualType: visual.type || "",
      };

      try {
        const hasilExport = await visual.exportData(models.ExportDataType.Summarized, 1);
        const { columns } = parseCSV(hasilExport?.data);
        if (columns.length) hasil.push({ ...dasar, fields: columns });
      } catch (err) {
        // Visual yang menolak export dicatat dengan alasannya, bukan dibuang.
        // Kalau nanti sebuah KPI tidak ketemu di inventaris, catatan ini yang
        // menjelaskan apakah visualnya memang tidak ada atau exportnya ditolak.
        hasil.push({
          ...dasar,
          fields: [],
          error: err?.message || err?.detailedMessage || "export ditolak",
        });
      }
    }
  }

  if (semula && !semula.isActive) await aman(() => semula.setActive());
  return hasil;
}
