// ─────────────────────────────────────────────────────────────────────────────
// Panen inventaris visual, khusus admin.
//
// Kenapa lewat browser: tiga jalur otomatis untuk membaca ikatan visual sudah
// dicoba dan tertutup. Fabric getDefinition menjawab 403 karena app registration
// tidak punya scope-nya, Export .pbix menjawab 400 untuk model Premium Files,
// dan INFO.MEASURES() menjawab 400. Yang tersisa adalah SDK di browser, yang
// memang sudah dipakai fitur AI dan terbukti jalan.
//
// Hasilnya menentukan measure mana yang boleh masuk katalog KPI. Tanpa ini,
// katalog akan memuat measure yang ada di model tapi tidak pernah dirender,
// termasuk sisa percobaan DAX, dan angkanya keluar tanpa error apa pun.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { models, service, factories } from "powerbi-client";
import { Play, Square, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import API from "../api/api";
import { panenFieldReport } from "../utils/visualHarvest";
import { useToast } from "./ToastProvider";

/** Satu instance service dipakai ulang untuk seluruh siklus panen. */
const powerbi = new service.Service(
  factories.hpmFactory,
  factories.wpmpFactory,
  factories.routerFactory
);

export default function VisualHarvestPanel() {
  const toast = useToast();
  const [rencana, setRencana] = useState(null);
  const [status, setStatus] = useState(null);
  const [jalan, setJalan] = useState(false);
  const [kini, setKini] = useState("");
  const [log, setLog] = useState([]);

  // Ref, bukan state: dibaca di dalam loop yang berjalan sinkron terhadap
  // render, dan state akan terbaca sebagai nilai lama dari closure.
  const berhentiRef = useRef(false);
  const wadahRef = useRef(null);

  const tulis = (pesan) =>
    setLog((l) => [...l.slice(-200), `${new Date().toLocaleTimeString("id-ID")}  ${pesan}`]);

  const muat = async () => {
    try {
      const [r, s] = await Promise.all([
        API.get("/api/summary/harvest-plan"),
        API.get("/api/summary/harvest-status"),
      ]);
      setRencana(r.data);
      setStatus(s.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Gagal memuat rencana panen");
    }
  };

  useEffect(() => {
    muat();
  }, []);

  async function panenSatu(d) {
    setKini(d.title);
    tulis(`mulai: ${d.title}`);

    const { data: cfg } = await API.get(`/api/powerbi/embed-config-by-report/${d.reportId}`);

    const wadah = wadahRef.current;
    // Wadah dibersihkan tiap dashboard. Tanpa ini, embed berikutnya menumpuk di
    // iframe yang sama dan getPages() bisa mengembalikan halaman report lama.
    powerbi.reset(wadah);

    const report = powerbi.embed(wadah, {
      type: "report",
      id: d.reportId,
      embedUrl: cfg.embedUrl,
      accessToken: cfg.embedToken,
      tokenType: models.TokenType.Embed,
      permissions: models.Permissions.Read,
      settings: {
        panes: { filters: { visible: false }, pageNavigation: { visible: false } },
        // exportData harus diaktifkan eksplisit, kalau tidak setiap visual
        // menolak dengan pesan yang terlihat seperti masalah izin.
        commands: [{ exportData: { displayOption: models.CommandDisplayOption.Enabled } }],
      },
    });

    await new Promise((resolve, reject) => {
      const batas = setTimeout(() => reject(new Error("report tidak selesai render dalam 90 detik")), 90_000);
      report.off("rendered");
      report.on("rendered", () => {
        clearTimeout(batas);
        resolve();
      });
      report.off("error");
      report.on("error", (e) => {
        clearTimeout(batas);
        reject(new Error(e?.detail?.message || "report gagal dimuat"));
      });
    });

    const visuals = await panenFieldReport(report, (p) => tulis(`  ${p}`));
    const jumlahField = visuals.reduce((n, v) => n + v.fields.length, 0);
    const ditolak = visuals.filter((v) => v.error).length;

    const { data } = await API.post("/api/summary/visual-usage", {
      dashboardId: d.id,
      reportId: d.reportId,
      visuals,
    });

    tulis(
      `selesai: ${d.title}, ${visuals.length} visual, ${jumlahField} field, ` +
        `${data.fieldUnik} unik tersimpan${ditolak ? `, ${ditolak} visual menolak export` : ""}`
    );
    powerbi.reset(wadah);
  }

  async function mulai() {
    if (!rencana?.dashboards?.length) return;
    berhentiRef.current = false;
    setJalan(true);
    setLog([]);
    let sukses = 0;
    let gagal = 0;

    for (const d of rencana.dashboards) {
      if (berhentiRef.current) {
        tulis("dihentikan oleh admin");
        break;
      }
      try {
        await panenSatu(d);
        sukses += 1;
      } catch (err) {
        gagal += 1;
        // Satu dashboard gagal tidak menghentikan sisanya. Report yang
        // menolak render biasanya karena report ID-nya menunjuk ke laporan
        // yang sudah dihapus, dan itu justru temuan yang berguna.
        tulis(`GAGAL: ${d.title}, ${err?.message || "tidak diketahui"}`);
      }
    }

    setJalan(false);
    setKini("");
    await muat();
    if (gagal === 0) toast.success(`Panen selesai: ${sukses} dashboard`);
    else toast.error(`Panen selesai: ${sukses} berhasil, ${gagal} gagal. Lihat log.`);
  }

  const belumDipanen = rencana?.dashboards?.filter((d) => d.fieldTerpanen === 0).length ?? 0;

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-cimoryBlue mb-1">Inventaris visual dashboard</h3>
      <p className="text-xs text-gray-500 mb-3">
        Mencatat field yang benar-benar tampil di setiap visual. Ini yang menentukan
        measure mana yang boleh dipakai executive summary harian, supaya angkanya
        bukan sisa percobaan DAX yang tidak pernah dirender.
      </p>

      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
          <Kotak
            label="Dashboard dipanen"
            nilai={`${status.dashboard.sudahDipanen} / ${status.dashboard.bisaDipanen}`}
            catatan={`${status.dashboard.total} total`}
          />
          <Kotak
            label="Measure di model"
            nilai={status.measure.terpanenDariModel}
            catatan={`${status.measure.model} model`}
          />
          <Kotak
            label="Terlihat di visual"
            nilai={status.measure.terlihatDiVisual}
            catatan={`${status.measure.tidakTerlihatDiVisual} tidak terlihat`}
          />
          <Kotak
            label="Field bukan measure"
            nilai={status.field.bukanMeasure}
            catatan="kolom dimensi atau nama diganti"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={mulai}
          disabled={jalan || !rencana?.dashboards?.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cimoryBlue px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Play size={15} />
          {belumDipanen > 0 ? `Panen ${rencana?.dashboards?.length ?? 0} dashboard` : "Panen ulang semua"}
        </button>

        {jalan && (
          <button
            onClick={() => {
              berhentiRef.current = true;
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100"
          >
            <Square size={15} />
            Hentikan setelah dashboard ini
          </button>
        )}

        <button
          onClick={muat}
          disabled={jalan}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw size={15} />
          Segarkan
        </button>

        {jalan && kini && <span className="text-sm text-gray-600">Sedang memanen: {kini}</span>}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Panen membuka setiap dashboard satu per satu di latar dan berpindah antar
        halamannya, jadi butuh beberapa menit. Jangan tutup halaman ini selama
        berjalan. Panen ulang hanya menambah dan menyegarkan, tidak pernah
        mengurangi inventaris yang sudah ada.
      </p>

      {rencana?.dashboards?.length > 0 && (
        <div className="max-h-40 overflow-y-auto border rounded-lg mb-3">
          <table className="w-full text-xs">
            <tbody>
              {rencana.dashboards.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="p-1.5">{d.title}</td>
                  <td className="p-1.5 text-right text-gray-500">
                    {d.fieldTerpanen > 0 ? (
                      <span className="inline-flex items-center gap-1 text-green-700">
                        <CheckCircle2 size={12} />
                        {d.fieldTerpanen} field
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <AlertTriangle size={12} />
                        belum dipanen
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <pre className="max-h-48 overflow-y-auto rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700">
          {log.join("\n")}
        </pre>
      )}

      {/* Wadah embed. Tidak boleh display:none: Power BI tidak merender report di
          elemen yang tidak punya ukuran, dan exportData akan mengembalikan kosong.
          Karena itu dipindahkan ke luar layar dengan ukuran nyata. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-10000px",
          top: 0,
          width: "1280px",
          height: "800px",
          pointerEvents: "none",
        }}
      >
        <div ref={wadahRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

function Kotak({ label, nilai, catatan }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-800 leading-tight">{nilai}</p>
      <p className="text-[11px] text-gray-500">{catatan}</p>
    </div>
  );
}
