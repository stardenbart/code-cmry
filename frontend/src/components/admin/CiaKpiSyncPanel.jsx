import { lazy, useEffect, useRef, useState } from "react";
import * as ciaAdminApi from "../../services/ciaAdminApi.js";
import LazyBoundary from "../LazyBoundary.jsx";

// Panel sinkronisasi KPI Library. Dua langkah berurutan:
//   1. Panen metadata visual (VisualHarvestPanel — dipindah dari Manage Users).
//   2. Sinkronkan KPI Library (reconcile binding dari inventory).
// Sync berjalan di background (server balas 202 { runId }); panel polling status
// tiap 2 detik sampai terminal, lalu menampilkan created/refreshed/missing/error.
//
// VisualHarvestPanel di-lazy karena membawa SDK Power BI yang berat; hanya
// terunduh saat admin benar-benar membuka panel ini.
const VisualHarvestPanel = lazy(() => import("../VisualHarvestPanel.jsx"));

const TERMINAL = ["success", "partial", "error"];

export default function CiaKpiSyncPanel() {
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const running = starting || (run != null && !TERMINAL.includes(run.status));

  // Polling status tiap 2 detik selama run belum terminal.
  useEffect(() => {
    if (!run?.runId || TERMINAL.includes(run.status)) return undefined;
    timer.current = setTimeout(() => {
      ciaAdminApi.getKpiSyncStatus(run.runId)
        .then((data) => setRun(data))
        .catch(() => setError("Gagal memuat status sync."));
    }, 2000);
    return () => clearTimeout(timer.current);
  }, [run]);

  const startSync = async () => {
    setError("");
    setStarting(true);
    try {
      const res = await ciaAdminApi.startKpiSync(null); // semua dashboard
      setRun({ runId: res.runId, status: res.status || "running" });
    } catch (err) {
      setError(err?.response?.status === 409
        ? "Sinkronisasi lain sedang berjalan. Tunggu hingga selesai."
        : "Gagal memulai sinkronisasi.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-base font-semibold">Sinkronisasi KPI Library</h3>
      <ol className="space-y-4">
        <li>
          <p className="mb-2 text-sm font-medium">Langkah 1 - Panen metadata visual</p>
          <LazyBoundary>
            <VisualHarvestPanel />
          </LazyBoundary>
        </li>
        <li>
          <p className="mb-2 text-sm font-medium">Langkah 2 - Sinkronkan KPI Library</p>
          <button type="button" onClick={startSync} disabled={running}
            className="rounded bg-cimoryBlue px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {running ? "Sinkronisasi berjalan..." : "Sinkronkan sekarang"}
          </button>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          {run && (
            <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
              <p>Status: <span className="font-medium">{run.status}</span></p>
              {TERMINAL.includes(run.status) && (
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-slate-600 sm:grid-cols-4">
                  <li>Dibuat: {run.bindingsCreated ?? 0}</li>
                  <li>Diperbarui: {run.bindingsRefreshed ?? 0}</li>
                  <li>Missing: {run.bindingsMissing ?? 0}</li>
                  <li>Error: {(run.errors || []).length}</li>
                </ul>
              )}
            </div>
          )}
        </li>
      </ol>
    </section>
  );
}
