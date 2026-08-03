// ─────────────────────────────────────────────────────────────────────────────
// Pemilih cara embed Power BI.
//
// Ringan dengan sengaja: berkas ini tidak mengimpor `powerbi-client`. Jalur
// token yang membawa SDK 355 KB itu di-lazy-import, sehingga 44 dari 46
// dashboard yang memakai iframe tidak pernah mengunduhnya.
// ─────────────────────────────────────────────────────────────────────────────

import { lazy, Suspense, useRef } from "react";
import { startDashboardTimer } from "../utils/perf";

const PowerBITokenReport = lazy(() => import("./PowerBITokenReport"));

function EmbedFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm animate-pulse">
      Loading dashboard...
    </div>
  );
}

/**
 * Jalur iframe — dipakai 44 dari 46 dashboard secara default.
 *
 * Tidak ada token yang diambil di sini, jadi tokenMs selalu 0 dan seluruh
 * waktunya adalah Power BI memuat isinya sendiri. tokenDone() sengaja tidak
 * dipanggil: memanggilnya akan menaruh seluruh durasi ke tokenMs.
 */
function PowerBIIframeEmbed({ url, dashboardId }) {
  const perfRef = useRef(null);
  if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);

  return (
    <iframe
      src={url}
      className="w-full h-full border-0"
      onLoad={() => perfRef.current?.renderDone(false)}
    />
  );
}

export default function PowerBIReport({ url, reportId, dashboardId, exportMode, onReportRendered }) {
  // Export mode ON + ada report_id → pakai embed token (support export + AI)
  if (exportMode && reportId) {
    return (
      <Suspense fallback={<EmbedFallback />}>
        <PowerBITokenReport
          reportId={reportId}
          dashboardId={dashboardId}
          onReportRendered={onReportRendered}
        />
      </Suspense>
    );
  }

  // Default → pakai public embed URL via iframe
  if (url?.startsWith("https://") || url?.startsWith("http://")) {
    return <PowerBIIframeEmbed url={url} dashboardId={dashboardId} />;
  }

  // Fallback: tidak ada url publik tapi ada report_id → pakai token
  if (reportId) {
    return (
      <Suspense fallback={<EmbedFallback />}>
        <PowerBITokenReport
          reportId={reportId}
          dashboardId={dashboardId}
          onReportRendered={onReportRendered}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
      No embed source configured.
    </div>
  );
}
