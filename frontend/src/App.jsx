import React, { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "./components/header";
import Sidebar from "./components/Sidebar";
import Login from "./components/Login";
import Register from "./components/Register";
import AddUserModal from "./components/AddUserModal";
import ManageUsers from "./components/ManageUsers";
import ChangePasswordModal from "./components/ChangePasswordModal";
import LandingPage from "./components/LandingPage";
import DashboardManager from "./components/DashboardManager";
import LandingPageManager from "./components/LandingPageManager";
import { ChevronDown, ArrowUp, ArrowLeft, Maximize2, Sparkles, KeyRound, Trash2, X } from "lucide-react";
import NotificationPage from "./components/NotificationPage";
import DataRoomDashboard from "./components/DataRoomDashboard.jsx";
import AskAIPanel from "./components/AskAIPanel";
import AISettingsModal from "./components/AISettingsModal";
import CodeAINavigator from "./components/CodeAINavigator";
import { extractReportGuid } from "./utils/powerbiData";
import { markAppReady, flushAppLoad, startDashboardTimer } from "./utils/perf";
import API from "./api/api.js";
import { PowerBIEmbed } from "powerbi-client-react";
import { models } from "powerbi-client";

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

/**
 * Jalur iframe — 44 dari 46 dashboard memakai ini secara default.
 *
 * Tanpa pengukuran di sini, telemetri dashboard hampir kosong: jalur embed
 * token hanya menyala saat user menyalakan Export Mode atau membuka CODE AI.
 * Tidak ada token yang diambil di jalur ini, jadi tokenMs selalu 0 dan seluruh
 * waktunya adalah Power BI memuat isinya sendiri.
 */
function PowerBIIframeEmbed({ url, dashboardId }) {
  const perfRef = useRef(null);
  if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);

  return (
    <iframe
      src={url}
      className="w-full h-full border-0"
      // tokenDone() sengaja TIDAK dipanggil: memanggilnya di sini akan
      // menaruh seluruh durasi ke tokenMs. Dibiarkan kosong, tokenMs jadi 0
      // dan seluruh waktunya masuk ke renderMs — di mana ia memang berada.
      onLoad={() => perfRef.current?.renderDone(false)}
    />
  );
}

function PowerBIReportEmbed({ url, reportId, dashboardId, exportMode, onReportRendered }) {
  // Export mode ON + ada report_id → pakai embed token (support export + AI)
  if (exportMode && reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  // Default → pakai public embed URL via iframe
  if (url?.startsWith("https://") || url?.startsWith("http://")) {
    return <PowerBIIframeEmbed url={url} dashboardId={dashboardId} />;
  }
  // Fallback: kalau tidak ada url publik tapi ada report_id, pakai token
  if (reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
      No embed source configured.
    </div>
  );
}

function PowerBITokenEmbed({ reportId, dashboardId, onReportRendered }) {
  const [embedConfig, setEmbedConfig] = useState(null);
  const [error, setError]             = useState(null);
  const reportRef = useRef(null);
  const timerRef  = useRef(null);
  const perfRef   = useRef(null);

  const fetchConfig = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);
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
        ["tokenExpired", fetchConfig],
        ["error", (e) => console.error("Power BI error:", e.detail)],
        // "rendered" fires on first paint and on every filter/slicer change —
        // the AI panel uses it to know the report is queryable and data changed.
        ["rendered", () => {
          perfRef.current?.renderDone(false);
          onReportRendered?.(reportRef.current);
        }],
      ])}
      getEmbeddedComponent={(r) => { reportRef.current = r; }}
      cssClassName="w-full h-full border-0"
    />
  );
}

