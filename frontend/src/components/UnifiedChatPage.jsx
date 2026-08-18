// Halaman chat CIA lintas dashboard.
//
// Sebelumnya ini modal melayang di atas dashboard. Sebagai halaman sendiri,
// percakapan panjang punya ruang, daftar riwayat muat di sampingnya, dan
// alamatnya bisa dibagikan serta dibuka langsung.
//
// Penjagaan aksesnya ADA DI SERVER, bukan di sini. Rute /api/ai/unified/*
// menolak 403 untuk user tanpa cia_access, jadi membuka alamat ini secara
// langsung tidak memberi apa pun. Yang dilakukan halaman ini hanya menunjukkan
// alasannya, bukan menjadi penjaganya.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageSquare, Plus, Trash2 } from "lucide-react";
import UnifiedChatPanel from "./UnifiedChatPanel";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";
import {
  getConversations, getConversationTurns, deleteConversation,
} from "../services/unifiedChatApi";

/** "1,2 GB dari 5 GB" — byte mentah tidak berarti apa-apa bagi pembacanya. */
function formatByte(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const satuan = ["KB", "MB", "GB", "TB"];
  let nilai = b / 1024;
  let i = 0;
  while (nilai >= 1024 && i < satuan.length - 1) { nilai /= 1024; i += 1; }
  return `${nilai.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${satuan[i]}`;
}

export default function UnifiedChatPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const [conversations, setConversations] = useState([]);
  const [penyimpanan, setPenyimpanan] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [turnAwal, setTurnAwal] = useState(null);
  const [galat, setGalat] = useState(null);

  const muatDaftar = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations || []);
      setPenyimpanan(data.penyimpanan || null);
      setGalat(null);
    } catch (err) {
      setGalat(err.message);
    }
  }, []);

  useEffect(() => { muatDaftar(); }, [muatDaftar]);

  const bukaPercakapan = async (id) => {
    if (id === conversationId) return;
    try {
      const data = await getConversationTurns(id);
      setConversationId(id);
      // Objek baru tiap kali, supaya membuka ulang percakapan yang sama
      // sesudah percakapan lain tetap memuat ulang isinya.
      setTurnAwal([...(data.turns || [])]);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const percakapanBaru = () => {
    setConversationId(null);
    setTurnAwal([]);
  };

  const hapus = async (id, judul) => {
    const setuju = await confirm({
      judul: "Hapus percakapan",
      pesan: `"${judul || "Percakapan"}" akan dihapus berikut seluruh isinya. Tindakan ini tidak bisa dibatalkan.`,
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    try {
      await deleteConversation(id);
      if (id === conversationId) percakapanBaru();
      await muatDaftar();
      toast.success("Percakapan dihapus.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const persenTerpakai = penyimpanan?.batas
    ? Math.min(100, (penyimpanan.terpakai / penyimpanan.batas) * 100)
    : 0;

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-cimoryBlue/50 via-white to-cimoryRed/50">
      <header className="shrink-0 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white px-4 lg:px-6 py-3 shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/App")}
            className="p-2 rounded-full hover:bg-white/20 transition"
            title="Kembali ke dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <MessageSquare size={20} />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">Chat Multi Dashboard</h1>
            <p className="text-xs text-white/80">
              Tanya lintas dashboard, CIA yang menyambungkan datanya
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex gap-3 lg:gap-6 p-3 lg:p-6">
        <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white/70 backdrop-blur-md rounded-2xl border border-cimoryGray shadow-md overflow-hidden">
          <div className="p-3 border-b border-cimoryGray">
            <button
              onClick={percakapanBaru}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-cimoryBlue hover:bg-cimoryBlue/90 rounded-lg transition"
            >
              <Plus size={16} /> Percakapan baru
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {galat && <p className="text-xs text-cimoryRed px-2 py-1">{galat}</p>}
            {!galat && conversations.length === 0 && (
              <p className="text-xs text-gray-500 px-2 py-3">Belum ada percakapan tersimpan.</p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-start gap-1 rounded-lg mb-1 transition ${
                  c.id === conversationId ? "bg-cimoryBlue/10" : "hover:bg-gray-100"
                }`}
              >
                <button
                  onClick={() => bukaPercakapan(c.id)}
                  className="flex-1 min-w-0 text-left px-3 py-2"
                >
                  <span className="block text-sm text-gray-800 truncate">
                    {c.judul || "Percakapan"}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {c.jumlah_turn} pesan
                  </span>
                </button>
                <button
                  onClick={() => hapus(c.id, c.judul)}
                  className="p-2 text-gray-400 hover:text-cimoryRed opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                  title="Hapus percakapan"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {penyimpanan && (
            <div className="p-3 border-t border-cimoryGray">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Penyimpanan</span>
                <span>{formatByte(penyimpanan.terpakai)} / {formatByte(penyimpanan.batas)}</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cimoryBlue rounded-full transition-all"
                  style={{ width: `${Math.max(persenTerpakai, penyimpanan.terpakai > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          )}
        </aside>

        <main className="flex-1 min-w-0 bg-white rounded-2xl border border-cimoryGray shadow-md overflow-hidden">
          <UnifiedChatPanel
            conversationId={conversationId}
            onConversationId={setConversationId}
            turnAwal={turnAwal}
            onTurnTersimpan={muatDaftar}
          />
        </main>
      </div>
    </div>
  );
}
