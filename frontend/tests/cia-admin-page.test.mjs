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
const access = read("src/components/admin/CiaAccessTab.jsx");
const settings = read("src/components/admin/CiaSettingsTab.jsx");
const manageUsers = read("src/components/ManageUsers.jsx");
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
for (const endpoint of ["overview", "usage", "health", "access", "settings"]) {
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
  "semanticModel", "provider", "aiModel",
]) {
  check(`filter ${name} tersedia`, filters.includes(`name="${name}"`));
}
check("filter diterapkan lewat tombol", />Terapkan</.test(filters));
check("filter dapat diterapkan dengan Enter", /key === "Enter"/.test(filters));
check("reset memakai rentang 30 hari", /defaultDateRange/.test(filters) && /setDate\(today\.getDate\(\) - 29\)/.test(filters));
check("rentang maksimal 366 hari divalidasi", /366/.test(filters));
check("filter disimpan ke URL", /FILTER_KEYS/.test(page) && /next\.set\(key/.test(page));
check("overview menampilkan token input dan output", /Token input/.test(overview) && /Token output/.test(overview));
check("overview menampilkan median latency", /Median/.test(overview));
check("usage mempunyai visual tren native", /<svg/.test(usage) && /<polyline/.test(usage));
check("usage menyediakan tabel fallback", /<table/.test(usage) && /Tanggal/.test(usage));
check("health menampilkan metode retrieval", /Metode retrieval/.test(health));
check("health dapat membuka trace request", /getRequestTrace/.test(health) && /Request ID/.test(health));

console.log("\n=== CIA access and effective settings ===");

check("page merender tab akses khusus", /CiaAccessTab/.test(page));
check("page merender tab settings khusus", /CiaSettingsTab/.test(page));
check("access menyediakan pencarian user", /Cari user/.test(access));
check("access menyediakan filter departemen", /Semua departemen/.test(access));
check("access menampilkan status approved", /Approved/.test(access));
check("access memakai dialog konfirmasi bersama", /useConfirm/.test(access));
check("access mengirim update melalui API khusus", /updateAccess/.test(access));
check("access melakukan rollback optimistik", /previousUsers/.test(access) && /setUsers\(previousUsers\)/.test(access));
check("access memakai bulk API atomik", /updateAccessBulk/.test(access));
check("access melakukan pencarian server-side", /getAccess\(\{[\s\S]*q:/.test(access));
check("access menyediakan pagination", /Sebelumnya/.test(access) && /Berikutnya/.test(access));
check("settings memuat konfigurasi efektif", /getSettings/.test(page));
check("feature flag menyembunyikan tab analytics", /analyticsEnabled/.test(page) && /availableTabs/.test(page));
check("settings menampilkan telemetry flag", /CIA_TELEMETRY_ENABLED/.test(settings));
check("settings menampilkan analytics flag", /CIA_ADMIN_ANALYTICS_ENABLED/.test(settings));
check("settings menampilkan timezone", /Asia\/Jakarta/.test(settings));
check("settings dapat membuka pengaturan provider", /Pengaturan provider/.test(settings));
check("Manage Users tidak lagi mengubah akses CIA", !/ciaAccess|cia_access|Boleh memakai CIA/.test(manageUsers));
check("App mendukung deep-link pengaturan provider", /open=cia-settings/.test(app));

console.log(failed === 0 ? "\nSemua lulus" : `\n${failed} gagal`);
process.exit(failed === 0 ? 0 : 1);
