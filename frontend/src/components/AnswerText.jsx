// ─────────────────────────────────────────────────────────────────────────────
// Perender markdown ringan untuk jawaban CIA.
//
// Dipindah keluar dari AskAIPanel.jsx supaya chat lintas dashboard memakai
// perender yang SAMA, bukan salinan kedua. Sebelumnya ChatMessage.jsx hanya
// memakai whitespace-pre-wrap, jadi jawaban model tampil mentah: user melihat
// `**Ringkasan Temuan**` beserta bintangnya, dan bullet `*` sebagai tanda
// bintang menggantung.
//
// Sengaja bukan react-markdown: yang dipakai model hanya bold, code, heading,
// bullet, dan daftar bernomor. Menambah dependensi untuk lima bentuk itu lebih
// mahal daripada 40 baris ini, dan perender sendiri tidak pernah menyentuh
// dangerouslySetInnerHTML.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";

function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-cimoryBlue">{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={`${keyPrefix}-c${i}`} className="bg-gray-100 rounded px-1 text-[11px] font-mono">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{part}</React.Fragment>;
  });
}

export default function AnswerText({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1" />;

        // Garis pemisah `---` dijadikan garis sungguhan. Tanpa ini, footer
        // sumber data dari formatUnifiedAnswer tampil sebagai tiga tanda hubung.
        if (/^-{3,}$/.test(line.trim())) {
          return <hr key={i} className="my-2 border-gray-200" />;
        }

        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return <p key={i} className="font-semibold text-cimoryBlue mt-1">{renderInline(heading[1], i)}</p>;
        }

        // `**Judul**` sebagai satu baris utuh diperlakukan sebagai heading.
        // Model memakai bentuk ini, bukan `##`, untuk menandai bagian seperti
        // "Ringkasan Temuan" dan "Rekomendasi Tindakan".
        const boldOnly = line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/);
        if (boldOnly) {
          return <p key={i} className="font-semibold text-cimoryBlue mt-1.5">{boldOnly[1]}</p>;
        }

        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-cimoryRed leading-5 shrink-0">•</span>
              <span className="flex-1">{renderInline(bullet[1], i)}</span>
            </div>
          );
        }

        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-cimoryBlue font-semibold shrink-0">{numbered[1]}.</span>
              <span className="flex-1">{renderInline(numbered[2], i)}</span>
            </div>
          );
        }

        return <p key={i}>{renderInline(line, i)}</p>;
      })}
    </div>
  );
}
