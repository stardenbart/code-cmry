import { useState } from "react";
import { getRequestTrace } from "../../services/ciaAdminApi.js";

function SimpleTable({ title, rows, left, right }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold">{title}</h3>
      <table className="mt-3 w-full text-left text-sm">
        <tbody>{rows.map((row, index) => <tr key={`${row[left]}-${index}`} className="border-b"><td className="p-2">{row[left] || "Tidak diketahui"}</td><td className="p-2 text-right">{row[right]}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

export default function CiaHealthTab({ data }) {
  const [requestId, setRequestId] = useState("");
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadTrace = async () => {
    if (!requestId.trim()) return;
    setLoading(true);
    setError("");
    try {
      setTrace(await getRequestTrace(requestId.trim()));
    } catch {
      setTrace(null);
      setError("Request tidak ditemukan atau gagal dimuat.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <SimpleTable title="Error berdasarkan kode" rows={data?.errorsByCode || []} left="code" right="count" />
        <SimpleTable title="Metode retrieval" rows={data?.methodSplit || []} left="method" right="count" />
        <SimpleTable title="Error berdasarkan tahap" rows={data?.stageErrors || []} left="stage" right="count" />
        <SimpleTable title="Latency berdasarkan model" rows={data?.latencyByModel || []} left="model" right="averageLatencyMs" />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Trace request</h3>
        <label className="mt-3 grid gap-1 text-sm">
          Request ID
          <div className="flex gap-2">
            <input value={requestId} onChange={(event) => setRequestId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
            <button type="button" onClick={loadTrace} disabled={loading} className="rounded-lg bg-cimoryBlue px-4 py-2 font-medium text-white disabled:opacity-50">{loading ? "Memuat..." : "Buka trace"}</button>
          </div>
        </label>
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        {trace && (
          <div className="mt-4 space-y-3">
            <p className="text-sm"><strong>Status:</strong> {trace.request?.status} | <strong>Metode:</strong> {trace.request?.retrievalMethod}</p>
            <ol className="space-y-2">{(trace.events || []).map((event) => <li key={event.sequenceNo} className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{event.sequenceNo}. {event.stage}</strong><br />{event.status}{event.errorCode ? ` - ${event.errorCode}` : ""}</li>)}</ol>
          </div>
        )}
      </section>
    </div>
  );
}
