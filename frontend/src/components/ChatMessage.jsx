import { DashboardReference } from './DashboardReference';

export function ChatMessage({ role, content, dashboards_used, timestamp }) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-4 p-4 ${isUser ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex-1">
        <div className={`text-sm leading-relaxed ${isUser ? 'text-gray-800' : 'text-gray-900'}`}>
          {content}
        </div>

        {!isUser && dashboards_used && dashboards_used.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="text-xs font-semibold text-gray-600 mb-2">Sumber data:</div>
            <div className="flex flex-wrap gap-2">
              {dashboards_used.map((db) => (
                <DashboardReference
                  key={db.id}
                  id={db.id}
                  title={db.title}
                  reason={db.reason}
                  confidence={db.confidence}
                />
              ))}
            </div>
          </div>
        )}

        {timestamp && (
          <div className="text-xs text-gray-500 mt-2">
            {new Date(timestamp).toLocaleTimeString('id-ID')}
          </div>
        )}
      </div>
    </div>
  );
}
