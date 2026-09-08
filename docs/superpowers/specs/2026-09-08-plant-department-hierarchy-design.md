# Desain Plant → Department Hierarchy (CODE Website)

Tanggal: 2026-09-08
Status: disetujui pemilik proyek (chat, "Approved, eksekusi sekarang")

## Ringkasan

Menambahkan hierarki **Plant → Department → Dashboard** ke CODE. User di-assign
1–2 plant; dashboard dipetakan ke satu plant + satu department; admin mengelola
plant & department lewat dropdown. Sidebar menjadi pohon Plant ▸ Dept ▸
Dashboard. Perubahan **non-destruktif**: data production tidak ditimpa — seluruh
user & dashboard yang ada di-backfill ke plant **Sentul (1001)**.

## Data model (aditif, tidak menghapus kolom lama)

- `plants(id, name UNIQUE, code UNIQUE, active, timestamps)` — seed Sentul/1001.
- `departments(id, plant_id FK, name, active, UNIQUE(plant_id,name), timestamps)`
  — department milik satu plant.
- `user_plants(user_id FK, plant_id FK, PRIMARY KEY(user_id,plant_id))` — M2M,
  UI membatasi maksimal 2.
- `users` += `cross_plant_access TINYINT(1) NOT NULL DEFAULT 0`.
- `dashboards` += `plant_id INT NULL FK`, `department_id INT NULL FK`
  (nullable di DB agar migrasi aman; wajib diisi lewat aplikasi saat create/edit).
- Kolom lama dipertahankan apa adanya: `users.departemen`, `users.tipe_akses`,
  `dashboards.department`.

FK memakai `ON DELETE CASCADE` untuk `user_plants`/`departments`, dan
`ON DELETE SET NULL` untuk `dashboards.plant_id/department_id`.

## Backfill (idempotent, non-destruktif)

1. Insert Sentul(1001) bila belum ada.
2. Untuk tiap nilai distinct `dashboards.department` → buat `departments` di bawah
   Sentul, lalu set `dashboards.plant_id=Sentul` & `department_id` sesuai. Dept
   kosong → department "Lainnya".
3. Tiap user existing → `user_plants(user, Sentul)`; `cross_plant_access` tetap 0;
   `tipe_akses` tidak diubah.

## Aturan akses (berlapis)

Aturan backend saat ini: **All Access → lihat semua; selain itu → hanya dashboard
yang di-grant eksplisit (`user_dashboard_access`)**. Department BUKAN gate akses,
hanya label + grouping sidebar. Aturan itu dipertahankan, ditambah **plant gate**:

```
visible(D) = (tipe_akses='All Access' OR ada grant eksplisit)
             AND (D.plant_id ∈ plant user  OR user.cross_plant_access = 1)
```

Query "allowed dashboards" dipusatkan (satu helper) dan dipakai ulang oleh: daftar
dashboard, `userCanViewDashboard`, dan CIA `accessScope.loadUserDashboardIds`,
sehingga CIA otomatis menghormati batas plant.

## Backend

- `models/plantModel.js`: CRUD plants & departments, list plants+departments,
  set user plants, allowed-dashboard helper dengan plant gate.
- `routes/plantRoutes.js`: `GET /api/plants` (authenticated; untuk sidebar &
  dropdown), `POST/PUT/DELETE /api/plants` & `/api/departments` (requireAdmin).
  Terdaftar di `routeInventory` (admin-only untuk mutasi).
- Dashboard CRUD menerima `plant_id`+`department_id`.
- User create/edit menerima `plantIds` (1–2) + `crossPlantAccess`.

## Frontend

- `Sidebar.jsx`: pohon collapsible Plant ▸ Department ▸ Dashboard.
- `DashboardManager.jsx`: dropdown Plant + Department dependen.
- `ManageUsers.jsx`: multi-select Plant (maks 2) + toggle lintas-plant.
- `PlantManager.jsx` (admin): CRUD plant & department, dibuka dari area admin.
- `LandingPage.jsx`: "Dashboard CMD Sentul" → "Dashboard CMD".

## Pengujian

Backend: migrasi idempotent (jalan 2×), backfill benar, plant CRUD, plant access
gate (own-plant vs cross-plant), authz admin-only. Frontend: source-contract
(pohon sidebar, dropdown dependen, toggle, rename landing).

## Deploy (production 172.20.240.49)

Backup DB dulu → jalankan migrasi idempotent + backfill → `npm run build` →
restart backend (pm2) → smoke test (login user Sentul, sidebar, dashboard, admin
plant/dept). Rollback = matikan fitur di UI; schema aditif tidak perlu di-drop.

## Definition of done

- Data production tidak berubah selain penambahan mapping plant/dept.
- User hanya melihat dashboard plant-nya kecuali toggle lintas-plant.
- Admin bisa menambah plant & department baru; dashboard & user dipetakan lewat
  dropdown.
- Sidebar hierarkis; landing memakai "Dashboard CMD".
- CIA `accessScope` menghormati plant. Seluruh test & build lulus.
