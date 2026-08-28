import { AlertTriangle, Database, Radio } from "lucide-react";

const METHOD_LABELS = {
  live_dax: "Live DAX",
  mixed: "Live + snapshot",
  snapshot: "Snapshot fallback",
  none: "Data belum tersedia",
};

export function CiaEvidenceMeta({
  retrievalMethod, confidence, sources = [], warnings = [], usage, requestId, rounds,
}) {
  if (!retrievalMethod && !sources.length && !warnings.length && !requestId) return null;
  const uniqueSources = [...new Map(sources.map((source) => [[
    source.semanticModel, source.dashboardName, source.period, ...(source.kpis || []),
  ].join('|').toLowerCase(), source])).values()].slice(0, 6);
  const warningMessage = uniqueSources.length
    ? "Sebagian proses otomatis tidak berhasil; CIA tetap menampilkan data yang berhasil dibaca."
    : "CIA belum berhasil mengambil data yang diperlukan. Coba ulangi atau periksa konfigurasi KPI.";
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {retrievalMethod && (
          <span className="flex items-center gap-1 font-medium text-cimoryBlue">
            <Radio size={12} /> {METHOD_LABELS[retrievalMethod] || retrievalMethod}
          </span>
        )}
        {confidence && <span>Keyakinan: {confidence}</span>}
        {Number.isFinite(Number(rounds)) && Number(rounds) > 0 && <span>{rounds} ronde</span>}
        {Number.isFinite(Number(usage?.totalTokens)) && (
          <span>{Number(usage.totalTokens).toLocaleString('id-ID')} token</span>
        )}
        {requestId && <span title={requestId}>Trace: {String(requestId).slice(0, 8)}</span>}
      </div>
      {uniqueSources.length > 0 && (
        <div className="mt-2 space-y-1">
          {uniqueSources.map((source, index) => (
            <div key={`${source.dashboardId || source.dashboardName}-${index}`} className="flex gap-1.5">
              <Database size={12} className="mt-0.5 shrink-0" />
              <span>
                {source.dashboardName || `Dashboard ${source.dashboardId}`}
                {source.period ? ` · ${source.period}` : ""}
                {source.kpis?.length ? ` · ${source.kpis.join(", ")}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 flex gap-1.5 text-amber-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{warningMessage}</span>
        </div>
      )}
    </div>
  );
}

export default CiaEvidenceMeta;
