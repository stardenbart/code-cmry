function number(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value) || 0);
}

function percent(value) {
  return `${((Number(value) || 0) * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

function Card({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function CiaOverviewTab({ data }) {
  const totals = data?.totals || {};
  const rates = data?.rates || {};
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Total request" value={number(totals.requests)} hint={`${number(totals.activeUsers)} user aktif`} />
      <Card label="Token input" value={number(totals.inputTokens)} />
      <Card label="Token output" value={number(totals.outputTokens)} hint={`${number(totals.totalTokens)} token total`} />
      <Card label="Success rate" value={percent(rates.success)} hint={`${percent(rates.liveDax)} live DAX`} />
      <Card label="Fallback rate" value={percent(rates.fallback)} />
      <Card label="Error rate" value={percent(rates.error)} />
      <Card label="Latency rata-rata" value={data?.latency?.averageMs == null ? "-" : `${number(data.latency.averageMs)} ms`} />
      <Card label="Median latency" value={data?.latency?.medianMs == null ? "-" : `${number(data.latency.medianMs)} ms`} />
      <Card label="Latency p95" value={data?.latency?.p95Ms == null ? "-" : `${number(data.latency.p95Ms)} ms`} />
    </div>
  );
}
