const DIMENSIONS = ["user", "department", "dashboard", "surface", "status", "retrieval_method"];

function number(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value) || 0);
}

function points(series) {
  if (!series.length) return "";
  const max = Math.max(...series.map((item) => Number(item.requests) || 0), 1);
  return series.map((item, index) => {
    const x = series.length === 1 ? 300 : 20 + (index * 560) / (series.length - 1);
    const y = 140 - ((Number(item.requests) || 0) / max) * 120;
    return `${x},${y}`;
  }).join(" ");
}

export default function CiaUsageTab({ data, dimension, onDimensionChange }) {
  const series = data?.series || [];
  const breakdown = data?.breakdown || [];
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Tren request harian</h3>
        {series.length ? (
          <svg viewBox="0 0 600 160" className="mt-4 h-48 w-full" role="img" aria-label="Grafik tren request CIA per hari">
            <polyline fill="none" stroke="currentColor" strokeWidth="3" className="text-cimoryBlue" points={points(series)} />
          </svg>
        ) : <p className="mt-3 text-sm text-slate-500">Belum ada data pada rentang ini.</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Data tabel untuk grafik tren request CIA</caption>
            <thead><tr className="border-b"><th className="p-2">Tanggal</th><th className="p-2">Request</th><th className="p-2">Token input</th><th className="p-2">Token output</th></tr></thead>
            <tbody>{series.map((row) => <tr key={row.day} className="border-b"><td className="p-2">{row.day}</td><td className="p-2">{number(row.requests)}</td><td className="p-2">{number(row.inputTokens)}</td><td className="p-2">{number(row.outputTokens)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Breakdown penggunaan</h3>
          <select value={dimension} onChange={(event) => onDimensionChange(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {DIMENSIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b"><th className="p-2">Nama</th><th className="p-2">Request</th><th className="p-2">Total token</th><th className="p-2">Latency rata-rata</th></tr></thead>
            <tbody>{breakdown.map((row) => <tr key={`${row.key}-${row.label}`} className="border-b"><td className="p-2">{row.label}</td><td className="p-2">{number(row.requests)}</td><td className="p-2">{number(row.totalTokens)}</td><td className="p-2">{row.averageLatencyMs == null ? "-" : `${number(row.averageLatencyMs)} ms`}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
