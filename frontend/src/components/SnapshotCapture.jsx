// ─────────────────────────────────────────────────────────────────────────────
// Mounts a Power BI dashboard off-screen (exportMode=true), waits for the
// embed to render, captures its snapshot, then reports back and unmounts.
//
// Used by UnifiedChatPanel to gather snapshots from several dashboards the
// user never opened — the same capture path AskAIPanel uses for a single
// visible dashboard, just without visible UI.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from "react";
import PowerBIReport from "./PowerBIReport";
import { captureReportSnapshot } from "../utils/powerbiData";
import { extractReportGuid } from "../utils/reportGuid";

/**
 * @param {object} dashboard - { id, title, report_id, url }
 * @param {(snapshot: object|null, error: string|null) => void} onDone
 */
export default function SnapshotCapture({ dashboard, onDone }) {
  const doneRef = useRef(false);
  const guid = extractReportGuid(dashboard.report_id);

  const handleRendered = useCallback(async (report) => {
    if (doneRef.current) return; // "rendered" can fire more than once (filter changes)
    doneRef.current = true;
    try {
      const snap = await captureReportSnapshot(report, {
        maxRowsPerVisual: 200,
        allPages: false,
      });
      onDone(snap, null);
    } catch (err) {
      onDone(null, err?.message || "Gagal membaca data dashboard.");
    }
  }, [onDone]);

  if (!guid) {
    // No report GUID — can't use the token embed path, so snapshot is impossible.
    if (!doneRef.current) {
      doneRef.current = true;
      onDone(null, "Dashboard ini tidak punya Report ID (tidak bisa diakses AI).");
    }
    return null;
  }

  return (
    <div style={{ position: "fixed", top: -9999, left: -9999, width: 800, height: 600, pointerEvents: "none" }}>
      <PowerBIReport
        key={dashboard.id}
        reportId={guid}
        dashboardId={dashboard.id}
        exportMode={true}
        onReportRendered={handleRendered}
      />
    </div>
  );
}
