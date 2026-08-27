const LABELS = {
  CIA_TELEMETRY_ENABLED: "Pencatatan telemetry CIA",
  CIA_ADMIN_ANALYTICS_ENABLED: "Dashboard analytics CIA",
};

export default function CiaSettingsTab({ data, onOpenProvider }) {
  const flags = data?.flags || {};
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Konfigurasi efektif</h3>
        <p className="mt-1 text-sm text-slate-500">Nilai ini read-only dan dibaca dari environment backend saat ini.</p>
        <dl className="mt-4 divide-y divide-slate-100">
          {Object.entries(LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div><dt className="font-medium">{label}</dt><dd className="text-xs text-slate-500">{key}</dd></div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${flags[key] ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{flags[key] ? "Aktif" : "Nonaktif"}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-3"><dt className="font-medium">Timezone</dt><dd>{data?.timezone || "Asia/Jakarta"}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="font-medium">Batas rentang analytics</dt><dd>{data?.maxAnalyticsRangeDays || 366} hari</dd></div>
        </dl>
      </div>
      <button type="button" onClick={onOpenProvider} className="rounded-lg bg-cimoryBlue px-4 py-2 text-sm font-medium text-white">Buka Pengaturan provider AI</button>
    </div>
  );
}
