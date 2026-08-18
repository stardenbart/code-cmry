// Panel chat CIA lintas dashboard.
//
// Dua jalur penarikan data, keduanya berujung ke endpoint yang sama:
//   1. MANUAL  - user mencentang dashboard lebih dulu, lalu bertanya.
//   2. OTOMATIS - user langsung bertanya tanpa mencentang apa pun. Server
//      menjawab dengan daftar dashboard yang relevan (`saran_dashboard`),
//      user mengklik salah satunya, dan pertanyaan terakhirnya dikirim ulang.
//
// Jalur otomatis TIDAK langsung menarik data begitu saran keluar. Menarik
// snapshot berarti memuat Power BI di latar, dan menebak dashboard yang salah
// lalu menjawab dengan angkanya adalah kegagalan diam yang paling mahal di
// sistem ini. Konfirmasi satu klik jauh lebih murah daripada jawaban salah.
import { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Send, Check, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { askUnified } from '../services/unifiedChatApi';
import SnapshotCapture from './SnapshotCapture';
import API from '../api/api.js';

export function UnifiedChatPanel({
  conversationId,
  onConversationId,
  turnAwal = null,
  onTurnTersimpan,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboardIds, setSelectedDashboardIds] = useState([]);
  // snapshots[id] = { data, error, capturing }
  const [snapshots, setSnapshots] = useState({});
  // Pertanyaan terakhir yang dijawab dengan saran, untuk dikirim ulang saat
  // user mengklik salah satu sarannya.
  const [pertanyaanTertunda, setPertanyaanTertunda] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    API.get('/api/dashboards')
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data.dashboards || [];
        setDashboards(list.filter((d) => d.active !== false));
      })
      .catch(() => { if (!cancelled) setDashboards([]); });
    return () => { cancelled = true; };
  }, []);

  // Membuka percakapan lama dari daftar riwayat.
  useEffect(() => {
    if (!turnAwal) return;
    setMessages(
      turnAwal.flatMap((t) => [
        { role: 'user', content: t.question, timestamp: t.created_at },
        {
          role: 'assistant',
          content: t.answer,
          dashboards_used: t.dashboards_queried,
          timestamp: t.created_at,
        },
      ])
    );
    setSelectedDashboardIds([]);
    setPertanyaanTertunda(null);
    setError(null);
  }, [turnAwal]);

  const handleSnapshotDone = useCallback((dashboardId, snap, errMsg) => {
    setSnapshots((prev) => ({
      ...prev,
      [dashboardId]: { data: snap, error: errMsg, capturing: false },
    }));
  }, []);

  const toggleDashboard = (id) => {
    setSelectedDashboardIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const pendingCaptureIds = selectedDashboardIds.filter((id) => !snapshots[id]);

  const kirim = useCallback(async (pertanyaan, idsTerpilih) => {
    setLoading(true);
    setError(null);
    try {
      const snapshotsToSend = idsTerpilih
        .map((id) => (snapshots[id]?.data ? { dashboard_id: id, snapshot: snapshots[id].data } : null))
        .filter(Boolean);

      const hasil = await askUnified(pertanyaan, conversationId, snapshotsToSend);

      onConversationId?.(hasil.conversation_id);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: hasil.answer,
        dashboards_used: hasil.dashboards_used,
        saran_dashboard: hasil.saran_dashboard,
        timestamp: new Date(),
      }]);

      // Saran keluar berarti pertanyaannya belum terjawab dengan data. Simpan
      // supaya klik pada saran bisa mengirimkannya ulang tanpa mengetik lagi.
      setPertanyaanTertunda(hasil.saran_dashboard?.length > 0 ? pertanyaan : null);
      onTurnTersimpan?.();
    } catch (err) {
      setError(err.message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [conversationId, snapshots, onConversationId, onTurnTersimpan]);

  const handleSend = () => {
    const pertanyaan = input.trim();
    if (!pertanyaan || loading) return;

    if (pendingCaptureIds.length > 0) {
      setError('Tunggu dashboard selesai memuat datanya sebentar lagi.');
      return;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: pertanyaan, timestamp: new Date() }]);
    // Tanpa dashboard terpilih, server yang menyarankan. Itu jalur otomatisnya.
    kirim(pertanyaan, selectedDashboardIds);
  };

  // Klik pada dashboard saran: centang, tunggu datanya siap, lalu kirim ulang
  // pertanyaan yang tertunda. Pengiriman ulangnya ada di useEffect di bawah,
  // karena snapshot-nya baru ada beberapa detik kemudian.
  const [menungguSaran, setMenungguSaran] = useState(null);

  const pilihSaran = (id) => {
    if (!pertanyaanTertunda) return;
    setSelectedDashboardIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setMenungguSaran(id);
  };

  useEffect(() => {
    if (!menungguSaran || !pertanyaanTertunda) return;
    const entry = snapshots[menungguSaran];
    if (!entry) return;                     // masih memuat

    const idsSiap = [...new Set([...selectedDashboardIds, menungguSaran])]
      .filter((id) => snapshots[id]?.data);

    setMenungguSaran(null);
    if (idsSiap.length === 0) {
      setError('Data dashboard itu gagal dibaca. Coba dashboard lain.');
      return;
    }
    const pertanyaan = pertanyaanTertunda;
    setPertanyaanTertunda(null);
    setMessages((prev) => [...prev, { role: 'user', content: pertanyaan, timestamp: new Date() }]);
    kirim(pertanyaan, idsSiap);
  }, [menungguSaran, snapshots, pertanyaanTertunda, selectedDashboardIds, kirim]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const dashboardById = (id) => dashboards.find((d) => d.id === id);
  const sedangMemuat = pendingCaptureIds.length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* Penarikan snapshot di latar, satu mount per dashboard terpilih yang
          datanya belum pernah diambil. */}
      {pendingCaptureIds.map((id) => {
        const dash = dashboardById(id);
        if (!dash) return null;
        return (
          <SnapshotCapture
            key={id}
            dashboard={dash}
            onDone={(snap, err) => handleSnapshotDone(id, snap, err)}
          />
        );
      })}

      {/* Pemilihan dashboard.

          Terlipat secara bawaan. Jalur utamanya adalah bertanya langsung dan
          membiarkan CIA menyarankan dashboardnya, jadi daftar panjang yang
          selalu terbuka hanya memakan ruang percakapan. Yang perlu terlihat
          tanpa membuka daftarnya cuma dua: berapa yang terpilih dan apakah
          datanya masih dimuat. Keduanya ada di baris ringkasannya.

          Memakai <details>, bukan state React, karena buka-tutup adalah
          perilaku bawaan elemennya: tidak ada state yang bisa melenceng dan
          isinya tetap ada di DOM sehingga centang tidak hilang saat dilipat. */}
      <details className="group border-b border-cimoryGray bg-gray-50/80 shrink-0">
        <summary className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer list-none marker:content-none hover:bg-gray-100/80 transition">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-cimoryBlue">
            <ChevronDown size={16} className="group-open:hidden" />
            <ChevronUp size={16} className="hidden group-open:block" />
            Dashboard
            {selectedDashboardIds.length > 0 && (
              <span className="text-xs font-normal text-gray-500">
                {selectedDashboardIds.length} terpilih
              </span>
            )}
          </h3>
          {sedangMemuat > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-cimoryBlue">
              <RefreshCw size={12} className="animate-spin" />
              Memuat data {sedangMemuat} dashboard
            </span>
          )}
        </summary>

        <div className="px-5 pb-3">
        <p className="text-xs text-gray-500 mb-2">
          Pilih dashboard untuk membaca datanya, atau langsung tanya dan CIA yang
          menyarankan dashboard mana yang perlu dibuka.
        </p>

        {dashboards.length === 0 ? (
          <p className="text-sm text-gray-500 py-1">Memuat daftar dashboard...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
            {dashboards.map((dash) => {
              const entry = snapshots[dash.id];
              const isSelected = selectedDashboardIds.includes(dash.id);
              return (
                <label
                  key={dash.id}
                  className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all text-sm ${
                    isSelected
                      ? 'border-cimoryBlue bg-cimoryBlue/5'
                      : 'border-cimoryGray bg-white hover:border-cimoryBlue/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleDashboard(dash.id)}
                    className="mt-1 w-4 h-4 accent-cimoryBlue rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{dash.title}</p>
                    {dash.department && <p className="text-xs text-gray-500">{dash.department}</p>}
                    {isSelected && !entry && (
                      <p className="text-xs text-cimoryBlue mt-0.5">Memuat data...</p>
                    )}
                    {entry?.data && (
                      <p className="flex items-center gap-1 text-xs text-green-600 mt-0.5">
                        <Check size={12} /> Data siap
                      </p>
                    )}
                    {entry?.error && (
                      <p className="flex items-center gap-1 text-xs text-cimoryRed mt-0.5" title={entry.error}>
                        <AlertTriangle size={12} /> Gagal ambil data
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        </div>
      </details>

      {/* Percakapan */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-cimoryGray/60">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-center px-6">
            <div className="max-w-sm">
              <p className="text-base font-semibold text-cimoryBlue">Mulai percakapan</p>
              <p className="text-sm text-gray-500 mt-2">
                Tanyakan apa pun. Kalau belum yakin dashboard mana yang menjawabnya,
                kirim saja pertanyaannya.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} {...msg} onPilihSaran={pilihSaran} />
        ))}
        {loading && (
          <div className="px-5 py-4 flex items-center gap-2 text-sm text-gray-500">
            <RefreshCw size={14} className="animate-spin" />
            CIA sedang membaca datanya
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Masukan */}
      <div className="border-t border-cimoryGray px-5 py-4 bg-white shrink-0">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Tanyakan sesuatu tentang dashboard"
            disabled={loading}
            className="flex-1 px-4 py-2 border border-cimoryGray rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cimoryBlue/40 focus:border-cimoryBlue disabled:bg-gray-100"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim() || pendingCaptureIds.length > 0}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            Kirim
          </button>
        </div>
        {error && <p className="text-xs text-cimoryRed mt-2 pl-1">{error}</p>}
      </div>
    </div>
  );
}

export default UnifiedChatPanel;
