import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { askUnified } from '../services/unifiedChatApi';

export function UnifiedChatPanel() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setLoading(true);
    setError(null);

    try {
      // TODO: Implement snapshot collection from open dashboards
      // For now, placeholder empty snapshots array
      const result = await askUnified(userMessage, conversationId, []);

      setConversationId(result.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        dashboards_used: result.dashboards_used,
        timestamp: new Date(),
      }]);
    } catch (err) {
      setError(`Error: ${err.message}`);
      setMessages(prev => prev.slice(0, -1)); // Remove user message on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Multi-Dashboard Chat</h1>
        <p className="text-sm text-gray-600 mt-1">Tanyakan apapun tentang semua dashboard</p>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium">Mulai percakapan baru</p>
              <p className="text-sm mt-2">Tanyakan tentang data dari semua dashboard</p>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} {...msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-6 py-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Tanyakan sesuatu..."
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
          >
            {loading ? 'Mengirim...' : 'Kirim'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UnifiedChatPanel;
