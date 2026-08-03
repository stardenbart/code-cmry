// ─────────────────────────────────────────────────────────────────────────────
// Umpan balik yang tidak memblokir, pengganti alert().
//
// Dibuat sendiri, bukan memakai library. Bundle halaman login baru diturunkan
// dari 816 KB ke 242,8 KB; menambah dependensi untuk komponen sekecil ini akan
// membatalkan sebagian usaha itu. Buatan sendiri juga memakai warna Cimory
// langsung tanpa menimpa gaya bawaan library.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const MAKS_TAMPIL = 4;      // lebih dari ini menutupi layar
const DURASI_BAWAAN = 4000;
const DURASI_ERROR = 7000;  // pesan gagal perlu waktu untuk dibaca

const GAYA = {
  success: { Ikon: CheckCircle2,  kelas: "border-l-4 border-green-600",  warnaIkon: "text-green-600" },
  error:   { Ikon: XCircle,       kelas: "border-l-4 border-cimoryRed",  warnaIkon: "text-cimoryRed" },
  warning: { Ikon: AlertTriangle, kelas: "border-l-4 border-amber-500",  warnaIkon: "text-amber-500" },
  info:    { Ikon: Info,          kelas: "border-l-4 border-cimoryBlue", warnaIkon: "text-cimoryBlue" },
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast dipakai di luar ToastProvider");
  return ctx;
}

export default function ToastProvider({ children }) {
  const [daftar, setDaftar] = useState([]);
  const berikutnya = useRef(1);

  const tutup = useCallback((id) => {
    setDaftar((sebelum) => sebelum.filter((t) => t.id !== id));
  }, []);

  const tambah = useCallback((jenis, pesan, opsi = {}) => {
    if (!pesan) return;
    const id = berikutnya.current;
    berikutnya.current += 1;

    const durasiMs = opsi.durasiMs ?? (jenis === "error" ? DURASI_ERROR : DURASI_BAWAAN);

    setDaftar((sebelum) => {
      // Yang tertua digeser keluar supaya tumpukan tidak menutupi layar.
      const dipangkas = sebelum.slice(-(MAKS_TAMPIL - 1));
      return [...dipangkas, { id, jenis, pesan: String(pesan) }];
    });

    setTimeout(() => tutup(id), durasiMs);
  }, [tutup]);

  const api = useMemo(() => ({
    success: (pesan, opsi) => tambah("success", pesan, opsi),
    error:   (pesan, opsi) => tambah("error", pesan, opsi),
    warning: (pesan, opsi) => tambah("warning", pesan, opsi),
    info:    (pesan, opsi) => tambah("info", pesan, opsi),
  }), [tambah]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Di bawah header, di atas segalanya. pointer-events-none pada wadah
          supaya area kosongnya tidak menghalangi klik ke halaman. */}
      <div
        className="fixed top-20 right-4 z-[100] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))] pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {daftar.map(({ id, jenis, pesan }) => {
          const { Ikon, kelas, warnaIkon } = GAYA[jenis] || GAYA.info;
          return (
            <div
              key={id}
              role={jenis === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex items-start gap-2.5 bg-white ${kelas} rounded-lg shadow-lg px-3.5 py-3 animate-toast-in motion-reduce:animate-none`}
            >
              <Ikon size={18} className={`${warnaIkon} shrink-0 mt-0.5`} />
              <p className="text-sm text-gray-800 flex-1 break-words">{pesan}</p>
              <button
                onClick={() => tutup(id)}
                className="shrink-0 text-gray-400 hover:text-gray-700 transition rounded"
                aria-label="Tutup pemberitahuan"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
