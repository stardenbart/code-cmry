// ─────────────────────────────────────────────────────────────────────────────
// Embed Power BI lewat embed token.
//
// Berkas ini sendirian membawa `powerbi-client` — 355 KB ter-minify, sepertiga
// dari seluruh bundle. Ia sengaja dipisahkan dari jalur iframe: 44 dari 46
// dashboard memakai iframe dan tidak pernah menyentuh SDK ini. Jalur token
// hanya menyala saat user menghidupkan Export Mode atau membuka CIA.
//
// Konsekuensinya berkas ini HANYA boleh diimpor secara lazy. Satu impor statis
// dari mana pun akan menyeret SDK-nya kembali ke chunk utama.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { PowerBIEmbed } from "powerbi-client-react";
import { models } from "powerbi-client";
import API from "../api/api.js";
import { startDashboardTimer } from "../utils/perf";
import { takeEmbed } from "../utils/embedPrefetch";

const EMBED_SETTINGS = {
  panes: {
    filters:        { expanded: false, visible: false },
    pageNavigation: { visible: true },
  },
  bars: {
    actionBar: { visible: false },
  },
  commands: [{
    exportData: { displayOption: models.CommandDisplayOption.Enabled },
  }],
};

export default function PowerBITokenReport({ reportId, dashboardId, onReportRendered }) {
  const [embedConfig, setEmbedConfig] = useState(null);
  const [error, setError]             = useState(null);
  const reportRef = useRef(null);
  const timerRef  = useRef(null);
  const perfRef   = useRef(null);
  const hitRef    = useRef(false);

  const fetchConfig = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);

    // Sudah diambil saat kursor menyentuh kartunya. Dilewati saat ini adalah
    // pembaruan token (reportRef sudah terisi) — di situ kita justru butuh
    // token baru, bukan yang tersimpan.
    const prefetched = reportRef.current ? null : takeEmbed(reportId);
    if (prefetched) {
      hitRef.current = true;
      perfRef.current.tokenDone();
      setEmbedConfig(prefetched);
      if (timerRef.current) clearTimeout(timerRef.current);
      const ms = new Date(prefetched.tokenExpiry) - Date.now() - 5 * 60 * 1000;
      if (ms > 0) timerRef.current = setTimeout(fetchConfig, ms);
      return;
    }

    try {
      const { data } = await API.get(`/api/powerbi/embed-config-by-report/${reportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      perfRef.current.tokenDone();
      if (reportRef.current) {
        await reportRef.current.setAccessToken(data.embedToken);
      } else {
        setEmbedConfig(data);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      const msUntilRefresh = new Date(data.tokenExpiry) - Date.now() - 5 * 60 * 1000;
      if (msUntilRefresh > 0) timerRef.current = setTimeout(fetchConfig, msUntilRefresh);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Unknown error";
      setError(msg);
    }
  }, [reportId, dashboardId]);

  useEffect(() => {
    fetchConfig();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchConfig]);

  if (error) return (
    <div className="flex items-center justify-center w-full h-full text-red-500 text-sm px-4 text-center">
      {error}
    </div>
  );
  if (!embedConfig) return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm animate-pulse">
      Loading dashboard...
    </div>
  );

  return (
    <PowerBIEmbed
      embedConfig={{
        type:        "report",
        id:          embedConfig.reportId,
        embedUrl:    embedConfig.embedUrl,
        accessToken: embedConfig.embedToken,
        tokenType:   models.TokenType.Embed,
        settings:    EMBED_SETTINGS,
      }}
      eventHandlers={new Map([
        // "tokenExpired" TIDAK dipakai: nama itu tidak ada di allowedEvents
        // powerbi-client, jadi pendaftarannya ditolak dan handler-nya tak pernah
        // menyala — dulu hanya menghasilkan "Following events are invalid" di
        // konsol. Pembaruan token dijalankan setTimeout berbasis tokenExpiry;
        // handler error di bawah menangkap kasus timer telat, misalnya laptop
        // ditutup lalu dibuka lagi.
        ["error", (e) => {
          const detail = e?.detail || {};
          const tokenBasi = /token.*expir|expir.*token/i.test(
            `${detail.message || ""} ${detail.detailedMessage || ""} ${detail.errorCode || ""}`
          );
          if (tokenBasi) {
            console.warn("Power BI: token kedaluwarsa, mengambil yang baru");
            fetchConfig();
            return;
          }
          console.error("Power BI error:", detail);
        }],
        // "rendered" menyala pada cat pertama dan pada setiap perubahan
        // filter/slicer — panel AI memakainya untuk tahu data sudah berubah.
        ["rendered", () => {
          perfRef.current?.renderDone(hitRef.current);
          onReportRendered?.(reportRef.current);
        }],
      ])}
      getEmbeddedComponent={(r) => { reportRef.current = r; }}
      cssClassName="w-full h-full border-0"
    />
  );
}
