// Daftar dashboard di chat CIA harus bisa dilipat, dan melipatnya tidak boleh
// menghapus pilihan yang sudah dicentang.
//
// Diperiksa di tingkat sumber, bukan render, karena yang menjaga kedua sifat itu
// adalah pilihan elemennya: <details>/<summary> menyembunyikan isinya lewat CSS
// dan tetap menyimpannya di DOM. Kalau suatu saat ini diganti render bersyarat
// (`{terbuka && ...}`), centangnya ikut hilang saat dilipat. Uji ini gagal tepat
// pada perubahan itu.
import fs from "fs";

const BERKAS = "src/components/UnifiedChatPanel.jsx";
const isi = fs.readFileSync(BERKAS, "utf8");
let gagal = 0;

function periksa(nama, benar) {
  console.log(`  ${benar ? "PASS" : "FAIL"}  ${nama}`);
  if (!benar) gagal += 1;
}

console.log("\n=== Daftar dashboard bisa dilipat ===");

periksa("memakai <details> untuk melipat", /<details\b/.test(isi));
periksa("punya <summary> sebagai pemicunya", /<summary\b/.test(isi));

// Ringkasan yang tetap terlihat saat terlipat: jumlah terpilih dan penanda muat.
const ringkasan = isi.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
periksa("jumlah terpilih terlihat saat terlipat", /terpilih/.test(ringkasan));
periksa("penanda memuat data terlihat saat terlipat", /sedangMemuat/.test(ringkasan));

// Kotak centang harus berada DI DALAM <details>, bukan di render bersyarat.
const badan = isi.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
periksa("kotak centang ada di dalam <details>", /type="checkbox"/.test(badan));
periksa(
  "isi daftar tidak dirender bersyarat oleh state buka-tutup",
  !/\{\s*(terbuka|isOpen|dibuka|tampil)\s*&&/.test(isi)
);

console.log(gagal === 0 ? "\nSemua lulus" : `\n${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
