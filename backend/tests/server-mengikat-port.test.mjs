// Backend harus mengikat port meski BUKAN dijalankan sebagai entry point Node.
//
// Ini menutup satu kegagalan produksi yang tidak tertangkap test mana pun:
// server.js dulu menebak "apakah aku dijalankan langsung" dengan membandingkan
// import.meta.url terhadap process.argv[1], dan bawaannya JANGAN listen kalau
// tidak cocok. pm2 mode fork menjalankan pembungkusnya sendiri
// (ProcessContainerFork.js) yang meng-import berkas ini, jadi argv[1] berisi
// path pm2, perbandingannya gagal, dan app.listen() tidak pernah terpanggil di
// produksi.
//
// Gejalanya menipu: pm2 melaporkan "online", uptime jalan normal, log mencetak
// "MySQL pool siap", tidak ada galat sama sekali. Yang hilang cuma satu baris
// log dan satu port yang terikat.
//
// Karena itu test ini meniru cara pm2 memanggilnya: sebuah pembungkus yang
// meng-import server.js, dijalankan sebagai proses terpisah, lalu port yang
// diikatnya benar-benar dihubungi lewat HTTP.
import { ok, section } from "./harness.mjs";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";

const AKAR_BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5098; // bukan 5050: jangan bentrok dengan backend yang sedang melayani

section("server.js mengikat port saat di-import pembungkus (seperti pm2 fork)");

// Pembungkus yang meniru ProcessContainerFork.js pm2: berkas LAIN yang menjadi
// entry point, lalu meng-import server.js. Justru inilah yang membuat argv[1]
// tidak sama dengan url modul server.js.
const dirSementara = mkdtempSync(join(tmpdir(), "cod-listen-"));
const pembungkus = join(dirSementara, "pembungkus-pm2.mjs");
// pathToFileURL, bukan path apa adanya: import() dinamis menolak path Windows
// absolut ("Received protocol 'c:'") karena membacanya sebagai skema URL.
writeFileSync(
  pembungkus,
  `await import(${JSON.stringify(pathToFileURL(join(AKAR_BACKEND, "src", "server.js")).href)});\n`
);

// SKIP_SERVER_LISTEN dibuang eksplisit, bukan sekadar tidak disetel.
// run-all.mjs meng-import seluruh berkas test ke dalam SATU proses, dan test
// lain yang berjalan lebih dulu secara abjad (authz-inventory, health-endpoint)
// menyetelnya "true" pada process.env yang sama. Tanpa baris ini, anak proses
// mewarisinya lewat spread di bawah dan test ini gagal palsu — justru gagal
// dengan gejala yang sama seperti bug yang diperiksanya.
const envAnak = { ...process.env, PORT: String(PORT) };
delete envAnak.SKIP_SERVER_LISTEN;

const anak = spawn(process.execPath, [pembungkus], {
  cwd: AKAR_BACKEND,
  env: envAnak,
  stdio: ["ignore", "pipe", "pipe"],
});

let keluaran = "";
anak.stdout.on("data", (d) => (keluaran += d));
anak.stderr.on("data", (d) => (keluaran += d));

// Tunggu portnya benar-benar menjawab, bukan sekadar tunggu waktu tetap.
// Batasnya 20 detik karena startup memuat pool MySQL lebih dulu.
let menjawab = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (r.status === 200) { menjawab = true; break; }
  } catch { /* belum siap, coba lagi */ }
  await new Promise((r) => setTimeout(r, 500));
}

ok(
  "port terikat dan /health menjawab 200",
  menjawab,
  `tidak menjawab dalam 20 detik. Keluaran proses:\n${keluaran.slice(-800)}`
);
ok(
  "mencetak 'Server running'",
  /Server running on port/.test(keluaran),
  `log tidak memuat baris itu:\n${keluaran.slice(-400)}`
);

section("SKIP_SERVER_LISTEN=true membuatnya TIDAK mengikat");

// Sifat sebaliknya juga dijaga, karena dua test lain meng-import `app` untuk
// membaca tabel rute dan tidak boleh ikut mengikat port.
const anakDiam = spawn(process.execPath, [pembungkus], {
  cwd: AKAR_BACKEND,
  env: { ...process.env, PORT: String(PORT + 1), SKIP_SERVER_LISTEN: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});
let keluaranDiam = "";
anakDiam.stdout.on("data", (d) => (keluaranDiam += d));
await new Promise((r) => setTimeout(r, 6000));

let terikat = false;
try {
  const r = await fetch(`http://127.0.0.1:${PORT + 1}/health`);
  terikat = r.status === 200;
} catch { /* memang diharapkan gagal */ }

ok("port TIDAK terikat", !terikat, `port ${PORT + 1} justru menjawab`);
ok(
  "tidak mencetak 'Server running'",
  !/Server running on port/.test(keluaranDiam),
  keluaranDiam.slice(-300)
);

anak.kill();
anakDiam.kill();
try { unlinkSync(pembungkus); } catch { /* sudah hilang */ }
