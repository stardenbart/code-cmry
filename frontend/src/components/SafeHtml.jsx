// ─────────────────────────────────────────────────────────────────────────────
// Merender HTML tepercaya-setelah-disanitasi.
//
// Komponen terpisah supaya DOMPurify (~30 KB) bisa di-lazy-import. Kalau
// sanitizeHtml diimpor langsung dari App.jsx, DOMPurify masuk chunk utama dan
// ikut diunduh halaman login — padahal satu-satunya yang butuh disanitasi
// adalah deskripsi dashboard, yang hanya muncul setelah login.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitizeHtml } from "../utils/sanitizeHtml";

export default function SafeHtml({ html, className }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
