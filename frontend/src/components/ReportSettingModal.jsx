import React, { useEffect, useState } from "react";
import { Loader, CalendarClock } from "lucide-react";
import API from "../api/api";

const FREKUENSI_LABEL = {
  hourly: "Tiap jam",
  daily: "Harian",
  weekly: "Mingguan",
};

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const PROVIDER_LABEL = {
  gemini: "Gemini",
  glm: "GLM-5.2 (NVIDIA NIM)",
};

/**
 * Setelan laporan performa harian.
 *
 * Terpisah dari Manage Users karena ini setelan operasional, bukan pengelolaan
 * akun. Menaruh keduanya di layar yang sama membuat dua hal dengan risiko
 * berbeda tampak setara.
 */
export default function ReportSettingModal({ onClose }) {
  const [setelan, setSetelan] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, []);

  const muat = () =>
    API.get("/api/report-setting")
      .then(({ data }) => {
        setSetelan(data);
        setForm({
          aktif: data.aktif,
          frekuensi: data.frekuensi,
          jam: data.jam,
          menit: data.menit,
          hari: data.hari,
          provider: data.provider,
          grupJid: data.grupJid,
        });
      })
      .catch(() => setMsg({ type: "err", text: "Gagal memuat setelan laporan" }));

  useEffect(() => { muat(); }, []);

  const simpan = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const { data } = await API.put("/api/report-setting", form);
      setSetelan(data);
      setMsg({ type: "ok", text: `${data.message}. Jadwal sekarang: ${data.ringkasan}` });
    } catch (err) {
      setMsg({ type: "err", text: err?.response?.data?.message || "Gagal menyimpan setelan" });
    } finally {
      setLoading(false);
    }
  };

  const ubah = (kunci, nilai) => setForm((f) => ({ ...f, [kunci]: nilai }));

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50 p-4">
      <div className="bg-white p-6 w-[480px] max-h-[90vh] overflow-y-auto shadow-xl">
        <h2 className="text-lg font-semibold mb-1 text-cimoryBlue flex items-center gap-2">
          <CalendarClock size={20} /> Setelan Laporan Harian
        </h2>
        <p className="text-[12px] text-gray-500 mb-4">
          Jadwal dibaca ulang dari sini setiap menit, jadi perubahan berlaku tanpa
          restart server.
        </p>

        {!form ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Loader className="animate-spin" size={16} /> Memuat setelan
          </div>
        ) : (
          <>
            {/* Keadaan sekarang, dalam kalimat. Admin tidak perlu menerjemahkan
                angka jam dan hari sendiri: salah membaca jadwal baru ketahuan
                sehari kemudian, saat laporannya tidak datang. */}
            <div className="mb-4 border rounded-lg p-3 text-sm">
              <p className={`font-medium ${setelan?.aktif ? "text-green-700" : "text-amber-700"}`}>
                {setelan?.ringkasan}
              </p>
              <ul className="mt-1 space-y-0.5 text-gray-600 text-[13px]">
                <li>Grup tujuan: {setelan?.grupJid
                  ? <span className="font-mono text-[12px]">{setelan.grupJid}</span>
                  : <span className="italic text-gray-400">memakai daftar dari .env</span>}</li>
                <li>Model: {PROVIDER_LABEL[setelan?.provider] || setelan?.provider}</li>
              </ul>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.aktif}
                  onChange={(e) => ubah("aktif", e.target.checked)}
                />
                Aktifkan penjadwalan otomatis
              </label>
              <p className="text-[12px] text-gray-500 mt-1 ml-6">
                Kalau dimatikan, laporan hanya terkirim lewat tombol manual.
              </p>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Frekuensi</label>
              <select
                className="border w-full p-2 rounded-lg"
                value={form.frekuensi}
                onChange={(e) => ubah("frekuensi", e.target.value)}
              >
                {(setelan?.frekuensiSah || ["hourly", "daily", "weekly"]).map((f) => (
                  <option key={f} value={f}>{FREKUENSI_LABEL[f] || f}</option>
                ))}
              </select>
            </div>

            {form.frekuensi === "weekly" && (
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">Hari</label>
                <select
                  className="border w-full p-2 rounded-lg"
                  value={form.hari}
                  onChange={(e) => ubah("hari", Number(e.target.value))}
                >
                  {NAMA_HARI.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </div>
            )}

            <div className="mb-3 flex gap-3">
              {/* Jam disembunyikan untuk frekuensi tiap jam, karena di situ hanya
                  menitnya yang berarti. Menampilkan kolom yang tidak dipakai
                  membuat admin mengira jadwalnya lain dari yang sebenarnya. */}
              {form.frekuensi !== "hourly" && (
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Jam (WIB)</label>
                  <input
                    type="number" min="0" max="23"
                    className="border w-full p-2 rounded-lg"
                    value={form.jam}
                    onChange={(e) => ubah("jam", Number(e.target.value))}
                  />
                </div>
              )}
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Menit</label>
                <input
                  type="number" min="0" max="59"
                  className="border w-full p-2 rounded-lg"
                  value={form.menit}
                  onChange={(e) => ubah("menit", Number(e.target.value))}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">ID grup WhatsApp</label>
              <input
                type="text"
                className="border w-full p-2 rounded-lg font-mono text-[13px]"
                placeholder="120363xxxxxxxxx@g.us"
                value={form.grupJid}
                onChange={(e) => ubah("grupJid", e.target.value)}
              />
              <p className="text-[12px] text-gray-500 mt-1">
                Pisahkan dengan koma untuk beberapa grup. Harus berakhiran @g.us:
                nomor perorangan ditolak supaya laporan operasional tidak masuk ke
                japri. Kosongkan untuk memakai daftar dari .env.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Model penyusun laporan</label>
              <select
                className="border w-full p-2 rounded-lg"
                value={form.provider}
                onChange={(e) => ubah("provider", e.target.value)}
              >
                {Object.keys(PROVIDER_LABEL).map((p) => (
                  <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
                ))}
              </select>
              {form.provider === "glm" && !setelan?.glmSiap && (
                <p className="text-[12px] text-amber-700 mt-1">
                  NVIDIA_API_KEY belum diisi di server, jadi laporan tetap disusun
                  Gemini. Setelan ini berlaku begitu kuncinya dipasang.
                </p>
              )}
              <p className="text-[12px] text-gray-500 mt-1">
                Terpisah dari model CIA di grup. Laporan harian dibaca sebagai
                fakta, jadi boleh memakai model yang berbeda.
              </p>
            </div>

            {msg && (
              <p className={`text-sm mb-3 ${msg.type === "ok" ? "text-green-700" : "text-red-600"}`}>
                {msg.text}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={simpan}
                disabled={loading}
                className="flex-1 bg-cimoryBlue text-white p-2 rounded-lg disabled:opacity-60"
              >
                {loading ? "Menyimpan" : "Simpan"}
              </button>
              <button onClick={onClose} className="px-4 border rounded-lg">Tutup</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
