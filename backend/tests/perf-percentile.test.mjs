import { ok, section } from "./harness.mjs";
import { percentile } from "../src/routes/perfRoutes.js";

// Nilai persis diuji di sini, bukan lewat GET /api/perf/summary. Endpoint itu
// merangkum seluruh tabel, yang berisi data pemakaian nyata — menuntut angka
// persis di sana berarti test hanya lulus pada database kosong.

section("percentile() metode nearest-rank");

const lima = [100, 200, 300, 400, 900];

// ceil(0.5 * 5) = 3 -> nilai ke-3 = 300
ok("p50 dari 5 nilai", percentile(lima, 50) === 300, `dapat ${percentile(lima, 50)}`);
// ceil(0.95 * 5) = 5 -> nilai ke-5 = 900
ok("p95 dari 5 nilai", percentile(lima, 95) === 900, `dapat ${percentile(lima, 95)}`);
ok("p100 adalah nilai terbesar", percentile(lima, 100) === 900, `dapat ${percentile(lima, 100)}`);
ok("p1 adalah nilai terkecil", percentile(lima, 1) === 100, `dapat ${percentile(lima, 1)}`);

section("Kasus tepi");

ok("daftar kosong mengembalikan null", percentile([], 50) === null, `dapat ${percentile([], 50)}`);
ok("satu nilai", percentile([42], 50) === 42, `dapat ${percentile([42], 50)}`);
ok("satu nilai, p95", percentile([42], 95) === 42, `dapat ${percentile([42], 95)}`);

// Indeks tidak boleh melewati ujung array walau p = 100 dan panjang genap.
const empat = [10, 20, 30, 40];
ok("p100 pada panjang genap tidak keluar batas",
  percentile(empat, 100) === 40, `dapat ${percentile(empat, 100)}`);
ok("p50 pada panjang genap", percentile(empat, 50) === 20, `dapat ${percentile(empat, 50)}`);

section("p95 tidak pernah lebih kecil dari p50");

// Sifat ini yang dipakai UI admin; pelanggarannya berarti ada salah indeks.
let pelanggaran = 0;
for (let n = 1; n <= 60; n += 1) {
  const arr = Array.from({ length: n }, (_, i) => i * 7);
  if (percentile(arr, 95) < percentile(arr, 50)) pelanggaran += 1;
}
ok("berlaku untuk panjang 1..60", pelanggaran === 0, `${pelanggaran} pelanggaran`);

section("Nilai nol dibedakan dari data kosong");

// tokenMs = 0 adalah hasil pengukuran yang sah (jalur iframe tidak memakai
// token), jadi tidak boleh diperlakukan seperti "tidak ada data".
ok("p50 dari semua nol adalah 0, bukan null",
  percentile([0, 0, 0], 50) === 0, `dapat ${percentile([0, 0, 0], 50)}`);
