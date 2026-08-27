// Source contract for the dedicated Admin CIA control plane.
import fs from "fs";

const read = (path) => fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const app = read("src/App.jsx");
const header = read("src/components/header.jsx");
const api = read("src/services/ciaAdminApi.js");
const page = read("src/components/admin/CiaAdminPage.jsx");
const filters = read("src/components/admin/CiaAnalyticsFilters.jsx");
const overview = read("src/components/admin/CiaOverviewTab.jsx");
const usage = read("src/components/admin/CiaUsageTab.jsx");
const health = read("src/components/admin/CiaHealthTab.jsx");
let failed = 0;

function check(name, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

console.log("\n=== Dedicated Admin CIA route and shell ===");

check("CiaAdminPage dibuat sebagai lazy chunk",
  /lazy\(\(\)\s*=>\s*import\("\.\/components\/admin\/CiaAdminPage"\)\)/.test(app));
check("route /admin/cia terdaftar", /path="\/admin\/cia"/.test(app));
check("route memakai guard role admin",
  /path="\/admin\/cia"[\s\S]{0,500}isAdmin\(user\)/.test(app));
check("header desktop membuka Admin CIA",
  /navigate\("\/admin\/cia"\)[\s\S]{0,160}tooltip="Admin CIA"/.test(header));
check("header mobile membuka Admin CIA",
  /navigate\("\/admin\/cia"\)[\s\S]{0,160}label="Admin CIA"/.test(header));

console.log("\n=== Authenticated API client ===");

check("client memakai shared authenticated API", /import API from "\.\.\/api\/api\.js"/.test(api));
check("client memakai base Admin CIA", /const BASE = "\/api\/admin\/cia"/.test(api));
for (const endpoint of ["overview", "usage", "health", "access"]) {
  check(`client memanggil endpoint ${endpoint}`, api.includes(`\${BASE}/${endpoint}`));
}
check("access update mengirim boolean enabled eksplisit",
  /enabled:\s*Boolean\(enabled\)/.test(api));

console.log("\n=== Tab shell tersimpan di URL ===");

check("page memakai useSearchParams", /useSearchParams/.test(page));
for (const tab of ["overview", "usage", "health", "access", "settings"]) {
  check(`tab ${tab} tersedia`, page.includes(`id: "${tab}"`));
}
check("tab default overview", /get\("tab"\)\s*\|\|\s*"overview"/.test(page));
check("error ditampilkan dalam bahasa Indonesia", /Gagal memuat Admin CIA/.test(page));
check("tersedia tombol coba lagi", /Coba lagi/.test(page));

console.log("\n=== Analytics filters and accessible views ===");

for (const name of [
  "from", "to", "userId", "department", "dashboardId", "surface", "status", "retrievalMethod",
]) {
  check(`filter ${name} tersedia`, filters.includes(`name="${name}"`));
}
check("filter diterapkan lewat tombol", />Terapkan</.test(filters));
check("filter dapat diterapkan dengan Enter", /key === "Enter"/.test(filters));
check("reset memakai rentang 30 hari", /defaultDateRange/.test(filters) && /setDate\(today\.getDate\(\) - 29\)/.test(filters));
check("rentang maksimal 366 hari divalidasi", /366/.test(filters));
check("filter disimpan ke URL", /FILTER_KEYS/.test(page) && /next\.set\(key/.test(page));
check("overview menampilkan token input dan output", /Token input/.test(overview) && /Token output/.test(overview));
check("usage mempunyai visual tren native", /<svg/.test(usage) && /<polyline/.test(usage));
check("usage menyediakan tabel fallback", /<table/.test(usage) && /Tanggal/.test(usage));
check("health menampilkan metode retrieval", /Metode retrieval/.test(health));
check("health dapat membuka trace request", /getRequestTrace/.test(health) && /Request ID/.test(health));

console.log(failed === 0 ? "\nSemua lulus" : `\n${failed} gagal`);
process.exit(failed === 0 ? 0 : 1);
