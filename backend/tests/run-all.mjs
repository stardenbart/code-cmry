// Runs every *.test.mjs in this folder (including new CIA parser coverage), then reports one combined result.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { summary, results } from "./harness.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();

for (const file of files) {
  console.log(`\n########  ${file}  ########`);
  try {
    await import(`file://${path.join(dir, file).replace(/\\/g, "/")}`);
  } catch (err) {
    // Tanpa penjagaan ini, satu TypeError di satu berkas menghentikan seluruh
    // suite sebelum summary() dipanggil — hasilnya tidak ada laporan sama
    // sekali, yang mudah disalahartikan sebagai "belum sempat jalan".
    results.fail += 1;
    console.log(`  FAIL  ${file} melempar sebelum selesai: ${err?.message || err}`);
  }
}

process.exit(summary() ? 0 : 1);
