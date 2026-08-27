import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowLeft, HeartPulse, Settings, ShieldCheck, Users } from "lucide-react";
import * as ciaAdminApi from "../../services/ciaAdminApi.js";

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "usage", label: "Usage Analytics", icon: Users },
  { id: "health", label: "Retrieval Health", icon: HeartPulse },
  { id: "access", label: "CIA Access", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

function LoadedSummary({ tab, data }) {
  if (tab === "overview") {
    return <p>{data?.totals?.requests || 0} request tercatat pada rentang aktif.</p>;
  }
  if (tab === "usage") {
    return <p>{data?.series?.length || 0} titik waktu penggunaan tersedia.</p>;
  }
  if (tab === "health") {
    return <p>{data?.errorsByCode?.length || 0} jenis error retrieval tercatat.</p>;
  }
  if (tab === "access") {
    return <p>{data?.total || 0} user tersedia untuk pengaturan akses CIA.</p>;
  }
  return <p>Konfigurasi CIA ditampilkan sebagai nilai runtime read-only.</p>;
}

export default function CiaAdminPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") || "overview";
  const tab = TABS.some((item) => item.id === requestedTab) ? requestedTab : "overview";
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [reload, setReload] = useState(0);

  const loader = useMemo(() => ({
    overview: () => ciaAdminApi.getOverview(),
    usage: () => ciaAdminApi.getUsage(),
    health: () => ciaAdminApi.getHealth(),
    access: () => ciaAdminApi.getAccess(),
    settings: async () => ({}),
  })[tab], [tab]);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: "" });
    loader()
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: "" });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ loading: false, data: null, error: "Gagal memuat Admin CIA." });
        }
      });
    return () => { cancelled = true; };
  }, [loader, reload]);

  const selectTab = useCallback((id) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next);
  }, [params, setParams]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/App")}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Kembali ke aplikasi"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-semibold">Admin CIA</h1>
            <p className="text-sm text-slate-500">Analytics dan kontrol operasional CIA</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <nav className="mb-6 flex gap-2 overflow-x-auto" aria-label="Menu Admin CIA">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                tab === id ? "bg-cimoryBlue text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{TABS.find((item) => item.id === tab)?.label}</h2>
          {state.loading && <p className="text-slate-500">Memuat data CIA...</p>}
          {state.error && (
            <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              <p>{state.error}</p>
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="mt-3 rounded-lg bg-red-700 px-3 py-2 font-medium text-white"
              >
                Coba lagi
              </button>
            </div>
          )}
          {!state.loading && !state.error && <LoadedSummary tab={tab} data={state.data} />}
        </section>
      </div>
    </main>
  );
}
