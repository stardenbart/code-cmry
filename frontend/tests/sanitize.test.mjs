// Uji sanitasi HTML deskripsi dashboard.
//
// Jalankan: npm run test:sanitize
//
// Bukan uji browser: DOMPurify berjalan di atas jsdom di sini, sehingga uji ini
// bisa diulang di CI tanpa menyalakan dev server. Percobaan pertama memakai
// halaman probe di browser dan justru mengeksekusi serangannya sendiri —
// menulis penutup tag script apa adanya di dalam blok script inline memutus
// tag itu, dan sisa berkas ikut di-parse sebagai HTML.

import { JSDOM } from "jsdom";

// DOMPurify butuh window; sediakan sebelum modul yang diuji dimuat.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.DocumentFragment = dom.window.DocumentFragment;

const { sanitizeHtml } = await import("../src/utils/sanitizeHtml.js");

// Dirakit dari potongan agar berkas ini tetap aman dibaca alat lain.
const S = "<scr" + "ipt>";
const SE = "</scr" + "ipt>";

const BERBAHAYA =
  /<scr|onerror|onclick|onbegin|onload|javascript:|<iframe|srcdoc|<form|<input|<style|<object|<embed/i;

const kasus = [
  // [masukan, nama, harusLolos]
  [S + "alert(1)" + SE, "script langsung", false],
  ['<img src=x onerror="alert(1)">', "atribut onerror", false],
  ['<a href="javascript:alert(1)">klik</a>', "javascript: URL", false],
  ["<svg>" + S + "alert(1)" + SE + "</svg>", "script dalam svg", false],
  ['<svg><animate onbegin="alert(1)" attributeName="x"/></svg>', "svg onbegin", false],
  ['<iframe src="https://evil.example"></iframe>', "iframe", false],
  ['<iframe srcdoc="' + S + "alert(1)" + SE + '"></iframe>', "iframe srcdoc", false],
  ['<div onclick="alert(1)">teks</div>', "atribut onclick", false],
  ['<form action="/x"><input name=p></form>', "form + input", false],
  ["<style>body{display:none}</style>", "tag style", false],
  ['<a href="&#106;avascript:alert(1)">x</a>', "javascript: ter-encode", false],
  ['<object data="data:text/html,x"></object>', "object data:", false],
  ['<body onload="alert(1)">', "body onload", false],
  ['<a href="/aman" target="_blank">tautan</a>', "tautan sah", true],
  ["<b>tebal</b> <ul><li>daftar</li></ul>", "teks kaya sah", true],
  ['<p style="color:red">warna</p>', "style inline sah", true],
  ["<h3>Judul</h3><p>Isi deskripsi dashboard.</p>", "deskripsi khas", true],
];

let lulus = 0;
let gagal = 0;

for (const [kotor, nama, harusLolos] of kasus) {
  const bersih = sanitizeHtml(kotor);
  const adaBahaya = BERBAHAYA.test(bersih);
  const kosong = bersih.trim().length === 0;

  let ok;
  let alasan;
  if (harusLolos) {
    ok = !kosong && !adaBahaya;
    alasan = kosong ? "konten sah malah dibuang" : adaBahaya ? "bahaya lolos" : "";
  } else {
    ok = !adaBahaya;
    alasan = adaBahaya ? "SERANGAN BOCOR" : "";
  }

  if (ok) {
    lulus += 1;
    console.log(`  PASS  ${nama} -> ${bersih || "(kosong)"}`);
  } else {
    gagal += 1;
    console.log(`  FAIL  ${nama} (${alasan}) -> ${bersih}`);
  }
}

// Tautan target=_blank wajib mendapat rel noopener; tanpa itu halaman tujuan
// bisa menyentuh window.opener.
const tautan = sanitizeHtml('<a href="/x" target="_blank">y</a>');
if (/rel="[^"]*noopener/.test(tautan)) {
  lulus += 1;
  console.log(`  PASS  target=_blank mendapat rel noopener -> ${tautan}`);
} else {
  gagal += 1;
  console.log(`  FAIL  target=_blank tanpa rel noopener -> ${tautan}`);
}

console.log(`\n──────── ${lulus} passed, ${gagal} failed ────────\n`);
process.exit(gagal === 0 ? 0 : 1);
