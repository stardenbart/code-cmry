// Source contract untuk KPI Library di Admin CIA (Fase 2).
import fs from "fs";

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const api = read("src/services/ciaAdminApi.js");
const page = read("src/components/admin/CiaAdminPage.jsx");
const tab = read("src/components/admin/CiaKpiLibraryTab.jsx");
const editor = read("src/components/admin/CiaKpiEditor.jsx");
let failed = 0;
const check = (name, cond) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failed += 1; };

console.log("\n=== API client KPI ===");
check("base memakai /kpis", api.includes("${BASE}/kpis"));
for (const fn of [
  "listKpis", "getKpiDetail", "createKpi", "updateKpi", "confirmKpi",
  "getKpiRevisions", "restoreKpiRevision", "startKpiSync", "getKpiSyncStatus",
]) check(`client punya ${fn}`, new RegExp(`export async function ${fn}\\b`).test(api));
check("restore memakai path revisions/.../restore", /revisions\/\$\{encodeURIComponent\(revisionId\)\}\/restore/.test(api));

console.log("\n=== Admin page tab KPI ===");
check("TABS punya id kpi", /id:\s*"kpi"/.test(page));
check("label KPI Library", /KPI Library/.test(page));
check("page merender CiaKpiLibraryTab", /CiaKpiLibraryTab/.test(page));
check("tab kpi selalu tersedia (analytics off)", /ALWAYS_TABS/.test(page) && /"kpi"/.test(page));

console.log("\n=== KPI Library tab ===");
for (const name of ["q", "domain", "status", "dashboardId"]) {
  check(`filter ${name} tersedia`, tab.includes(`name="${name}"`));
}
check("filter diterapkan lewat tombol Terapkan", />Terapkan</.test(tab));
check("human name sebagai teks utama", /font-medium text-slate-900/.test(tab));
check("measure teknis sebagai teks sekunder monospace", /font-mono/.test(tab) && /measureSummary/.test(tab));
check("status badge dirender", /StatusBadge/.test(tab));
check("deep-link kpiId", /kpiId/.test(tab) && /useSearchParams/.test(tab));
check("membuka editor detail", /CiaKpiEditor/.test(tab));

console.log("\n=== KPI editor ===");
check("reason wajib divalidasi", /reason\.trim\(\)/.test(editor) && /wajib/i.test(editor));
check("save mengirim reason + expectedVersion", /updateKpi/.test(editor) && /expectedVersion/.test(editor));
check("konflik versi (409) memunculkan pesan reload", /409/.test(editor) && /[Mm]uat ulang/.test(editor));
check("confirm memakai dialog konfirmasi bersama", /useConfirm/.test(editor) && /confirmKpi/.test(editor));
check("riwayat revisi tersedia", /getKpiRevisions/.test(editor));
check("restore memanggil API restore", /restoreKpiRevision/.test(editor));
check("restore membuat versi baru (bukan mundur)", /versi baru/i.test(editor));
check("binding teknis read-only monospace", /read-only/i.test(editor) && /font-mono/.test(editor));

console.log(failed === 0 ? "\nSemua lulus" : `\n${failed} gagal`);
process.exit(failed === 0 ? 0 : 1);
