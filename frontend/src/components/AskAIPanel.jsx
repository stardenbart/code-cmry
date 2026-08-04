import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Send, X, RefreshCw, AlertTriangle, Database,
  Trash2, Loader2, Filter, KeyRound, ChevronDown, ChevronUp, Layers, Gauge, Cpu, RotateCcw, ShieldCheck,
} from "lucide-react";
import API from "../api/api";
import { captureReportSnapshot, summarizeSnapshot, listReportPages } from "../utils/powerbiData";
import { CopyButton } from "./CodeAINavigator";
import { useConfirm } from "./ConfirmProvider";

// ── Tiny markdown renderer (bold, bullets, numbered lists, headings) ─────────
function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-cimoryBlue">{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={`${keyPrefix}-c${i}`} className="bg-gray-100 rounded px-1 text-[11px] font-mono">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{part}</React.Fragment>;
  });
}

function AnswerText({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1" />;

        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return <p key={i} className="font-semibold text-cimoryBlue mt-1">{renderInline(heading[1], i)}</p>;
        }

        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-cimoryRed leading-5 shrink-0">•</span>
              <span className="flex-1">{renderInline(bullet[1], i)}</span>
            </div>
          );
        }

        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-cimoryBlue font-semibold shrink-0">{numbered[1]}.</span>
              <span className="flex-1">{renderInline(numbered[2], i)}</span>
            </div>
          );
        }

        return <p key={i}>{renderInline(line, i)}</p>;
      })}
    </div>
  );
}

// ── Suggested starter questions ───────────────────────────────────────────────
const SUGGESTIONS = [
  "Ringkas kondisi dashboard ini dalam 3 poin utama",
  "Apa angka tertinggi dan terendah yang terlihat?",
  "Tren-nya naik atau turun? Jelaskan pakai angkanya",
  "Bagian mana yang paling perlu diperbaiki dan kenapa?",
];

const SNAPSHOT_ROWS_NORMAL = 500;
const SNAPSHOT_ROWS_DEEP = 2000;

const TIER_OPTIONS = [
  { value: "auto",     label: "Otomatis",  hint: "sistem pilih sesuai jenis pertanyaan" },
  { value: "cepat",    label: "Cepat",     hint: "±1 detik, untuk pertanyaan angka" },
  { value: "standar",  label: "Standar",   hint: "perbandingan & tren" },
  { value: "mendalam", label: "Mendalam",  hint: "akar masalah & rekomendasi" },
];

// ── Quota bar ────────────────────────────────────────────────────────────────
// The percentage is an estimate from our own counters — the Gemini API returns no
// remaining-quota figure. Labelled as such so nobody treats it as authoritative.
function QuotaBar({ quota }) {
  if (!quota?.overall) return null;

  const pct = quota.overall.remainingPct;
  const tone =
    pct > 40 ? { bar: "bg-green-500", text: "text-green-700" }
    : pct > 15 ? { bar: "bg-yellow-500", text: "text-yellow-700" }
    : pct > 5 ? { bar: "bg-orange-500", text: "text-orange-700" }
    : { bar: "bg-red-500", text: "text-red-700" };

  const resetWib = quota.resetAt
    ? new Date(quota.resetAt).toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="px-3 py-2 border-b border-gray-100 bg-white text-[10.5px]">
      <div className="flex items-center gap-2">
        <Gauge size={12} className={`${tone.text} shrink-0`} />
        <span className="text-gray-600 shrink-0">Kuota hari ini</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden min-w-[40px]">
          <div className={`h-full ${tone.bar} transition-all duration-500`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <span className={`font-semibold ${tone.text} shrink-0`}>{pct}%</span>
        <span className="text-gray-500 shrink-0">≈ {quota.overall.questionsLeft} pertanyaan</span>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[9.5px] text-gray-400 flex-wrap">
        {quota.perTier?.map((t) => (
          <span
            key={t.tier}
            title={`${t.used} dari ${t.limit} permintaan hari ini${t.rpm ? ` · ${t.rpm.used}/${t.rpm.limit} per menit` : ""}${t.limitAdjusted ? " · limit dikoreksi otomatis setelah kena 429" : ""}`}
            className={t.remainingPct <= 20 ? "text-amber-600" : ""}
          >
            {t.tier} <span className="font-medium">{t.used}/{t.limit}</span>
            {t.limitAdjusted && <span className="text-amber-500">*</span>}
          </span>
        ))}
        {resetWib && <span className="ml-auto">Reset {resetWib} WIB</span>}
      </div>

      {/* The overall bar is dominated by the two 500/day tiers, which would hide a
          deep tier that only gets 20/day. Called out separately. */}
      {quota.mostConstrained && quota.mostConstrained.remainingPct <= 40 && (
        <p className="mt-1 text-[9.5px] text-amber-700">
          Tier <b>{quota.mostConstrained.tier}</b> tinggal{" "}
          <b>{quota.mostConstrained.limit - quota.mostConstrained.used}</b> dari {quota.mostConstrained.limit}.
          Pertanyaan analitis akan dialihkan ke tier yang lebih hemat.
        </p>
      )}

      {quota.shared && (
        <p className="mt-1 text-[9.5px] text-gray-400">
          Memakai kunci bersama, kuota ini dibagi dengan semua user. Simpan kunci
          pribadi di Pengaturan CODE AI untuk jatah sendiri.
        </p>
      )}
    </div>
  );
}