// ── Fullscreen dashboard overlay ────────────────────────────────────────────
function FullscreenDash({ dash, accessStatus, user, onClose, onRequestAccess, onCancelRequest, onOpenAISettings }) {
  const allowed   = user?.tipe_akses === "All Access" || accessStatus[dash.title] === "APPROVED";
  const requested = accessStatus[dash.title] === "PENDING";
  const declined  = accessStatus[dash.title] === "DECLINED";
  const [exportMode, setExportMode] = useState(false);
  const [aiOpen, setAiOpen]         = useState(Boolean(dash.openAI));
  const [report, setReport]         = useState(null);
  const [renderNonce, setRenderNonce] = useState(0);

  // Token embedding needs a real report GUID — a public "view?r=..." link cannot
  // be converted into one, so Export/Ask AI stay hidden for those dashboards.
  const reportGuid    = extractReportGuid(dash.report_id);
  const hasTokenEmbed = Boolean(reportGuid);

  // Both Export Mode and Ask AI need the embed-token path (scriptable report)
  const tokenEmbed = (exportMode || aiOpen) && hasTokenEmbed;

  const panelRef = useRef(null);

  const handleRendered = useCallback((r) => {
    setReport(r);
    setRenderNonce((n) => n + 1);
  }, []);

  // Remounting the embed invalidates the old report instance
  useEffect(() => { setReport(null); }, [tokenEmbed, dash.url]);

  // The overlay covers the viewport, but the page underneath still scrolls with
  // the wheel — which drags the dashboard out of view. Lock it while open, and
  // restore whatever the page had before (never hardcode "auto" back).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 overscroll-contain">
      {/* One continuous gradient bar: dashboard controls on the left, the CODE AI
          panel header on the right. The left side simply narrows when the panel
          opens, so there is no second bar and no colour seam. */}
      <div className="flex items-stretch bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white shrink-0">
        <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 hover:bg-white/20 px-3 py-1.5 rounded-lg transition text-sm font-medium shrink-0"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <span className="font-semibold truncate">{dash.title}</span>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {allowed && hasTokenEmbed && (
              <button
                onClick={() => setAiOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  aiOpen
                    ? "bg-white text-cimoryBlue"
                    : "bg-white/20 text-white hover:bg-white/30"
                }`}
                title="Tanya CODE AI tentang data dashboard ini"
              >
                <Sparkles size={13} /> CODE AI
              </button>
            )}
            {allowed && hasTokenEmbed && (
              <button
                onClick={() => setExportMode(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  exportMode
                   ? "bg-white text-cimoryBlue"
                   : "bg-white/20 text-white hover:bg-white/30"
                 }`}
                title={exportMode ? "Kembali ke tampilan publik" : "Aktifkan export mode"}
                >
                {exportMode ? "Export: ON" : "Export: OFF"}
              </button>
             )}
           <span className="text-xs text-white/60 hidden sm:block">{dash.department}</span>
          </div>
        </div>

        {/* Right segment of the SAME bar — the AI panel's header */}
        {allowed && aiOpen && (
          <div className="hidden sm:flex items-center gap-2 px-4 py-3 w-[420px] shrink-0 border-l border-white/25">
            <Sparkles size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">CODE AI</p>
              <p className="text-[10.5px] text-white/70 leading-tight truncate">{dash.title}</p>
            </div>
            <button onClick={onOpenAISettings} title="Pengaturan CODE AI" className="p-1.5 rounded-lg hover:bg-white/20">
              <KeyRound size={15} />
            </button>
            <button onClick={() => panelRef.current?.clearChat()} title="Hapus riwayat" className="p-1.5 rounded-lg hover:bg-white/20">
              <Trash2 size={15} />
            </button>
            <button onClick={() => setAiOpen(false)} title="Tutup panel" className="p-1.5 rounded-lg hover:bg-white/20">
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
      <div className="flex-1 relative overflow-hidden">
        {!allowed && (
          <img
            src="../images/home_banner_1.jpeg"
            alt="Locked"
            className="absolute inset-0 w-full h-full object-cover opacity-60 blur-md"
          />
        )}

        {allowed && (
         <PowerBIReportEmbed
           key={`${dash.url}-${tokenEmbed}`}
           url={dash.url}
           reportId={reportGuid}
           dashboardId={dash.id}
           exportMode={tokenEmbed}
           onReportRendered={handleRendered}
          />
        )}

        {!allowed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {dash.description && (
              <div
                className="bg-white/20 backdrop-blur-lg text-white border border-white/30 px-6 py-4 rounded-2xl shadow-xl max-w-lg text-center text-sm"
                dangerouslySetInnerHTML={{ __html: dash.description }}
              />
            )}
            {declined && (
              <span className="px-5 py-2.5 rounded-xl font-semibold bg-red-600 text-white shadow-lg animate-pulse">
                Declined
              </span>
            )}
            {!requested && !declined && (
              <button
                onClick={() => onRequestAccess(dash.department, dash.title)}
                className="px-6 py-3 rounded-xl font-semibold bg-blue-600 text-white shadow-md hover:bg-blue-700 hover:shadow-xl transition-all active:scale-95"
              >
                Request Access
              </button>
            )}
            {requested && !declined && (
              <button
                onClick={() => onCancelRequest(dash.department, dash.title)}
                className="px-6 py-3 rounded-xl font-semibold bg-gray-600 text-white shadow-md hover:bg-gray-700 transition-all active:scale-95"
              >
                Cancel Request
              </button>
            )}
          </div>
        )}
      </div>

        {/* AI chat drawer — its own scroll container, independent of the page */}
        {allowed && aiOpen && (
          <div className="w-full max-w-[420px] sm:w-[420px] shrink-0 h-full overscroll-contain">
            <AskAIPanel
              ref={panelRef}
              dashboard={dash}
              report={report}
              reportReady={Boolean(report)}
              renderNonce={renderNonce}
              initialQuestion={dash.initialQuestion}
              hideHeader                        /* header lives in the bar above */
              onClose={() => setAiOpen(false)}
              onOpenSettings={onOpenAISettings}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const [activeMenu, setActiveMenu]       = useState("Plant");
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [focusedDash, setFocusedDash]     = useState(null);
  const [showAddUser, setShowAddUser]     = useState(false);
  const [showManageUser, setShowManageUser] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [accessStatus, setAccessStatus]   = useState({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState("");
  const [dashboards, setDashboards]       = useState({});
  const navigate = useNavigate();

  const fetchDashboards = async () => {
    try {
      const res = await API.get("/api/dashboards");
      const grouped = res.data.reduce((acc, dash) => {
        const dept = dash.department || "Others";
        if (!acc[dept]) acc[dept] = [];
        acc[dept].push({ id: dash.id, title: dash.title, url: dash.url, report_id: dash.report_id, description: dash.description, department: dept });
        return acc;
      }, {});
      setDashboards(grouped);
    } catch (err) {
      console.error("❌ Gagal ambil dashboard:", err);
      setDashboards({});
    }
  };

  const fetchAccessStatus = async () => {
    try {
      const res = await API.get(`/api/dashboard-access-status/${user.id}`);
      setAccessStatus(res.data || {});
    } catch (err) {
      console.error("Failed getting user access:", err);
      setAccessStatus({});
    }
  };

  useEffect(() => {
    fetchDashboards();
    fetchAccessStatus();
  }, []);

  useEffect(() => {
    if (user?.dept) {
      const dept = user.dept.trim();
      setActiveMenu(Object.keys(dashboards).includes(dept) ? dept : "Plant");
    } else {
      setActiveMenu("Plant");
    }
  }, [user, dashboards]);

  const canView = (dept, dashTitle) => {
    if (user?.tipe_akses === "All Access") return true;
    if (accessStatus[dashTitle] === "APPROVED") return true;
    return false;
  };

  const hasRequested = (dashTitle) => accessStatus[dashTitle] === "PENDING";

  const handleRequestAccess = async (dept, dashTitle) => {
    try {
      await API.post("/api/request-access", {
        user_id:              user.id,
        dashboard_title:      dashTitle,
        dashboard_department: dept,
        department_requested: dept,
      });
      await fetchAccessStatus();
      alert(`Request akses untuk "${dashTitle}" telah dikirim.`);
    } catch (err) {
      console.error("Gagal request akses:", err);
      alert(err?.response?.data?.message || "Gagal request akses!");
    }
  };

  const handleCancelRequest = async (dept, dashTitle) => {
    try {
      await API.post("/api/cancel-request", { user_id: user.id, dashboard_title: dashTitle });
      await fetchAccessStatus();
      alert(`Request akses untuk "${dashTitle}" dibatalkan.`);
    } catch (err) {
      console.error("Gagal cancel request:", err);
      alert(err?.response?.data?.message || "Gagal cancel request!");
    }
  };

  const handleDashboardSelect = (dash) => {
    setFocusedDash(dash);
    setSidebarOpen(false);
  };

  // Opens the dashboard fullscreen with the AI drawer already expanded
  const handleAskAI = (dash) => {
    setFocusedDash({ ...dash, openAI: true });
    setSidebarOpen(false);
  };

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const modalOpen = showAddUser || showManageUser || showChangePassword || showAISettings;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-cimoryBlue/50 via-white to-cimoryRed/50">
      <Header
        user={user}
        onLogout={onLogout}
        onAddUserClick={() => setShowAddUser(true)}
        onManageUserClick={() => setShowManageUser(true)}
        onChangePasswordClick={() => setShowChangePassword(true)}
        onAISettingsClick={() => setShowAISettings(true)}
        onMenuToggle={() => setSidebarOpen(true)}
      />

      <div className="flex flex-1 p-3 lg:p-6 gap-3 lg:gap-6 min-h-0">
        <Sidebar
          active={activeMenu}
          onChange={setActiveMenu}
          user={user}
          canView={() => true}
          dashboards={dashboards}
          onDashboardSelect={handleDashboardSelect}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main
          className={`flex-1 min-w-0 bg-white/60 backdrop-blur-md p-4 lg:p-8 rounded-2xl shadow-md border border-cimoryGray overflow-y-auto transition-all duration-300 ${
            modalOpen ? "blur-sm pointer-events-none" : ""
          }`}
        >
          {/* Section header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 border-b-2 border-red-200 pb-5">
            <h1 className="text-xl lg:text-2xl font-bold text-cimoryBlue">
              {activeMenu} Dashboards
            </h1>
            <div className="relative w-full sm:w-64">
              <select
                value={selectedDashboard}
                className="appearance-none border border-cimoryBlue rounded-xl px-3 py-2 text-gray-700 focus:ring-2 focus:ring-cimoryBlue focus:outline-none w-full pr-10 text-sm"
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                  setSelectedDashboard("");
                }}
              >
                <option value="">Search Dashboard</option>
                {dashboards[activeMenu]?.map((dash, i) => (
                  <option key={i} value={`dash-${i}`}>{dash.title}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-cimoryBlue pointer-events-none" />
            </div>
          </div>

          {/* Dashboard cards */}
          <div className="space-y-8 lg:space-y-10">
            {dashboards[activeMenu]?.map((dash, i) => {
              const allowed   = canView(activeMenu, dash.title);
              const requested = hasRequested(dash.title);

              return (
                <div key={i} id={`dash-${i}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base lg:text-lg font-semibold text-cimoryRed">{dash.title}</h2>
                    <div className="flex items-center gap-1">
                      {allowed && extractReportGuid(dash.report_id) && (
                        <button
                          onClick={() => handleAskAI({ ...dash, department: activeMenu })}
                          className="flex items-center gap-1.5 text-xs text-cimoryBlue hover:text-cimoryRed transition px-2 py-1 rounded-lg hover:bg-cimoryBlue/10"
                          title="Tanya CODE AI tentang dashboard ini"
                        >
                          <Sparkles size={14} /> CODE AI
                        </button>
                      )}
                      <button
                        onClick={() => handleDashboardSelect({ ...dash, department: activeMenu })}
                        className="flex items-center gap-1.5 text-xs text-cimoryBlue hover:text-cimoryRed transition px-2 py-1 rounded-lg hover:bg-cimoryBlue/10"
                        title="Fullscreen"
                      >
                        <Maximize2 size={14} /> Fullscreen
                      </button>
                    </div>
                  </div>

                  <div className="relative w-full h-[60vh] lg:h-[85vh] rounded-xl overflow-hidden shadow border border-gray-300 group">
                    {!allowed && (
                      <img
                        src="../images/home_banner_1.jpeg"
                        alt="Placeholder"
                        className="absolute inset-0 w-full h-full object-cover opacity-70 blur-md"
                      />
                    )}

                    <div className={`w-full h-full transition-all duration-300 ${!allowed ? "blur-md pointer-events-none" : ""}`}>
                      {allowed && (
                       <PowerBIReportEmbed
                        key={dash.url}
                        url={dash.url}
                        reportId={extractReportGuid(dash.report_id)}
                        dashboardId={dash.id}
                        exportMode={false}
                       />
                      )}
                    </div>

                    {!allowed && dash.description && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-300 ease-out pointer-events-none">
                        <div
                          className="bg-white/20 backdrop-blur-lg text-cimoryBlue border border-white/30 px-6 py-4 rounded-2xl shadow-xl max-w-sm lg:max-w-xl text-center text-sm animate-fade-in"
                          dangerouslySetInnerHTML={{ __html: dash.description }}
                        />
                      </div>
                    )}

                    {!allowed && (
                      <div className="absolute bottom-4 right-4 flex gap-3">
                        {accessStatus[dash.title] === "DECLINED" && (
                          <span className="px-4 py-2 rounded-xl font-semibold bg-red-600 text-white shadow-lg animate-pulse">
                            Declined
                          </span>
                        )}
                        {!requested && accessStatus[dash.title] !== "DECLINED" && (
                          <button
                            onClick={() => handleRequestAccess(activeMenu, dash.title)}
                            className="px-4 lg:px-5 py-2 lg:py-2.5 rounded-xl font-semibold bg-blue-600 text-white shadow-md hover:shadow-xl transition-all duration-200 hover:bg-blue-700 active:scale-95 hover:-translate-y-1 text-sm"
                          >
                            Request Access
                          </button>
                        )}
                        {requested && accessStatus[dash.title] !== "DECLINED" && (
                          <button
                            onClick={() => handleCancelRequest(activeMenu, dash.title)}
                            className="px-4 lg:px-5 py-2 lg:py-2.5 rounded-xl font-semibold bg-gray-600 text-white shadow-md hover:shadow-xl transition-all duration-200 hover:bg-gray-700 active:scale-95 hover:-translate-y-1 text-sm"
                          >
                            Cancel Request
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      <footer className="mt-4 lg:mt-6 text-center py-3 lg:py-4 bg-white/30 backdrop-blur-xl text-gray-700 border border-white/40 shadow-md text-sm">
        © Powered by{" "}
        <span className="font-medium text-cimoryBlue">Digital Transformation Plant Sentul</span>
      </footer>

      {/* Sits ABOVE the CODE AI launcher, which owns the bottom-right corner */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-6 bg-cimoryBlue hover:bg-cimoryRed text-white p-3 rounded-full shadow-lg transition-all duration-300 z-30"
          title="Kembali ke atas"
        >
          <ArrowUp size={20} />
        </button>
      )}

      {focusedDash && (
        <FullscreenDash
          dash={focusedDash}
          accessStatus={accessStatus}
          user={user}
          onClose={() => setFocusedDash(null)}
          onOpenAISettings={() => setShowAISettings(true)}
          onRequestAccess={async (dept, title) => {
            await handleRequestAccess(dept, title);
          }}
          onCancelRequest={async (dept, title) => {
            await handleCancelRequest(dept, title);
          }}
        />
      )}

      {/* Home-screen assistant: finds the right dashboard, never reads its data */}
      {!focusedDash && (
        <CodeAINavigator
          user={user}
          onOpenDashboard={(ref, opts) => {
            const found = Object.values(dashboards)
              .flat()
              .find((d) => Number(d.id) === Number(ref.id));
            if (!found) return;
            setActiveMenu(found.department);
            setFocusedDash({
              ...found,
              openAI: Boolean(opts?.withAI),
              // Carried from the navigator so the user does not retype it
              initialQuestion: opts?.withAI ? opts?.question : undefined,
            });
          }}
          onRequestAccess={(ref) => handleRequestAccess(ref.department, ref.title)}
          onRequestAccessBulk={async (refs) => {
            for (const r of refs) {
              try {
                await API.post("/api/request-access", {
                  user_id: user.id,
                  dashboard_title: r.title,
                  dashboard_department: r.department,
                  department_requested: r.department,
                });
              } catch { /* already requested / declined — skip, do not abort the rest */ }
            }
            await fetchAccessStatus();
          }}
        />
      )}

      {showAddUser    && <AddUserModal onClose={() => setShowAddUser(false)} />}
      {showManageUser && <ManageUsers onClose={() => setShowManageUser(false)} />}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      {showAISettings && <AISettingsModal onClose={() => setShowAISettings(false)} />}
    </div>
  );
}

function NotificationsLayout({ user, onLogout }) {
  const navigate = useNavigate();
  const [activeMenu]           = useState("Notifications");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showManageUser, setShowManageUser] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const modalOpen = showAddUser || showManageUser || showChangePassword;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-cimoryBlue/50 via-white to-cimoryRed/50">
      <Header
        user={user}
        onLogout={onLogout}
        onAddUserClick={() => setShowAddUser(true)}
        onManageUserClick={() => setShowManageUser(true)}
        onChangePasswordClick={() => setShowChangePassword(true)}
        onMenuToggle={() => setSidebarOpen(true)}
      />

      <div className="flex flex-1 p-3 lg:p-6 gap-3 lg:gap-6 min-h-0">
        <Sidebar
          active={activeMenu}
          onChange={() => navigate("/App")}
          user={user}
          canView={() => true}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main
          className={`flex-1 min-w-0 bg-white/60 backdrop-blur-md p-4 lg:p-8 rounded-2xl shadow-md border border-cimoryGray overflow-y-auto transition-all duration-300 ${
            modalOpen ? "blur-sm pointer-events-none" : ""
          }`}
        >
          <h1 className="text-xl lg:text-2xl font-bold text-cimoryBlue mb-6 border-b-2 border-red-200 pb-4">
            Notifications
          </h1>
          <NotificationPage user={user} />
        </main>
      </div>

      <footer className="mt-4 lg:mt-6 text-center py-3 lg:py-4 bg-white/30 backdrop-blur-xl text-gray-700 border border-white/40 shadow-md text-sm">
        © Powered by{" "}
        <span className="font-medium text-cimoryBlue">Digital Transformation Plant Sentul</span>
      </footer>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 bg-cimoryBlue hover:bg-cimoryRed text-white p-3 rounded-full shadow-lg transition-all duration-300 z-30"
        >
          <ArrowUp size={20} />
        </button>
      )}

      {showAddUser    && <AddUserModal onClose={() => setShowAddUser(false)} />}
      {showManageUser && <ManageUsers onClose={() => setShowManageUser(false)} />}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

export default function App() {
  const [user, setUser]             = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const token      = localStorage.getItem("token");

    if (storedUser && token) {
      const parsed = JSON.parse(storedUser);

      // Sessions created before roles existed have no `role` — the admin menus
      // would silently vanish with no explanation. They also still carry the
      // bcrypt hash the old login used to send. Drop them and ask for a login.
      if (!parsed?.role) {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        setLoadingUser(false);
        return;
      }

      setUser(parsed);
      API.get("/api/check-token", { headers: { Authorization: `Bearer ${token}` } })
        .then((res)  => console.log("Token valid:", res.data))
        .catch((err) => console.warn("Token invalid atau expired:", err?.response?.data?.message))
        .finally(()  => setLoadingUser(false));
    } else {
      setLoadingUser(false);
    }
  }, []);

  // Satu kali per sesi, setelah render pertama selesai.
  useEffect(() => { markAppReady(); }, []);

  if (loadingUser) {
    return <div className="h-screen flex items-center justify-center">Loading...</div>;
  }

  const handleLogin = (userData, token) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", token);
    // Pengukuran muat halaman diambil sebelum login, saat belum ada token
    // untuk mengirimkannya. Sekarang ada.
    flushAppLoad();
  };

  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUser(null);
  };

  const isAdmin = (u) => u?.role === "admin";

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Navigate to="/App" replace /> : <Navigate to="/cop" replace />}
      />

      <Route path="/cop" element={<LandingPage />} />

      <Route
        path="/login"
        element={user ? <Navigate to="/App" replace /> : <Login onLogin={handleLogin} />}
      />

      <Route
        path="/register"
        element={user ? <Navigate to="/App" replace /> : <Register />}
      />

      <Route
        path="/App"
        element={user ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />}
      />

      <Route
        path="/data-center"
        element={user ? <DataRoomDashboard /> : <Navigate to="/login" replace />}
      />

      <Route
        path="/notifications"
        element={
          user
            ? <NotificationsLayout user={user} onLogout={handleLogout} />
            : <Navigate to="/login" replace />
        }
      />

      {/* Restricted to admin only */}
      <Route
        path="/dashboard"
        element={
          isAdmin(user)
            ? <DashboardManager />
            : user
              ? <Navigate to="/App" replace />
              : <Navigate to="/login" replace />
        }
      />

      <Route
        path="/portal-manager"
        element={
          isAdmin(user)
            ? <LandingPageManager />
            : user
              ? <Navigate to="/App" replace />
              : <Navigate to="/login" replace />
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
