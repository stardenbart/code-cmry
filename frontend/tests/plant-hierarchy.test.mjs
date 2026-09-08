// Source-contract untuk hierarki Plant ▸ Department ▸ Dashboard di frontend.
import fs from "fs";
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const app = read("src/App.jsx");
const sidebar = read("src/components/Sidebar.jsx");
const dashMgr = read("src/components/DashboardManager.jsx");
const manageUsers = read("src/components/ManageUsers.jsx");
const plantMgr = read("src/components/PlantManager.jsx");
const header = read("src/components/header.jsx");
const landing = read("src/components/LandingPage.jsx");
let failed = 0;
const check = (name, cond) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failed += 1; };

console.log("\n=== App wiring ===");
check("App fetch /api/plants", /API\.get\("\/api\/plants"\)/.test(app) && /setPlants/.test(app));
check("App simpan dashboards flat", /dashboardsFlat/.test(app));
check("App kirim plants+flat ke Sidebar", /plants=\{plants\}/.test(app) && /dashboardsFlat=\{dashboardsFlat\}/.test(app));

console.log("\n=== Sidebar hierarchy ===");
check("Sidebar terima plants & dashboardsFlat", /plants = \[\]/.test(sidebar) && /dashboardsFlat = \[\]/.test(sidebar));
check("filter plant per akses user (cross_plant / user.plants)",
  /cross_plant_access/.test(sidebar) && /userPlantIds/.test(sidebar));
check("group dashboard per plant_id:department_id", /plant_id.*department_id|`\$\{d\.plant_id\}:\$\{d\.department_id\}`/.test(sidebar));
check("dua tingkat collapsible (plant & dept)", /expandedPlant/.test(sidebar) && /expandedDept/.test(sidebar));

console.log("\n=== Dashboard Manager dropdowns ===");
check("plantDeptFields ada", /plantDeptFields/.test(dashMgr));
check("ambil plants", /API\.get\("\/api\/plants"\)/.test(dashMgr));
check("dropdown plant & department dependen (department_id di-reset saat plant berubah)",
  /department_id: ""/.test(dashMgr) && /Pilih Plant/.test(dashMgr) && /Pilih Department/.test(dashMgr));

console.log("\n=== Manage Users plant + cross-plant ===");
check("form punya plantIds & crossPlantAccess", /plantIds/.test(manageUsers) && /crossPlantAccess/.test(manageUsers));
check("batasi maksimal 2 plant", /slice\(0, 2\)/.test(manageUsers));
check("toggle lintas plant", /Akses lintas plant/.test(manageUsers));

console.log("\n=== Plant Manager (admin) ===");
check("PlantManager CRUD via /api/plants", /API\.post\("\/api\/plants"/.test(plantMgr) && /departments/.test(plantMgr));
check("header membuka Plant Manager", /onPlantManagerClick/.test(header) && /Kelola Plant/.test(header));
check("App merender PlantManager", /PlantManager/.test(app) && /showPlantManager/.test(app));

console.log("\n=== Landing rename ===");
check("landing memakai 'Dashboard CMD'", /Dashboard CMD(?!\s*Sentul)/.test(landing));
check("landing tidak lagi 'Dashboard CMD Sentul'", !/Dashboard CMD Sentul/.test(landing));

console.log("\n=== Add User & Register: plant + dependent department ===");
const addUser = read("src/components/AddUserModal.jsx");
const register = read("src/components/Register.jsx");
check("AddUser ambil plants", /API\.get\("\/api\/plants"\)/.test(addUser));
check("AddUser punya dropdown plant + department dependen",
  /key === "plant"/.test(addUser) && /plantDepartments/.test(addUser));
check("AddUser kirim plantIds", /plantIds:/.test(addUser));
check("Register ambil plants", /API\.get\("\/api\/plants"\)/.test(register));
check("Register punya plant select + departemen dependen",
  /name="plantId"/.test(register) && /selectedPlant/.test(register) && /disabled=\{!form\.plantId\}/.test(register));

console.log("\n=== Header rapi + label CMD Plant ===");
check("header memakai 'CMD Plant' (bukan Sentul)", /CMD Plant<\/p>/.test(header) && !/CMD Plant Sentul/.test(header));
check("header memisah ikon dengan divider", /border-l border-white\/25/.test(header));

console.log("\n=== Sidebar hide/unhide (desktop) ===");
check("Sidebar terima collapsed + onToggleCollapse", /collapsed = false/.test(sidebar) && /onToggleCollapse/.test(sidebar));
check("aside desktop tersembunyi saat collapsed", /collapsed \? "hidden" : "hidden lg:flex"/.test(sidebar));
check("ada tombol collapse & expand", /PanelLeftClose/.test(sidebar) && /PanelLeftOpen/.test(sidebar));
check("App menyimpan state collapse", /sidebarCollapsed/.test(app) && /localStorage/.test(app));

console.log(failed === 0 ? "\nSemua lulus" : `\n${failed} gagal`);
process.exit(failed === 0 ? 0 : 1);
