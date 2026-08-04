import { useEffect, useState } from "react";
import API from "../api/api";

const ms = (v) => (typeof v === "number" ? `${Math.round(v)} ms` : "belum ada data");

export default function PerfSummary() {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/api/perf/summary")
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message || "Gagal memuat ringkasan"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-500">Memuat ringkasan performa…</p>;
  if (error)   return <p className="text-sm text-red-600">{error}</p>;
  if (!data)   return null;

  const { appLoad, dashboard, slowest } = data;

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-cimoryBlue mb-1">Performa</h3>
      <p className="text-xs text-gray-500 mb-3">
        7 hari terakhir. p95 berarti 95% pemuatan lebih cepat dari angka ini.
        Rata-rata menyembunyikan pemuatan lambat yang justru dikeluhkan user.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-1.5 font-medium">Ukuran</th>
              <th className="py-1.5 font-medium">p50</th>
              <th className="py-1.5 font-medium">p95</th>
              <th className="py-1.5 font-medium">Sampel</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-1.5">Aplikasi siap dipakai</td>
              <td>{ms(appLoad?.p50?.appReady)}</td>
              <td>{ms(appLoad?.p95?.appReady)}</td>
              <td>{appLoad?.count ?? 0}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1.5">Ambil embed token</td>
              <td>{ms(dashboard?.p50?.tokenMs)}</td>
              <td>{ms(dashboard?.p95?.tokenMs)}</td>
              <td>{dashboard?.count ?? 0}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1.5">Power BI menampilkan dashboard</td>
              <td>{ms(dashboard?.p50?.renderMs)}</td>
              <td>{ms(dashboard?.p95?.renderMs)}</td>
              <td>{dashboard?.count ?? 0}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {typeof dashboard?.prefetchHitRate === "number" && (
        <p className="text-xs text-gray-600 mt-2">
          Token sudah siap saat diklik: {Math.round(dashboard.prefetchHitRate * 100)}% dari pembukaan dashboard.
        </p>
      )}

      {slowest?.length > 0 && (
        <>
          <h4 className="text-sm font-semibold text-gray-700 mt-5 mb-1">Dashboard paling lambat tampil</h4>
          <ul className="text-sm text-gray-700 space-y-0.5">
            {slowest.map((d) => (
              <li key={d.dashboard_id}>
                {d.title || `Dashboard #${d.dashboard_id}`}: {ms(d.p95RenderMs)} (p95, {d.samples} sampel)
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-1">
            Waktu ini dihabiskan di infrastruktur Power BI. Angka tinggi di sini
            menunjuk ke laporan yang perlu disederhanakan, bukan ke CODE.
          </p>
        </>
      )}

      {!appLoad?.count && !dashboard?.count && (
        <p className="text-sm text-gray-500">
          Belum ada data. Angka muncul setelah user membuka CODE dan dashboard.
        </p>
      )}
    </div>
  );
}
