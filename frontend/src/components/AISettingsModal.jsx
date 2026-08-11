import React, { useEffect, useState } from "react";
import { Loader, EyeIcon, EyeOffIcon } from "lucide-react";
import API from "../api/api";
import { useConfirm } from "./ConfirmProvider";

// Users choose behaviour, not vendor model ids. The system routes each question
// to a tier automatically; this only sets the ceiling for the deepest tier.
const MODEL_LABELS = {
  "gemini-3.6-flash": "Kualitas tertinggi (rekomendasi)",
  "gemini-3.5-flash": "Seimbang",
  "gemini-3.5-flash-lite": "Paling cepat & hemat kuota",
  "gemini-3.1-flash-lite": "Cepat, hemat kuota",
  "gemini-flash-latest": "Selalu ikut versi terbaru",
  "gemini-flash-lite-latest": "Versi ringan terbaru",
};

export default function AISettingsModal({ onClose }) {
  const confirm = useConfirm();
  const [status, setStatus]   = useState(null);
  const [apiKey, setApiKey]   = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel]     = useState("gemini-3.6-flash");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);   // { type: "ok"|"err", text }

  // Universal key (Digital Transformer only)
  const [uniKey, setUniKey]     = useState("");
  const [showUni, setShowUni]   = useState(false);
  const [uniLoading, setUniLoading] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, []);

  const loadStatus = () =>
    API.get("/api/ai/status")
      .then(({ data }) => {
        setStatus(data);
        setModel(data.model || "gemini-3.6-flash");
      })
      .catch(() => setMsg({ type: "err", text: "Gagal memuat status CIA" }));

  useEffect(() => { loadStatus(); }, []);

  const save = async () => {
    setLoading(true);
    setMsg(null);
    try {
      if (apiKey.trim()) {
        const { data } = await API.put("/api/ai/key", { apiKey: apiKey.trim(), model });
        setMsg({ type: "ok", text: `${data.message} (${data.keyPreview})` });
        setApiKey("");
      } else if (status?.hasUserKey) {
        await API.put("/api/ai/model", { model });
        setMsg({ type: "ok", text: "Pengaturan diperbarui" });
      } else {
        setMsg({ type: "err", text: "Masukkan kunci akses dulu" });
        setLoading(false);
        return;
      }
      await loadStatus();
    } catch (err) {
      setMsg({ type: "err", text: err?.response?.data?.message || "Gagal menyimpan" });
    } finally {
      setLoading(false);
    }
  };

  const removeKey = async () => {
    const setuju = await confirm({
      judul: "Hapus kunci pribadi",
      pesan: "Setelah dihapus, CIA akan memakai kunci universal yang kuotanya dibagi dengan semua user.",
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    setLoading(true);
    try {
      await API.delete("/api/ai/key");
      setMsg({ type: "ok", text: "Kunci pribadi dihapus" });
      await loadStatus();
    } catch (err) {
      setMsg({ type: "err", text: err?.response?.data?.message || "Gagal menghapus" });
    } finally {
      setLoading(false);
    }
  };

  const saveUniversal = async () => {
    if (!uniKey.trim()) { setMsg({ type: "err", text: "Masukkan kunci universal dulu" }); return; }
    setUniLoading(true);
    setMsg(null);
    try {
      const { data } = await API.put("/api/ai/universal-key", { apiKey: uniKey.trim() });
      setMsg({ type: "ok", text: `${data.message} (${data.keyPreview})` });
      setUniKey("");
      await loadStatus();
    } catch (err) {
      setMsg({ type: "err", text: err?.response?.data?.message || "Gagal menyimpan kunci universal" });
    } finally {
      setUniLoading(false);
    }
  };

  const removeUniversal = async () => {
    const setuju = await confirm({
      judul: "Hapus kunci universal",
      pesan: "User yang tidak punya kunci pribadi tidak akan bisa memakai CIA setelah ini.",
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    setUniLoading(true);
    try {
      const { data } = await API.delete("/api/ai/universal-key");
      setMsg({ type: "ok", text: data.message });
      await loadStatus();
    } catch (err) {
      setMsg({ type: "err", text: err?.response?.data?.message || "Gagal menghapus" });
    } finally {
      setUniLoading(false);
    }
  };

  const canManageUniversal = status?.universal?.canManage;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50 p-4">
      <div className="bg-white p-6 w-[440px] max-h-[90vh] overflow-y-auto shadow-xl">
        <h2 className="text-lg font-semibold mb-4 text-cimoryBlue">Pengaturan CIA (Cimory Intelligence Assistant)</h2>

        {/* Status */}
        {!status ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Loader className="animate-spin" size={16} /> Memuat status…
          </div>
        ) : (
          <div className="mb-4 border rounded-lg p-3 text-sm">
            <p className={`font-medium mb-1 ${status.enabled ? "text-green-700" : "text-amber-700"}`}>
              {status.enabled ? "CIA aktif" : "CIA belum aktif"}
            </p>
            <ul className="space-y-0.5 text-gray-600 text-[13px]">
              <li>Kunci pribadi: {status.hasUserKey
                ? <span className="font-mono">{status.keyPreview}</span>
                : <span className="italic text-gray-400">belum diatur</span>}</li>
              <li>Kunci universal: {status.universal?.configured
                ? <span className="text-green-700">tersedia{status.universal.source === "env" ? " (dari .env)" : ""}</span>
                : <span className="italic text-gray-400">belum diatur</span>}</li>
              <li>Kualitas maksimum: <span className="font-medium">{MODEL_LABELS[status.model] || status.model}</span></li>
            </ul>
            {!status.hasUserKey && status.universal?.configured && (
              <p className="mt-2 text-[12px] text-amber-700">
                Kamu memakai kunci universal, kuotanya dibagi dengan semua user.
                Isi kunci pribadi di bawah untuk jatah sendiri.
              </p>
            )}
          </div>
        )}

        {/* Personal key */}
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">
            Kunci pribadi (BYOK)
            {status?.hasUserKey && <span className="text-gray-400 font-normal"> (kosongkan bila tidak diubah)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              className="border w-full p-2 rounded-lg pr-10 font-mono text-sm"
              placeholder="AIza..."
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
            >
              {showKey ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
          <p className="text-[12px] text-gray-500 mt-1">
            Ambil gratis di{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-cimoryBlue underline">
              Google AI Studio
            </a>
            . Disimpan terenkripsi dan hanya dipakai untuk akunmu.
          </p>
        </div>

        {/* Model ceiling */}
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">Kualitas maksimum</label>
          <select
            className="border w-full p-2 rounded-lg"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {(status?.availableModels || Object.keys(MODEL_LABELS)).map((m) => (
              <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>
            ))}
          </select>
        </div>

        {/* Universal key — Digital Transformer only */}
        {canManageUniversal && (
          <div className="mb-3 border-t pt-3">
            <label className="block text-sm font-medium mb-1">
              Kunci universal <span className="text-gray-400 font-normal">(khusus admin)</span>
            </label>
            <div className="relative">
              <input
                type={showUni ? "text" : "password"}
                className="border w-full p-2 rounded-lg pr-10 font-mono text-sm"
                placeholder={status?.universal?.configured ? "Ganti kunci universal…" : "AIza..."}
                autoComplete="off"
                value={uniKey}
                onChange={(e) => setUniKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowUni(!showUni)}
                className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
              >
                {showUni ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
            <p className="text-[12px] text-gray-500 mt-1">
              Dipakai semua user yang belum punya kunci pribadi. Satu kunci = satu
              jatah, jadi kuotanya dibagi bersama.
              {status?.universal?.updatedBy && (
                <> Terakhir diubah oleh <b>{status.universal.updatedBy}</b>.</>
              )}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={saveUniversal}
                disabled={uniLoading}
                className="px-3 py-1.5 bg-cimoryBlue text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
              >
                {uniLoading ? <Loader className="animate-spin" size={16} /> : "Simpan kunci universal"}
              </button>
              {status?.universal?.configured && status.universal.source === "database" && (
                <button
                  onClick={removeUniversal}
                  disabled={uniLoading}
                  className="px-3 py-1.5 rounded-lg border hover:bg-gray-100 text-sm disabled:opacity-50"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        )}

        {/* Data protection */}
        {status && (
          <div className="mb-3 border-t pt-3 text-[12px] text-gray-600">
            <p className="font-medium text-gray-800 mb-1">
              Penyamaran data: {status.sanitization?.enabled ? "AKTIF" : "NONAKTIF"}
            </p>
            {status.sanitization?.enabled ? (
              <ul className="space-y-0.5">
                <li>• Nama orang, supplier, no. dokumen → diganti token, dipulihkan di jawaban.</li>
                <li>• Email, telepon, NIK, NPWP, alamat → dihapus permanen.</li>
                <li>• Angka operasional, mesin, tanggal → tetap dikirim (isi analisisnya).</li>
              </ul>
            ) : (
              <p className="text-amber-700">Semua data dikirim apa adanya. Aktifkan lewat AI_SANITIZE=true.</p>
            )}
            <p className="mt-1 text-amber-700">
              Pada kunci gratis, Google boleh memakai isi prompt untuk pengembangan
              produk. Untuk data yang benar-benar rahasia, pakai kunci berbayar.
            </p>
          </div>
        )}

        {msg && (
          <p className={`text-sm mb-2 ${msg.type === "ok" ? "text-green-700" : "text-red-600"}`}>
            {msg.text}
          </p>
        )}

        <div className="flex justify-end space-x-2 mt-4">
          {status?.hasUserKey && (
            <button
              onClick={removeKey}
              disabled={loading}
              className="px-4 py-2 rounded-lg border hover:bg-gray-100 mr-auto"
            >
              Hapus kunci pribadi
            </button>
          )}
          <button className="px-4 py-2 rounded-lg border hover:bg-gray-100" onClick={onClose}>
            Tutup
          </button>
          <button
            onClick={save}
            disabled={loading}
            className="px-4 py-2 bg-cimoryBlue text-white rounded-lg hover:bg-blue-700 transition"
          >
            {loading ? <Loader className="animate-spin" size={18} /> : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
