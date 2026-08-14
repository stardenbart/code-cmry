import { X } from 'lucide-react';
import UnifiedChatPanel from './UnifiedChatPanel';

export default function UnifiedChatModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      {/* Modal container */}
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">💬 Multi-Dashboard Chat</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Close"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Chat panel */}
        <div className="flex-1 overflow-hidden">
          <UnifiedChatPanel />
        </div>
      </div>
    </div>
  );
}
