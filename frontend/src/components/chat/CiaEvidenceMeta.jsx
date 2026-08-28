import { AlertTriangle, Database, Radio } from "lucide-react";

const METHOD_LABELS = {
  live_dax: "Live DAX",
  mixed: "Live + snapshot",
  snapshot: "Snapshot fallback",
  none: "Data belum tersedia",
};

export function CiaEvidenceMeta({ retrievalMethod, confidence, sources = [], warnings = [] }) {
  if (!retrievalMethod && !sources.length && !warnings.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {retrievalMethod && (
          <span className="flex items-center gap-1 font-medium text-cimoryBlue">
            <Radio size={12} /> {METHOD_LABELS[retrievalMethod] || retrievalMethod}
          </span>
        )}
        {confidence && <span>Keyakinan: {confidence}</span>}
      </div>
      {sources.length > 0 && (
        <div className="mt-2 space-y-1">
          {sources.map((source, index) => (
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
          <span>{warnings.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

export default CiaEvidenceMeta;
