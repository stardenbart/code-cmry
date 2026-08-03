// ─────────────────────────────────────────────────────────────────────────────
// Pengganti window.confirm() yang bisa distyle dan bisa diuji.
//
// Mengembalikan promise supaya kode pemanggil tetap sesederhana bentuk aslinya:
//   if (!(await confirm({ ... }))) return;
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm dipakai di luar ConfirmProvider");
  return ctx;
}

export default function ConfirmProvider({ children }) {
  const [permintaan, setPermintaan] = useState(null);
  const penyelesai = useRef(null);
  const tombolAmanRef = useRef(null);
  const dialogRef = useRef(null);

  const confirm = useCallback((opsi) => {
    return new Promise((resolve) => {
      penyelesai.current = resolve;
      setPermintaan({
        judul: opsi?.judul || "Konfirmasi",
        pesan: opsi?.pesan || "",
        labelKonfirmasi: opsi?.labelKonfirmasi || "Lanjutkan",
        destruktif: Boolean(opsi?.destruktif),
      });
    });
  }, []);

  const jawab = useCallback((nilai) => {
    setPermintaan(null);
    const resolve = penyelesai.current;
    penyelesai.current = null;
    if (resolve) resolve(nilai);
  }, []);

  // Esc membatalkan. Fokus awal jatuh ke tombol AMAN, bukan tombol hapus:
  // menekan Enter secara refleks tidak boleh menghapus apa pun.
  //
  // Tab juga diperangkap di dalam modal. Tanpa itu fokus bisa berpindah ke
  // halaman di belakang, sehingga pemakai keyboard bisa menekan tombol yang
  // tertutup lapisan gelap dan tidak ia lihat.
  useEffect(() => {
    if (!permintaan) return;
    tombolAmanRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); jawab(false); return; }
      if (e.key !== "Tab") return;

      const fokusable = dialogRef.current?.querySelectorAll("button");
      if (!fokusable || fokusable.length === 0) return;
      const pertama = fokusable[0];
      const terakhir = fokusable[fokusable.length - 1];

      if (e.shiftKey && document.activeElement === pertama) {
        e.preventDefault();
        terakhir.focus();
      } else if (!e.shiftKey && document.activeElement === terakhir) {
        e.preventDefault();
        pertama.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [permintaan, jawab]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {permintaan && (
        <div
          className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center px-4 animate-fade-in motion-reduce:animate-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="konfirmasi-judul"
        >
          <div ref={dialogRef} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={22}
                className={permintaan.destruktif ? "text-cimoryRed shrink-0 mt-0.5" : "text-cimoryBlue shrink-0 mt-0.5"}
              />
              <div className="flex-1">
                <h2 id="konfirmasi-judul" className="text-base font-semibold text-cimoryBlue">
                  {permintaan.judul}
                </h2>
                {permintaan.pesan && (
                  <p className="text-sm text-gray-700 mt-1.5">{permintaan.pesan}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                ref={tombolAmanRef}
                onClick={() => jawab(false)}
                className="px-4 py-2 rounded-lg border hover:bg-gray-100 transition text-sm"
              >
                Batal
              </button>
              <button
                onClick={() => jawab(true)}
                className={`px-4 py-2 rounded-lg text-white transition text-sm ${
                  permintaan.destruktif
                    ? "bg-cimoryRed hover:bg-red-700"
                    : "bg-cimoryBlue hover:bg-blue-800"
                }`}
              >
                {permintaan.labelKonfirmasi}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
