// ─────────────────────────────────────────────────────────────────────────────
// Sanitasi HTML untuk deskripsi dashboard.
//
// Deskripsi ditulis admin lewat Dashboard Manager dan dirender dengan
// dangerouslySetInnerHTML. Sebelum ini tidak disanitasi sama sekali, sehingga
// satu akun admin yang disalahgunakan bisa menanam <script> yang dijalankan
// di browser setiap user yang membuka halaman departemen itu — termasuk
// membaca token dari localStorage.
//
// Memakai DOMPurify, bukan filter buatan sendiri. Sanitizer tulis-tangan hampir
// selalu bisa ditembus: yang harus ditutup bukan cuma <script>, tapi juga
// atribut on*, javascript: URL, <svg> dengan handler, <iframe>, srcdoc, dan
// entitas yang ter-decode dua kali.
// ─────────────────────────────────────────────────────────────────────────────

import DOMPurify from "dompurify";

// Deskripsi hanyalah teks kaya. Tidak ada alasan mengizinkan tag yang bisa
// mengeksekusi sesuatu atau memuat sumber luar.
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s",
  "p", "br", "span", "div",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "code", "pre", "blockquote",
  "table", "thead", "tbody", "tr", "th", "td",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel", "class", "style"];

/**
 * Mengembalikan HTML yang aman dipasang ke dangerouslySetInnerHTML.
 *
 * @param {string} dirty HTML mentah dari database
 * @returns {string}
 */
export function sanitizeHtml(dirty) {
  if (!dirty) return "";
  return DOMPurify.sanitize(String(dirty), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Tanpa ini, <a href="javascript:..."> lolos.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
    // DOMPurify menerapkan regexp di atas ke `target` juga, bukan hanya ke
    // atribut yang benar-benar berisi URL — akibatnya target="_blank" ikut
    // dibuang dan hook rel="noopener" di bawah tidak pernah menemukannya.
    // Nilai `target` adalah nama frame, tidak bisa dieksekusi.
    ADD_URI_SAFE_ATTR: ["target"],
    // Cegah tag yang di-render menjadi elemen aktif setelah di-parse ulang.
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["srcdoc", "formaction", "xlink:href"],
  });
}

// Setiap tautan keluar dibuka di tab baru tanpa membocorkan window.opener.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
});
