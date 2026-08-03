// Konversi hero image sekali jalan. TIDAK dijalankan saat build — menambah
// langkah build yang bisa gagal demi berkas yang berubah sekali setahun adalah
// pertukaran yang buruk. Hasilnya ikut di-commit.
//
// Jalankan: node scripts/optimize-hero.mjs
import sharp from "sharp";
import fs from "fs";

// Sumber diambil dari images/, BUKAN public/images/. Apa pun di public/ ikut
// disalin verbatim ke dist/ — menaruh sumber 1,7 MB di sana berarti ia
// ter-deploy meski tidak ada satu halaman pun yang memuatnya.
const SRC = "images/home_banner_1.jpeg";

const before = fs.statSync(SRC).size;

await sharp(SRC).webp({ quality: 80 }).toFile("public/images/home_banner_1.webp");
await sharp(SRC).jpeg({ quality: 78, mozjpeg: true }).toFile("public/images/home_banner_1.jpg");

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
console.log(`asal : ${(before / 1024).toFixed(1).padStart(8)} KB  ${SRC}`);
console.log(`webp : ${kb("public/images/home_banner_1.webp").padStart(8)} KB`);
console.log(`jpeg : ${kb("public/images/home_banner_1.jpg").padStart(8)} KB`);
