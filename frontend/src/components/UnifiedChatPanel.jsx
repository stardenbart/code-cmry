import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage } from './ChatMessage';
import { askUnified } from '../services/unifiedChatApi';
import SnapshotCapture from './SnapshotCapture';
import API from '../api/api.js';

export function UnifiedChatPanel({ defaultDashboards = [] }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboardIds, setSelectedDashboardIds] = useState([]);
  // snapshots[id] = { data, error, capturing }
  const [snapshots, setSnapshots] = useState({});
  const messagesEndRef = useRef(null);

  // Fetch catalog of dashboards accessible to this user
  useEffect(() => {
    let cancelled = false;
    API.get('/api/dashboards')
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data.dashboards || [];
        setDashboards(list.filter(d => d.active !== false));
      })
      .catch((err) => {
        console.warn('Failed to fetch dashboards:', err);
        if (!cancelled) setDashboards(defaultDashboards);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDashboard = (id) => {
    setSelectedDashboardIds(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
    // Selecting a dashboard we've never captured queues an off-screen
    // SnapshotCapture below; deselecting just stops sending it, we keep the
    // cached data in case the user re-checks it.
  };

  const handleSnapshotDone = useCallback((dashboardId, snap, errMsg) => {
    setSnapshots(prev => ({
      ...prev,
      [dashboardId]: { data: snap, error: errMsg, capturing: false },
    }));
  }, []);

  // Dashboards that are selected but have no snapshot attempt yet — these get
  // an off-screen SnapshotCapture mounted until they report back.
  const pendingCaptureIds = selectedDashboardIds.filter(id => !snapshots[id]);
  const capturingCount = selectedDashboardIds.filter(id => snapshots[id]?.capturing).length
    + pendingCaptureIds.length;

  const handleSend = async () => {
    if (!input.trim()) return;

    if (selectedDashboardIds.length === 0) {
      setError('Pilih dashboard untuk data yang ingin ditanyakan.');
      return;
    }

    if (pendingCaptureIds.length > 0) {
      setError('Tunggu dashboard selesai memuat datanya sebentar lagi.');
      return;
    }

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setLoading(true);
    setError(null);

    try {
      const snapshotsToSend = selectedDashboardIds
        .map(id => {
          const entry = snapshots[id];
          return entry?.data ? { dashboard_id: id, snapshot: entry.data } : null;
        })
        .filter(Boolean);

      if (snapshotsToSend.length === 0) {
        setError('Tidak ada data yang berhasil diambil dari dashboard terpilih. Coba dashboard lain.');
        setMessages(prev => prev.slice(0, -1));
        setLoading(false);
        return;
      }

      const result = await askUnified(userMessage, conversationId, snapshotsToSend);

      setConversationId(result.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        dashboards_used: result.dashboards_used,
        timestamp: new Date(),
      }]);
    } catch (err) {
      setError(`Error: ${err.message}`);
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const dashboardById = (id) => dashboards.find(d => d.id === id);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Off-screen snapshot capture: one mount per selected dashboard that
          hasn't reported a snapshot (or an error) yet. */}
      {pendingCaptureIds.map(id => {
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

      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">💬 Multi-Dashboard Chat</h1>
            <p className="text-xs text-white/80 mt-0.5">
              Tanyakan apapun tentang beberapa dashboard sekaligus
            </p>
          </div>
          <button
            onClick={() => { setMessages([]); setConversationId(null); }}
            className="px-3 py-1 text-xs bg-white/20 hover:bg-white/30 rounded transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Dashboard selector */}
      <div className="border-b border-gray-200 px-6 py-3 bg-gray-50 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">
            📊 Dashboard ({selectedDashboardIds.length} terpilih)
          </h3>
          {capturingCount > 0 && (
            <span className="text-xs text-cimoryBlue animate-pulse">
              Memuat data {capturingCount} dashboard...
            </span>
          )}
        </div>

        {dashboards.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">Memuat daftar dashboard...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
            {dashboards.map(dash => {
              const entry = snapshots[dash.id];
              const isSelected = selectedDashboardIds.includes(dash.id);
              return (
                <label
                  key={dash.id}
                  className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all text-sm ${
                    isSelected ? 'border-cimoryBlue bg-cimoryBlue/5' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleDashboard(dash.id)}
                    className="mt-1 w-4 h-4 text-cimoryBlue rounded focus:ring-cimoryBlue"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{dash.title}</p>
                    {dash.department && <p className="text-xs text-gray-500">{dash.department}</p>}
                    {isSelected && !entry && (
                      <p className="text-xs text-cimoryBlue mt-0.5 animate-pulse">Memuat data...</p>
                    )}
                    {entry?.data && (
                      <p className="text-xs text-green-600 mt-0.5">✓ Data siap</p>
                    )}
                    {entry?.error && (
                      <p className="text-xs text-red-500 mt-0.5" title={entry.error}>⚠ Gagal ambil data</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50/50">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center max-w-md px-4">
              <p className="text-lg font-medium">Mulai percakapan baru</p>
              <p className="text-sm mt-2">Pilih dashboard di atas, lalu tanyakan sesuatu</p>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} {...msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-6 py-4 bg-white shrink-0">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={selectedDashboardIds.length > 0 ? "Tanyakan sesuatu..." : "Pilih dashboard dulu..."}
            disabled={loading || selectedDashboardIds.length === 0}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim() || selectedDashboardIds.length === 0 || pendingCaptureIds.length > 0}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:opacity-50 transition"
          >
            {loading ? <span className="animate-spin inline-block">↻</span> : 'Kirim'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2 pl-1">{error}</p>}
      </div>
    </div>
  );
}

export default UnifiedChatPanel;
