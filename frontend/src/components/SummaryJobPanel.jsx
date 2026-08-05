// ─────────────────────────────────────────────────────────────────────────────
// Tombol menjalankan ringkasan operasional secara manual, khusus admin.
//
// Dua tombol, bukan satu, dan pemisahannya disengaja:
//
//   Uji coba   mengolah data tanpa mengirim, hasilnya ditampilkan di sini
//   Kirim      mengolah lalu mengirim ke grup WhatsApp
//
// Pesan yang salah kirim ke grup manajemen tidak bisa ditarik kembali, jadi
// tombol kirim selalu meminta konfirmasi lebih dulu dan menyebut ke mana pesan
// itu akan pergi.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Play, Send, RefreshCw, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import API from "../api/api";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

export default function SummaryJobPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [jalan, setJalan] = useState(null);
  const [hasil, setHasil] = useState(null);

  const muat = async () => {
    try {
      const { data } = await API.get("/api/summary/job-status");
      setStatus(data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Gagal memuat status job");
    }
  };

  useEffect(() => {
    muat();
  }, []);

  async function jalankan(dryRun) {
    if (!dryRun) {
      const tujuan = status?.pengiriman?.provider === "dryrun"
        ? "mode dry run, jadi tidak ada yang benar-benar terkirim"
        : `grup WhatsApp (${status?.pengiriman?.groupId || "tujuan belum diatur"})`;
      const setuju = await confirm({
        judul: "Kirim ringkasan ke grup",
        pesan:
          `Data akan diolah ulang lalu pesannya dikirim ke ${tujuan}. ` +
          "Pesan yang sudah masuk grup tidak bisa ditarik kembali. Proses ini butuh sekitar dua sampai tiga menit.",
        labelKonfirmasi: "Olah dan kirim",
        destruktif: true,
      });
      if (!setuju) return;
    }

    setJalan(dryRun ? "uji" : "kirim");
    setHasil(null);
    try {
      const { data } = await API.post("/api/summary/run-and-send", {
        dryRun,
        // Laporan hari ini kemungkinan sudah terkirim oleh cron, dan admin yang
        // menekan tombol ini justru meminta versi terbaru. Tanpa ini ia akan
        // mendapat jawaban "sudah terkirim" dan menyangka tombolnya rusak.
        paksaKirimUlang: !dryRun,
      });
      setHasil(data);
      toast.success(data.message || "Selesai");
      await muat();
    } catch (err) {
      const p = err?.response?.data;
      toast.error(p?.message || "Gagal menjalankan job");
      if (p) setHasil(p);
    } finally {
      setJalan(null);
    }
  }

  const sched = status?.scheduler;
  const kirim = status?.pengiriman;
  const terakhir = status?.hasilTerakhir;

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-cimoryBlue mb-1">Ringkasan operasional harian</h3>
      <p className="text-xs text-gray-500 mb-3">
        Berjalan otomatis sesuai jadwal. Tombol di bawah untuk menjalankannya di
        luar jadwal, misalnya saat manajemen meminta data terbaru.
      </p>

      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
          <Kotak
            label="Jadwal otomatis"
            nilai={sched?.enabled ? "aktif" : "mati"}
            catatan={sched?.enabled ? `${sched.jadwal.kumpul} dan ${sched.jadwal.kirim}` : "SCHEDULER_ENABLED belum diisi"}
          />
          <Kotak
            label="Pengiriman"
            nilai={kirim?.provider || "-"}
            catatan={kirim?.siap ? `target ${kirim.targetMode}` : (kirim?.masalah?.[0] || "belum siap")}
          />
          <Kotak
            label="Laporan terakhir"
            nilai={terakhir?.whatsappSent ? "terkirim" : terakhir?.text ? "siap, belum terkirim" : "belum ada"}
            catatan={status.hariLaporan}
          />
          <Kotak
            label="Balasan tag di grup"
            nilai={status.listenerWhatsApp?.aktif ? "aktif" : "mati"}
            catatan={
              status.listenerWhatsApp?.aktif
                ? `jeda ${status.listenerWhatsApp.jedaMenit} menit`
                : "WHATSAPP_LISTENER_ENABLED belum diisi"
            }
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => jalankan(true)}
          disabled={Boolean(jalan)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          <Play size={15} />
          {jalan === "uji" ? "Sedang mengolah..." : "Uji coba tanpa kirim"}
        </button>

        <button
          onClick={() => jalankan(false)}
          disabled={Boolean(jalan)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cimoryBlue px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send size={15} />
          {jalan === "kirim" ? "Mengolah dan mengirim..." : "Olah dan kirim ke grup"}
        </button>

        <button
          onClick={muat}
          disabled={Boolean(jalan)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw size={15} />
          Segarkan
        </button>

        {jalan && (
          <span className="inline-flex items-center gap-1 text-sm text-gray-600">
            <Clock size={14} className="animate-pulse" />
            butuh sekitar dua sampai tiga menit, jangan tutup halaman ini
          </span>
        )}
      </div>

      {hasil && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium text-gray-800">{hasil.message}</p>
          {hasil.pengumpulan && (
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li>
                Periode {hasil.pengumpulan.minggu?.mulai} sampai {hasil.pengumpulan.minggu?.selesai}
              </li>
              <li>
                Analisis AI:{" "}
                {hasil.pengumpulan.ai?.berhasil ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 size={12} />
                    berhasil, {hasil.pengumpulan.ai.modelVersion}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertTriangle size={12} />
                    tidak terpakai, dikirim angka mentah
                  </span>
                )}
              </li>
              {hasil.pengumpulan.ai?.alasan && <li>Sebab: {hasil.pengumpulan.ai.alasan}</li>}
              <li>Panjang pesan {hasil.pengumpulan.panjangPesan} karakter</li>
            </ul>
          )}
          {/* Pesan hanya ditampilkan pada uji coba. Pada pengiriman sungguhan,
              isinya sudah ada di grup dan menampilkannya lagi di sini hanya
              memperpanjang halaman. */}
          {hasil.pengiriman?.pesan && (
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700">
              {hasil.pengiriman.pesan}
            </pre>
          )}
          {hasil.alasan && <p className="mt-1 text-xs text-red-600">{hasil.alasan}</p>}
        </div>
      )}
    </div>
  );
}

function Kotak({ label, nilai, catatan }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-lg font-semibold leading-tight text-gray-800">{nilai}</p>
      <p className="text-[11px] text-gray-500">{catatan}</p>
    </div>
  );
}
