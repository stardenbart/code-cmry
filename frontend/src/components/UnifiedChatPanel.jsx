import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { askUnified } from '../services/unifiedChatApi';
import { captureReportSnapshot } from '../utils/powerbiData';

export function UnifiedChatPanel({ defaultDashboards = [] }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboardIds, setSelectedDashboardIds] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const messagesEndRef = useRef(null);

  // Fetch catalog of dashboards
  useEffect(() => {
    // Try to get from localStorage first (cached by askUnified if available)
    const cached = localStorage.getItem('unified_chat_dashboards');
    if (cached) {
      try {
        setDashboards(JSON.parse(cached));
      } catch {}
    }

    // Always fetch fresh from server
    fetchDashboards();
  }, []);

  const fetchDashboards = async () => {
    try {
      const response = await fetch('/api/dashboards', {
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        const accessible = (data.dashboards || []).filter(d => d.active);
        setDashboards(accessible);
        localStorage.setItem('unified_chat_dashboards', JSON.stringify(accessible));
      }
    } catch (err) {
      console.warn('Failed to fetch dashboards:', err);
      // Fallback to default
      setDashboards(defaultDashboards);
    }
  };

  // Toggle dashboard selection
  const toggleDashboard = (id) => {
    setSelectedDashboardIds(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  // Capture snapshot for a dashboard
  const captureSnapshot = async (dashboard, report) => {
    setSnapshotLoading(true);
    try {
      const snap = await captureReportSnapshot(report, {
        maxRowsPerVisual: 200,
        allPages: true,
      });
      setSnapshots(prev => ({ ...prev, [dashboard.id]: snap }));
      return true;
    } catch (err) {
      console.warn(`Snapshot failed for ${dashboard.title}:`, err);
      return false;
    } finally {
      setSnapshotLoading(false);
    }
  };

  // Capture all selected dashboard snapshots
  const captureAllSnapshots = async () => {
    if (selectedDashboardIds.length === 0) {
      setError('Pilih minimal satu dashboard untuk data.');
      return false;
    }

    setSnapshotLoading(true);
    setError(null);

    // TODO: In a real implementation, we'd get the Power BI report objects
    // from dashboard embeds. For now, we'll mark them as "pending capture".
    // The user needs to have dashboards open and embedded for snapshots to work.
    const capturedCount = 0; // Will be filled when reports are available

    setSnapshotLoading(false);
    return capturedCount > 0;
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    if (selectedDashboardIds.length === 0) {
      setError('Pilih dashboard untuk data yang ingin ditanyakan.');
      return;
    }

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setLoading(true);
    setError(null);

    try {
      // Build snapshots array from captured data
      const snapshotsToSend = selectedDashboardIds
        .map(id => {
          const snap = snapshots[id];
          const dash = dashboards.find(d => d.id === id);
          return snap && dash ? { dashboard_id: id, snapshot: snap } : null;
        })
        .filter(Boolean);

      if (snapshotsToSend.length === 0) {
        setError('Belum ada data snapshot. Pastikan dashboard sudah di-capture.');
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

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Render dashboard selector
  const DashboardSelector = () => (
    <div className="border-b border-gray-200 px-6 py-4 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          📊 Dashboard ({selectedDashboardIds.length} terpilih)
        </h3>
        {snapshotLoading && <span className="text-xs text-cimoryBlue animate-pulse">Capturing...</span>}
      </div>

      {dashboards.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">Memuat daftar dashboard...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-48 overflow-y-auto pr-1">
          {dashboards.map(dash => (
            <label
              key={dash.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                selectedDashboardIds.includes(dash.id)
                  ? 'border-cimoryBlue bg-cimoryBlue/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedDashboardIds.includes(dash.id)}
                onChange={() => toggleDashboard(dash.id)}
                className="mt-1 w-4 h-4 text-cimoryBlue rounded focus:ring-cimoryBlue"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {dash.title}
                </p>
                {dash.department && (
                  <p className="text-xs text-gray-500">{dash.department}</p>
                )}
                {snapshots[dash.id] && (
                  <p className="text-xs text-cimoryGreen mt-1 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                    Data tersedia
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {error && selectedDashboardIds.length === 0 && (
        <p className="text-xs text-red-600 mt-2">{error}</p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">💬 Multi-Dashboard Chat</h1>
            <p className="text-sm text-white/80 mt-1">
              Tanyakan apapun tentang semua dashboard yang terhubung
            </p>
          </div>
          <button
            onClick={() => { setMessages([]); setConversationId(null); }}
            className="px-3 py-1 text-xs bg-white/20 hover:bg-white/30 rounded transition"
          >
            Clear Chat
          </button>
        </div>
      </div>

      {/* Dashboard selector */}
      <DashboardSelector />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50/50">
        {messages.length === 0 && selectedDashboardIds.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center max-w-md">
              <p className="text-lg font-medium">Mulai percakapan baru</p>
              <p className="text-sm mt-2">Pilih dashboard di atas untuk menganalisa data</p>
              <p className="text-xs mt-2 text-gray-400">
                Guna tombol checkbox untuk memilih dashboard yang ingin dijadikan sumber data.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} {...msg} />
        ))}
        {messages.length > 0 && selectedDashboardIds.length === 0 && (
          <div className="text-center py-4 text-gray-500">
            <p className="text-xs">⚠️ Pilih dashboard untuk sumber data</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-6 py-4 bg-white">
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
            disabled={loading || !input.trim() || selectedDashboardIds.length === 0}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:opacity-50 transition flex items-center gap-2"
          >
            {loading ? (
              <span className="animate-spin">↻</span>
            ) : (
              'Kirim'
            )}
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-600 mt-2 pl-1">{error}</p>
        )}
        <p className="text-xs text-gray-500 mt-2 text-center">
          📌 Data diambil langsung dari dashboard Power BI yang Anda pilih
        </p>
      </div>
    </div>
  );
}

export default UnifiedChatPanel;
