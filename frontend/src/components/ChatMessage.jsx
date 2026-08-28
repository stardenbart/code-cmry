import { DashboardReference } from './DashboardReference';
import AnswerText from './AnswerText';
import CiaEvidenceMeta from './chat/CiaEvidenceMeta';

/**
 * Satu gelembung percakapan.
 *
 * `saran_dashboard` SENGAJA dipisah dari `dashboards_used`. Yang pertama adalah
 * dashboard yang DISARANKAN dibaca dan belum ditarik datanya; yang kedua adalah
 * sumber angka jawaban. Menyatukan keduanya membuat saran terbaca sebagai
 * sumber data, yaitu jawaban tanpa data yang terlihat seperti jawaban berdata.
 */
export function ChatMessage({
  role, content, dashboards_used, saran_dashboard, timestamp, onPilihSaran,
  retrievalMethod, confidence, sources, warnings, usage, requestId, rounds,
}) {
  const isUser = role === 'user';

  return (
    <div className={`px-5 py-4 ${isUser ? 'bg-cimoryBlue/5' : 'bg-white'}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {isUser ? 'Anda' : 'CIA'}
      </div>

      {/* Pertanyaan user ditampilkan apa adanya; jawaban model lewat AnswerText.
          Menjalankan perender markdown atas teks user berarti bintang atau
          backtick yang dia ketik sendiri berubah bentuk saat dikirim. */}
      <div className="text-sm leading-relaxed text-gray-800">
        {isUser ? <span className="whitespace-pre-wrap">{content}</span> : <AnswerText text={content} />}
      </div>

      {!isUser && saran_dashboard?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            Dashboard yang disarankan
          </div>
          <div className="flex flex-wrap gap-2">
            {saran_dashboard.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => d.bisaDibaca && onPilihSaran?.(d.id)}
                disabled={!d.bisaDibaca}
                title={d.bisaDibaca ? 'Pilih dan baca datanya' : 'Dashboard ini belum punya Report ID, datanya tidak bisa dibaca'}
                className={`text-left rounded-lg border px-3 py-2 text-sm transition ${
                  d.bisaDibaca
                    ? 'border-cimoryBlue/40 bg-cimoryBlue/5 hover:bg-cimoryBlue/10 hover:border-cimoryBlue'
                    : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span className="block font-medium">{d.title}</span>
                {d.department && (
                  <span className="block text-xs text-gray-500">{d.department}</span>
                )}
                {d.reason && (
                  <span className="block text-xs text-gray-500 mt-0.5">{d.reason}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isUser && dashboards_used?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 mb-2">Sumber data</div>
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

      {!isUser && (
        <CiaEvidenceMeta retrievalMethod={retrievalMethod} confidence={confidence}
          sources={sources} warnings={warnings} usage={usage} requestId={requestId} rounds={rounds} />
      )}

      {timestamp && (
        <div className="text-xs text-gray-400 mt-2">
          {new Date(timestamp).toLocaleTimeString('id-ID')}
        </div>
      )}
    </div>
  );
}