const AskAIPanel = React.forwardRef(function AskAIPanel({
  dashboard,          // { id, title, department }
  report,             // powerbi-client Report instance (embed-token mode)
  reportReady,        // boolean — report finished rendering
  renderNonce,        // increments on every Power BI "rendered" event
  initialQuestion,    // carried over from the CODE AI Navigator
  hideHeader,         // parent renders the header (unified with the site header)
  onClose,
  onOpenSettings,
}, ref) {
  // Hook dipanggil di dalam badan komponen seperti biasa, meski komponennya
  // dibungkus forwardRef.
  const confirm = useConfirm();
  const [messages, setMessages]   = useState([]);   // [{ role, text, meta?, error? }]
  const [question, setQuestion]   = useState("");
  const [asking, setAsking]       = useState(false);
  const [snapshot, setSnapshot]   = useState(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState(null);
  const [deepMode, setDeepMode]   = useState(false);
  const [status, setStatus]       = useState(null);
  const [showData, setShowData]   = useState(false);
  const [stale, setStale]         = useState(false);
  const [pages, setPages]         = useState([]);          // [{ name, isActive }]
  const [selectedPages, setSelectedPages] = useState([]);  // page names to read
  const [showPages, setShowPages] = useState(false);
  const [progress, setProgress]   = useState(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [quota, setQuota]         = useState(null);
  const [tier, setTier]           = useState("auto");

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Render-event bookkeeping ────────────────────────────────────────────────
  // Reading a non-active page requires activating it, which makes Power BI emit
  // "rendered" — i.e. our own capture bumps renderNonce. Without these guards the
  // panel treats that as "the user changed something", re-captures, and loops
  // forever while the report visibly flips between pages.
  const nonceRef      = useRef(renderNonce);  // nonce of the current snapshot
  const latestNonce   = useRef(renderNonce);  // most recent nonce seen
  const capturingRef  = useRef(false);        // a capture is in flight
  const autoCapturedFor = useRef(null);       // report instance already auto-captured
  const refreshRef    = useRef(null);         // latest refreshSnapshot, dependency-free

  useEffect(() => { latestNonce.current = renderNonce; }, [renderNonce]);

  const stats = useMemo(() => (snapshot ? summarizeSnapshot(snapshot) : null), [snapshot]);

  // ── AI availability + quota ────────────────────────────────────────────────
  useEffect(() => {
    API.get("/api/ai/status")
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ enabled: false }));
    API.get("/api/ai/quota")
      .then(({ data }) => setQuota(data))
      .catch(() => {});
  }, []);

  // ── Load previous conversation for this dashboard ───────────────────────────
  useEffect(() => {
    if (!dashboard?.id) return;
    API.get(`/api/ai/history/${dashboard.id}`)
      .then(({ data }) => {
        const restored = (data || []).flatMap((row) => [
          { role: "user", text: row.question },
          { role: "ai", text: row.answer, meta: { model: row.model, restored: true } },
        ]);
        setMessages(restored);
      })
      .catch(() => {});
  }, [dashboard?.id]);

  // ── Page list (for the picker) ──────────────────────────────────────────────
  // Keyed on the report instance only. Page names don't change while embedded, and
  // depending on renderNonce here is what fed the re-capture loop.
  useEffect(() => {
    if (!report) return;
    let cancelled = false;

    listReportPages(report).then((list) => {
      if (cancelled) return;
      setPages(list);
      setSelectedPages((prev) => {
        const kept = prev.filter((n) => list.some((p) => p.name === n));
        // Preserve array identity when nothing actually changed — a new array here
        // would invalidate refreshSnapshot and retrigger capture.
        if (kept.length === prev.length && kept.every((n, i) => n === prev[i])) return prev;
        if (kept.length) return kept;
        const active = list.find((p) => p.isActive) || list[0];
        return active ? [active.name] : [];
      });
    });

    return () => { cancelled = true; };
  }, [report]);

  const togglePage = (name) =>
    setSelectedPages((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );

  const allSelected = pages.length > 0 && selectedPages.length === pages.length;

  const toggleAllPages = () => {
    if (allSelected) {
      const active = pages.find((p) => p.isActive) || pages[0];
      setSelectedPages(active ? [active.name] : []);
    } else {
      setSelectedPages(pages.map((p) => p.name));
    }
  };

  // ── Capture the on-screen data ─────────────────────────────────────────────
  const refreshSnapshot = useCallback(async () => {
    if (!report || capturingRef.current) return;   // never re-enter
    capturingRef.current = true;
    setSnapLoading(true);
    setSnapError(null);
    try {
      const snap = await captureReportSnapshot(report, {
        maxRowsPerVisual: deepMode ? SNAPSHOT_ROWS_DEEP : SNAPSHOT_ROWS_NORMAL,
        pageNames: selectedPages,
        activateIfNeeded: autoSwitch,
        onProgress: setProgress,
      });
      setSnapshot(snap);
      const s = summarizeSnapshot(snap);
      if (!s.visualCount) {
        setSnapError(
          "Tidak ada visual yang bisa diekspor. Pastikan dashboard ini punya Report ID dan Export Data diizinkan di Power BI."
        );
      } else if (s.failed > 0) {
        setSnapError(
          `${s.failed} visual tidak bisa diekspor (biasanya custom visual). Sisanya tetap dipakai AI.`
        );
      }
    } catch (err) {
      setSnapError(err?.message || "Gagal membaca data dashboard.");
    } finally {
      // Adopt every render event seen during the capture as "ours", so restoring
      // the original page doesn't immediately mark the fresh snapshot as stale.
      nonceRef.current = latestNonce.current;
      setStale(false);
      setSnapLoading(false);
      setProgress(null);
      capturingRef.current = false;

      // Power BI can emit a trailing "rendered" just after the restore settles.
      setTimeout(() => {
        if (!capturingRef.current) {
          nonceRef.current = latestNonce.current;
          setStale(false);
        }
      }, 1200);
    }
    // renderNonce is read via refs, never as a dependency — otherwise each render
    // event would rebuild this callback and retrigger the capture effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, deepMode, selectedPages, autoSwitch]);

  // Keep a dependency-free handle for effects that must not re-run on config change
  useEffect(() => { refreshRef.current = refreshSnapshot; }, [refreshSnapshot]);

  // Auto-capture exactly once per report instance
  useEffect(() => {
    if (!reportReady || !report) return;
    if (autoCapturedFor.current === report) return;
    autoCapturedFor.current = report;
    refreshRef.current?.();
  }, [reportReady, report]);

  // Power BI re-rendered (user changed a filter/slicer/page) → snapshot outdated.
  // Render events produced by our own capture are ignored.
  useEffect(() => {
    if (capturingRef.current) return;
    if (renderNonce !== nonceRef.current && snapshot) setStale(true);
  }, [renderNonce, snapshot]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, asking]);

  // ── Ask ────────────────────────────────────────────────────────────────────
  const ask = async (text) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;

    setQuestion("");
    // Keep the asked text on the pair so "Tanya ulang" can replay it verbatim
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setAsking(true);

    let payloadSnapshot = snapshot;
    if (!payloadSnapshot && report) {
      // First question before the snapshot finished — grab it now
      try {
        payloadSnapshot = await captureReportSnapshot(report, {
          maxRowsPerVisual: deepMode ? SNAPSHOT_ROWS_DEEP : SNAPSHOT_ROWS_NORMAL,
          pageNames: selectedPages,
        });
        setSnapshot(payloadSnapshot);
      } catch { /* handled by the backend guard below */ }
    }

    try {
      const { data } = await API.post("/api/ai/ask", {
        dashboardId: dashboard.id,
        question: q,
        snapshot: payloadSnapshot,
        tier,
      });
      setMessages((prev) => [...prev, { role: "ai", text: data.answer, meta: data.meta, sourceQuestion: q }]);
      if (data.meta?.quota) setQuota((prev) => ({ ...prev, ...data.meta.quota }));
    } catch (err) {
      const payload = err?.response?.data;
      if (payload?.quota) setQuota((prev) => ({ ...prev, ...payload.quota }));
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          error: true,
          sourceQuestion: q,
          text: payload?.message || err.message || "Gagal menghubungi CODE AI.",
        },
      ]);
    } finally {
      setAsking(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = async () => {
    const setuju = await confirm({
      judul: "Hapus riwayat chat",
      pesan: "Seluruh percakapan CODE AI untuk dashboard ini akan dihapus.",
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    try {
      await API.delete(`/api/ai/history/${dashboard.id}`);
    } catch { /* non-fatal */ }
    setMessages([]);
  };

  // Lets the unified header (rendered by the parent) drive the panel
  React.useImperativeHandle(ref, () => ({ clearChat, ask }), [clearChat, ask]);

  // A question carried over from the Navigator is asked once, as soon as the
  // snapshot is ready — the user already typed it on the home screen.
  const carriedRef = useRef(null);
  useEffect(() => {
    if (!initialQuestion || carriedRef.current === initialQuestion) return;
    if (asking) return;
    // Wait for a snapshot that actually has rows — firing on an empty one would
    // greet the user with "data belum berhasil dibaca" for a question they never
    // saw themselves type.
    if (!snapshot || !stats?.visualCount) return;
    carriedRef.current = initialQuestion;
    ask(initialQuestion);
    // ask/snapshot identities change every render; this must fire exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, snapshot, stats?.visualCount]);

  const aiDisabled = status && !status.enabled;

  return (
    <div className="flex flex-col h-full w-full bg-white border-l border-gray-200 shadow-2xl">

      {/* When the parent renders a unified header, this one is hidden from `sm`
          up — but kept on small screens, where the unified bar has no room for
          it. CSS rather than a boolean, so exactly one header shows at every
          breakpoint without a resize listener. */}
      {(
        <div className={`${hideHeader ? "sm:hidden " : ""}flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white shrink-0`}>
          <Sparkles size={17} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">CODE AI</p>
            <p className="text-[11px] text-white/70 truncate">{dashboard?.title}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={onOpenSettings} title="Pengaturan CODE AI" className="p-1.5 rounded-lg hover:bg-white/20">
              <KeyRound size={15} />
            </button>
            <button onClick={clearChat} title="Hapus riwayat" className="p-1.5 rounded-lg hover:bg-white/20">
              <Trash2 size={15} />
            </button>
            <button onClick={onClose} title="Tutup" className="p-1.5 rounded-lg hover:bg-white/20">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <QuotaBar quota={quota} />

      {/* ── Data snapshot bar ── */}
      <div className="px-3 py-2 bg-sky-50 border-b border-sky-100 text-[11px] text-gray-600 shrink-0">
        <div className="flex items-center gap-2">
          <Database size={12} className="text-sky-600 shrink-0" />
          {snapLoading ? (
            <span className="flex items-center gap-1.5 text-sky-700 truncate">
              <Loader2 size={11} className="animate-spin shrink-0" />
              {progress || "Membaca data dashboard…"}
            </span>
          ) : stats?.visualCount ? (
            <span className="truncate">
              <span className="font-semibold text-sky-800">{stats.visualCount} visual</span>
              {" · "}
              <span className="font-semibold text-sky-800">{stats.rowCount.toLocaleString("id-ID")} baris</span>
              {stats.pagesRead?.length > 1
                ? <> · <span className="font-semibold text-sky-800">{stats.pagesRead.length} halaman</span></>
                : stats.pagesRead?.[0] && <> · halaman <span className="italic">{stats.pagesRead[0]}</span></>}
              {stats.failed > 0 && <> · <span className="text-amber-600">{stats.failed} gagal</span></>}
            </span>
          ) : (
            <span className="text-gray-500">Belum ada data</span>
          )}

          <button
            onClick={refreshSnapshot}
            disabled={snapLoading || !report}
            title="Ambil ulang data sesuai filter yang sedang aktif"
            className={`ml-auto flex items-center gap-1 px-2 py-1 rounded-md border disabled:opacity-50 shrink-0 ${
              stale
                ? "bg-amber-500 border-amber-500 text-white hover:bg-amber-600 animate-pulse"
                : "bg-white border-sky-200 hover:bg-sky-100"
            }`}
          >
            <RefreshCw size={11} className={snapLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {stale && !snapLoading && (
          <p className="mt-1.5 flex items-start gap-1.5 text-amber-700">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            Tampilan dashboard berubah (filter/halaman). Klik Refresh supaya AI pakai data terbaru.
          </p>
        )}

        {stats?.filters?.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <Filter size={11} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="line-clamp-2 text-gray-500">{stats.filters.join(" • ")}</p>
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={deepMode} onChange={(e) => setDeepMode(e.target.checked)} className="accent-cimoryBlue" />
            Deep mode ({SNAPSHOT_ROWS_DEEP} baris/visual)
          </label>

          {pages.length > 1 && (
            <button
              onClick={() => setShowPages((v) => !v)}
              className="flex items-center gap-1 text-sky-700 hover:underline"
              title="Pilih halaman report yang ikut dibaca AI"
            >
              <Layers size={10} />
              Halaman: <span className="font-semibold">{selectedPages.length}/{pages.length}</span>
              {showPages ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}

          {stats?.truncated && (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle size={10} /> data terpotong
            </span>
          )}
        </div>

        {/* Page picker */}
        {showPages && pages.length > 1 && (
          <div className="mt-1.5 rounded-md bg-white border border-sky-100 p-2">
            <div className="flex items-center justify-between mb-1">
              <button onClick={toggleAllPages} className="text-[10px] font-medium text-sky-700 hover:underline">
                {allSelected ? "Cuma halaman aktif" : "Pilih semua halaman"}
              </button>
              <span className="text-[9.5px] text-gray-400">
                makin banyak halaman, makin lama & makin besar kuota
              </span>
            </div>

            <label className="flex items-start gap-1.5 text-[10px] text-gray-600 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSwitch}
                onChange={(e) => setAutoSwitch(e.target.checked)}
                className="accent-cimoryBlue mt-0.5"
              />
              <span>
                Boleh pindah halaman sebentar saat membaca
                <span className="text-gray-400"> (Power BI kadang menolak export halaman yang belum pernah dibuka. Halamanmu dikembalikan setelah selesai. Matikan kalau tampilan berpindah terasa mengganggu (halaman yang menolak akan dilaporkan gagal).</span>
              </span>
            </label>
            <div className="max-h-32 overflow-auto space-y-0.5">
              {pages.map((p) => (
                <label key={p.name} className="flex items-center gap-1.5 text-[10.5px] cursor-pointer hover:bg-sky-50 rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedPages.includes(p.name)}
                    onChange={() => togglePage(p.name)}
                    className="accent-cimoryBlue"
                  />
                  <span className="truncate">{p.name}</span>
                  {p.isActive && <span className="text-[9px] text-sky-600 shrink-0">(dibuka)</span>}
                </label>
              ))}
            </div>
            <button
              onClick={refreshSnapshot}
              disabled={snapLoading || !selectedPages.length}
              className="mt-1.5 w-full py-1 rounded-md bg-cimoryBlue text-white text-[10.5px] font-medium hover:bg-cimoryRed disabled:opacity-40"
            >
              Baca {selectedPages.length} halaman
            </button>
          </div>
        )}

        {snapError && (
          <p className="mt-1.5 flex items-start gap-1.5 text-amber-700">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {snapError}
          </p>
        )}

        {stats?.visualCount > 0 && (
          <>
            <button
              onClick={() => setShowData((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-sky-700 hover:underline"
            >
              {showData ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {showData ? "Sembunyikan" : "Lihat"} data yang dibaca AI
            </button>
            {showData && (
              <div className="mt-1 max-h-40 overflow-auto rounded-md bg-white border border-sky-100 p-2 space-y-1">
                {snapshot.visuals.map((v, i) => (
                  <div key={i} className="text-[10px]">
                    {v.pageName && <span className="text-sky-600">{v.pageName} › </span>}
                    <span className="font-semibold text-gray-700">{v.title || "(tanpa judul)"}</span>
                    <span className="text-gray-400"> [{v.type}]</span>
                    {v.error
                      ? <span className="text-amber-600">: {v.error}</span>
                      : <span className="text-gray-500">: {v.rowCount} baris × {v.columns.length} kolom</span>}
                  </div>
                ))}
                {snapshot.pageNotes?.map((note, i) => (
                  <div key={`n${i}`} className="text-[10px] text-gray-400 italic">{note}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── AI not configured ── */}
      {aiDisabled && (
        <div className="m-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 shrink-0">
          <p className="font-semibold flex items-center gap-1.5 mb-1">
            <AlertTriangle size={13} /> Akses CODE AI belum diatur
          </p>
          <p className="mb-2">
            Ambil API key gratis di{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline font-medium">
              Google AI Studio
            </a>
            , lalu simpan di menu AI Settings.
          </p>
          <button onClick={onOpenSettings} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700">
            Buka AI Settings
          </button>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !asking && (
          <div className="text-center py-6">
            <Sparkles size={26} className="mx-auto text-cimoryBlue/40 mb-2" />
            <p className="text-sm font-medium text-gray-600">Tanya apa saja soal dashboard ini</p>
            <p className="text-[11px] text-gray-400 mt-1 px-4">
              AI menjawab hanya dari angka yang sedang tampil, termasuk filter/slicer yang kamu pilih.
            </p>
            <div className="mt-4 flex flex-col gap-1.5 px-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  disabled={aiDisabled}
                  className="text-left text-[11.5px] px-3 py-2 rounded-xl border border-gray-200 hover:border-cimoryBlue hover:bg-sky-50 text-gray-600 transition disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[88%] bg-cimoryBlue text-white rounded-2xl rounded-br-sm px-3 py-2 text-[12.5px] whitespace-pre-wrap">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div
                className={`max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-[12.5px] leading-relaxed ${
                  m.error
                    ? "bg-red-50 border border-red-200 text-red-700"
                    : "bg-gray-50 border border-gray-200 text-gray-700"
                }`}
              >
                {m.error ? (
                  <>
                    <p className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{m.text}</p>
                    {m.sourceQuestion && (
                      <button
                        onClick={() => ask(m.sourceQuestion)}
                        disabled={asking}
                        className="mt-1.5 flex items-center gap-1 text-[10.5px] text-red-700 hover:underline disabled:opacity-50"
                      >
                        <RotateCcw size={11} /> Coba lagi
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-1">
                      <div className="flex-1 min-w-0"><AnswerText text={m.text} /></div>
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <CopyButton text={m.text} className="mt-0.5" />
                        {m.sourceQuestion && (
                          <button
                            onClick={() => ask(m.sourceQuestion)}
                            disabled={asking}
                            title="Tanyakan ulang pertanyaan yang sama dengan data terbaru"
                            className="p-1 rounded hover:bg-gray-200 text-gray-400 disabled:opacity-40"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Dead end → concrete next step, instead of leaving the user stuck */}
                    {m.meta?.needsMoreData && (
                      <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
                        <p className="text-[10.5px] text-amber-800">
                          {m.meta.needsMoreData.suggest === "pages"
                            ? <>Data yang dicari mungkin ada di halaman lain
                                {m.meta.needsMoreData.unreadPages?.length > 0 && (
                                  <> (<span className="italic">{m.meta.needsMoreData.unreadPages.slice(0, 3).join(", ")}</span>)</>
                                )}. Centang halamannya di <b>Halaman</b>, lalu ambil ulang datanya.</>
                            : <>Semua halaman sudah dibaca. Coba ubah <b>filter/slicer</b> di dashboard (mis. periode), lalu ambil ulang datanya.</>}
                        </p>
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={refreshSnapshot}
                            disabled={snapLoading || !report}
                            className="flex items-center gap-1 bg-amber-500 text-white text-[10.5px] font-medium px-2 py-1 rounded-md hover:bg-amber-600 disabled:opacity-50"
                          >
                            <RefreshCw size={11} className={snapLoading ? "animate-spin" : ""} /> Ambil ulang data
                          </button>
                          {m.sourceQuestion && (
                            <button
                              onClick={() => ask(m.sourceQuestion)}
                              disabled={asking || snapLoading}
                              className="flex items-center gap-1 bg-white border border-amber-300 text-amber-700 text-[10.5px] font-medium px-2 py-1 rounded-md hover:bg-amber-100 disabled:opacity-50"
                            >
                              <RotateCcw size={11} /> Tanya ulang
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {m.meta && !m.meta.restored && (
                      <p className="mt-2 pt-1.5 border-t border-gray-200 text-[10px] text-gray-400">
                        <span className="font-medium text-gray-500">
                          {m.meta.tierLabel || "CODE AI"}
                        </span>
                        {m.meta.routing?.reasons?.length > 0 && m.meta.routing.auto && (
                          <span title={`Skor kompleksitas ${m.meta.routing.score}`}>
                            {" · "}{m.meta.routing.reasons.join(", ")}
                          </span>
                        )}
                        {m.meta.routing?.downgraded && (
                          <span className="text-amber-600">{" · turun tier: "}{m.meta.routing.downgraded}</span>
                        )}
                        {m.meta.routing?.escalatedFrom && (
                          <span className="text-sky-600">{" · dinaikkan dari "}{m.meta.routing.escalatedFrom}</span>
                        )}
                        {m.meta.fromCache && (
                          <span className="text-green-600" title={`Diambil dari cache (${m.meta.cacheAgeSeconds} detik lalu), tidak memakai kuota`}>
                            {" · "}dari cache, 0 kuota
                          </span>
                        )}
                        {typeof m.meta.visualsUsed === "number" && ` · ${m.meta.visualsUsed} visual / ${m.meta.rowsUsed} baris`}
                        {m.meta.summarizedVisuals > 0 && ` (${m.meta.summarizedVisuals} diringkas)`}
                        {m.meta.truncated && " · data terpotong"}
                        {m.meta.sanitization?.enabled && (
                          <span
                            className="text-green-600"
                            title={`${m.meta.sanitization.entities} identitas diganti token, ${m.meta.sanitization.dropped} nilai dihapus permanen sebelum data keluar dari jaringan Cimory`}
                          >
                            {" · "}<ShieldCheck size={10} className="inline align-[-1px]" /> {m.meta.sanitization.entities + m.meta.sanitization.dropped} nilai disamarkan
                          </span>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        )}

        {asking && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[12px] text-gray-500 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-cimoryBlue" /> AI sedang menganalisa data…
            </div>
          </div>
        )}
      </div>

      {/* ── Composer ── */}
      <div className="p-3 border-t border-gray-200 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            disabled={aiDisabled}
            placeholder={aiDisabled ? "Atur akses CODE AI dulu…" : "Contoh: mesin mana yang downtime-nya paling tinggi bulan ini?"}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2 text-[12.5px] focus:ring-2 focus:ring-cimoryBlue focus:outline-none disabled:bg-gray-100"
          />
          <button
            onClick={() => ask()}
            disabled={asking || aiDisabled || !question.trim()}
            className="p-2.5 rounded-xl bg-cimoryBlue text-white hover:bg-cimoryRed transition disabled:opacity-40 shrink-0"
            title="Kirim (Enter)"
          >
            {asking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-[10px] text-gray-500">
            <Cpu size={10} className="text-gray-400" />
            Mode:
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="border border-gray-200 rounded px-1 py-0.5 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-cimoryBlue"
              title={TIER_OPTIONS.find((t) => t.value === tier)?.hint}
            >
              {TIER_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <span className="text-[9.5px] text-gray-400">
            {TIER_OPTIONS.find((t) => t.value === tier)?.hint}
          </span>
        </div>

        <p className="mt-1 text-[10px] text-gray-400">
          Jawaban CODE AI berdasarkan data yang tampil. Selalu verifikasi angka penting di dashboard.
        </p>
      </div>
    </div>
  );
});

export default AskAIPanel;
