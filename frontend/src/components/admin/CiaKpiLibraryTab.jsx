import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as ciaAdminApi from "../../services/ciaAdminApi.js";
import CiaKpiEditor from "./CiaKpiEditor.jsx";

// Tab KPI Library. Human name = teks utama; measure teknis = teks sekunder
// monospace. Deep-link ke detail lewat ?kpiId=<id>. Filter: search, domain,
// status, dashboard.
const STATUS_OPTIONS = ["", "draft", "confirmed", "deprecated"];

function StatusBadge({ status }) {
  const tone = status === "confirmed" ? "bg-green-100 text-green-800"
    : status === "deprecated" ? "bg-slate-200 text-slate-600"
    : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export default function CiaKpiLibraryTab() {
  const [params, setParams] = useSearchParams();
  const kpiId = params.get("kpiId") || "";

  const [draft, setDraft] = useState({
    q: params.get("q") || "", domain: params.get("domain") || "",
    status: params.get("status") || "", dashboardId: params.get("dashboardId") || "",
  });
  const [applied, setApplied] = useState(draft);
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  const fetchList = useCallback(() => {
    setState({ loading: true, data: null, error: "" });
    ciaAdminApi.listKpis(applied)
      .then((data) => setState({ loading: false, data, error: "" }))
      .catch(() => setState({ loading: false, data: null, error: "Gagal memuat KPI Library." }));
  }, [applied]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openKpi = (id) => {
    const next = new URLSearchParams(params);
    next.set("kpiId", String(id));
    setParams(next);
  };
  const closeKpi = () => {
    const next = new URLSearchParams(params);
    next.delete("kpiId");
    setParams(next);
  };
  const applyFilters = () => setApplied({ ...draft });
  const onKey = (e) => { if (e.key === "Enter") applyFilters(); };

  if (kpiId) {
    return <CiaKpiEditor kpiId={kpiId} onClose={closeKpi} onChanged={fetchList} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">Cari KPI
          <input name="q" value={draft.q} onKeyDown={onKey}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder="nama / sinonim / measure"
            className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-sm">Domain
          <input name="domain" value={draft.domain} onKeyDown={onKey}
            onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))}
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-sm">Status
          <select name="status" value={draft.status}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || "Semua status"}</option>)}
          </select>
        </label>
        <label className="text-sm">Dashboard (id)
          <input name="dashboardId" value={draft.dashboardId} onKeyDown={onKey}
            onChange={(e) => setDraft((d) => ({ ...d, dashboardId: e.target.value }))}
            className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1" />
        </label>
        <button type="button" onClick={applyFilters}
          className="rounded bg-cimoryBlue px-3 py-2 text-sm font-medium text-white">Terapkan</button>
      </div>

      {state.loading && <p className="text-slate-500">Memuat KPI...</p>}
      {state.error && (
        <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          <p>{state.error}</p>
          <button type="button" onClick={fetchList} className="mt-2 rounded bg-red-700 px-3 py-1 text-white">Coba lagi</button>
        </div>
      )}

      {!state.loading && !state.error && state.data && (
        <>
          <p className="mb-2 text-xs text-slate-500">{state.data.total} KPI</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {state.data.kpis.map((k) => (
              <li key={k.id}>
                <button type="button" onClick={() => openKpi(k.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                  <span>
                    <span className="block font-medium text-slate-900">{k.humanName}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {k.measureSummary || "-"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{k.domain}</span>
                    <StatusBadge status={k.status} />
                  </span>
                </button>
              </li>
            ))}
            {state.data.kpis.length === 0 && (
              <li className="px-3 py-4 text-sm text-slate-500">Tidak ada KPI cocok dengan filter.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
