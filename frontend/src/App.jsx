import React, { useState, useEffect, useRef, useCallback, lazy } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "./components/header";
import Login from "./components/Login";
import Register from "./components/Register";
import { ChevronDown, ArrowUp, ArrowLeft, Maximize2, Sparkles, KeyRound, Trash2, X } from "lucide-react";
import { extractReportGuid } from "./utils/reportGuid";
import { markAppReady, flushAppLoad, startDashboardTimer } from "./utils/perf";
import { useInViewport } from "./hooks/useInViewport";
import { prefetchEmbed, cancelPrefetch } from "./utils/embedPrefetch";
import API from "./api/api.js";
import PowerBIReport from "./components/PowerBIReport";
import LazyBoundary from "./components/LazyBoundary";
import { useToast } from "./components/ToastProvider";

// Dimuat saat dibutuhkan. Panel manajemen dipisah karena hanya satu dari 58
// akun yang bisa membukanya — tidak masuk akal 57 orang lain mengunduhnya.
// AskAIPanel penting secara khusus: ia menjangkau powerbiData, yang menjangkau
// powerbi-client, sehingga impor statisnya menahan SDK 355 KB di chunk utama.
// Sidebar dan LandingPage keduanya memakai framer-motion (115 KB). Tidak satu
// pun dibutuhkan halaman login — layar pertama yang dilihat semua orang.
const Sidebar             = lazy(() => import("./components/Sidebar"));
const LandingPage         = lazy(() => import("./components/LandingPage"));
const AddUserModal        = lazy(() => import("./components/AddUserModal"));
const ManageUsers         = lazy(() => import("./components/ManageUsers"));
const ChangePasswordModal = lazy(() => import("./components/ChangePasswordModal"));
const DashboardManager    = lazy(() => import("./components/DashboardManager"));
const PlantManager        = lazy(() => import("./components/PlantManager"));
const LandingPageManager  = lazy(() => import("./components/LandingPageManager"));
const NotificationPage    = lazy(() => import("./components/NotificationPage"));
const DataRoomDashboard   = lazy(() => import("./components/DataRoomDashboard.jsx"));
const AskAIPanel          = lazy(() => import("./components/AskAIPanel"));
const AISettingsModal     = lazy(() => import("./components/AISettingsModal"));
const ReportSettingModal  = lazy(() => import("./components/ReportSettingModal"));
const CodeAINavigator     = lazy(() => import("./components/CodeAINavigator"));
const UnifiedChatPage     = lazy(() => import("./components/UnifiedChatPage"));
const CiaAdminPage        = lazy(() => import("./components/admin/CiaAdminPage"));
// Membawa DOMPurify (~30 KB). Hanya deskripsi dashboard yang perlu disanitasi,
// dan itu tidak pernah tampil di halaman login.
const SafeHtml            = lazy(() => import("./components/SafeHtml"));

/**
 * Satu kartu dashboard di halaman departemen.
 *
 * Diangkat menjadi komponen tersendiri karena butuh useInViewport, dan hook
 * tidak boleh dipanggil di dalam .map() — jumlahnya akan berubah mengikuti
 * panjang daftar.
 *
 * Iframe-nya baru dipasang setelah kartu mendekati layar. Sebelumnya sebuah
 * halaman departemen memasang delapan iframe Power BI sekaligus; terukur
 * 7,3 detik p50 karena semuanya berebut bandwidth, padahal user cuma melihat
 * satu atau dua di layar.
 */
function DashboardCard({
  index, dash, department, allowed, requested, accessStatus,
  onAskAI, onFullscreen, onRequestAccess, onCancelRequest,
}) {
  const [cardRef, visible] = useInViewport();

  // Hanya kartu dengan report GUID yang bisa memakai embed token, jadi hanya
  // itu yang layak di-prefetch. Yang ditolong adalah tombol CIA dan Export
  // Mode di kartu ini — bukan tampilan iframe-nya, yang tidak memakai token.
  const guid = allowed ? extractReportGuid(dash.report_id) : null;

  return (
    <div
      key={index}
      id={`dash-${index}`}
      ref={cardRef}
      onMouseEnter={() => prefetchEmbed(guid)}
      onMouseLeave={() => cancelPrefetch(guid)}
      // Pemakai keyboard mendapat manfaat yang sama dengan pemakai mouse.
      onFocus={() => prefetchEmbed(guid)}
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base lg:text-lg font-semibold text-cimoryRed">{dash.title}</h2>
        <div className="flex items-center gap-1">
          {guid && (
            <button
              onClick={() => onAskAI({ ...dash, department })}
              className="flex items-center gap-1.5 text-xs text-cimoryBlue hover:text-cimoryRed transition px-2 py-1 rounded-lg hover:bg-cimoryBlue/10"
              title="Tanya CIA tentang dashboard ini"
            >
              <Sparkles size={14} /> CIA
            </button>
          )}
          <button
            onClick={() => onFullscreen({ ...dash, department })}
            className="flex items-center gap-1.5 text-xs text-cimoryBlue hover:text-cimoryRed transition px-2 py-1 rounded-lg hover:bg-cimoryBlue/10"
            title="Fullscreen"
          >
            <Maximize2 size={14} /> Fullscreen
          </button>
        </div>
      </div>

      <div className="relative w-full h-[60vh] lg:h-[85vh] rounded-xl overflow-hidden shadow border border-gray-300 group">
        {!allowed && (
          // Path absolut: "../images/..." diselesaikan terhadap URL halaman,
          // jadi nilainya berubah tergantung rute — selama ini kebetulan kena.
          <picture>
            <source srcSet="/images/home_banner_1.webp" type="image/webp" />
            <img
              src="/images/home_banner_1.jpg"
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover opacity-70 blur-md"
            />
          </picture>
        )}

        <div className={`w-full h-full transition-all duration-300 ${!allowed ? "blur-md pointer-events-none" : ""}`}>
          {allowed && visible && (
            <PowerBIReport
              key={dash.url}
              url={dash.url}
              reportId={guid}
              dashboardId={dash.id}
              exportMode={false}
            />
          )}
          {allowed && !visible && (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              Dashboard dimuat saat digulir ke sini
            </div>
          )}
        </div>

        {!allowed && dash.description && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-300 ease-out pointer-events-none">
            <LazyBoundary>
              <SafeHtml
                html={dash.description}
                className="bg-white/20 backdrop-blur-lg text-cimoryBlue border border-white/30 px-6 py-4 rounded-2xl shadow-xl max-w-sm lg:max-w-xl text-center text-sm animate-fade-in"
              />
            </LazyBoundary>
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
                onClick={() => onRequestAccess(department, dash.title)}
                className="px-4 lg:px-5 py-2 lg:py-2.5 rounded-xl font-semibold bg-blue-600 text-white shadow-md hover:shadow-xl transition-all duration-200 hover:bg-blue-700 active:scale-95 hover:-translate-y-1 text-sm"
              >
                Request Access
              </button>
            )}
            {requested && accessStatus[dash.title] !== "DECLINED" && (
              <button
                onClick={() => onCancelRequest(department, dash.title)}
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
}

// ── Fullscreen dashboard overlay ────────────────────────────────────────────
function FullscreenDash({ dash, accessStatus, user, onClose, onRequestAccess, onCancelRequest, onOpenAISettings, ciaAccess }) {
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
      {/* One continuous gradient bar: dashboard controls on the left, the CIA
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
            {/* Tombol pembuka panel ikut disembunyikan. Membiarkannya tampil lalu
                menolak saat diklik membuat user mengira fiturnya rusak, bukan
                mengira aksesnya belum dibuka. */}
            {allowed && hasTokenEmbed && ciaAccess && (
              <button
                onClick={() => setAiOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  aiOpen
                    ? "bg-white text-cimoryBlue"
                    : "bg-white/20 text-white hover:bg-white/30"
                }`}
                title="Tanya CIA tentang data dashboard ini"
              >
                <Sparkles size={13} /> CIA
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
        {allowed && ciaAccess && aiOpen && (
          <div className="hidden sm:flex items-center gap-2 px-4 py-3 w-[420px] shrink-0 border-l border-white/25">
            <Sparkles size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">CIA</p>
              <p className="text-[10.5px] text-white/70 leading-tight truncate">{dash.title}</p>
            </div>
            <button onClick={onOpenAISettings} title="Pengaturan CIA" className="p-1.5 rounded-lg hover:bg-white/20">
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
          <picture>
            <source srcSet="/images/home_banner_1.webp" type="image/webp" />
            <img
              src="/images/home_banner_1.jpg"
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover opacity-60 blur-md"
            />
          </picture>
        )}

        {allowed && (
         <PowerBIReport
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
              <LazyBoundary>
                <SafeHtml
                  html={dash.description}
                  className="bg-white/20 backdrop-blur-lg text-white border border-white/30 px-6 py-4 rounded-2xl shadow-xl max-w-lg text-center text-sm"
                />
              </LazyBoundary>
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
            <LazyBoundary>
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
            </LazyBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const toast = useToast();
  const [activeMenu, setActiveMenu]       = useState("Plant");
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebarCollapsed") === "1"; } catch { return false; }
  });
  const toggleSidebarCollapsed = () => setSidebarCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem("sidebarCollapsed", next ? "1" : "0"); } catch { /* abaikan */ }
    return next;
  });
  const [focusedDash, setFocusedDash]     = useState(null);
  const [showAddUser, setShowAddUser]     = useState(false);
  const [showManageUser, setShowManageUser] = useState(false);
  const [showReportSetting, setShowReportSetting] = useState(false);
  const [showPlantManager, setShowPlantManager] = useState(false);

  // Hak akses CIA, dibaca dari server & localStorage untuk initial render.
  //
  // Ini HANYA untuk menyembunyikan pintu masuknya. Penjagaan sebenarnya ada di
  // server: endpoint CIA menolak 403 untuk user yang belum dibuka aksesnya,
  // karena siapa pun yang punya token bisa memanggilnya langsung tanpa lewat
  // tampilan ini.
  //
  // Initial state dari localStorage (user.ci_access) supaya tombol langsung
  // aktif tanpa nunggu API. Lalu sync ke server kalau beda.
  const getInitialCiaAccess = () => {
    try {
      const stored = localStorage.getItem("user");
      if (stored) {
        const u = JSON.parse(stored);
        return Boolean(u?.cia_access);
      }
    } catch {}
    return false;
  };

  const [ciaAccess, setCiaAccess] = useState(getInitialCiaAccess);

  useEffect(() => {
    let batal = false;
    API.get("/api/ai/status")
      .then(({ data }) => { if (!batal) setCiaAccess(Boolean(data?.ciaAccess)); })
      .catch(() => { if (!batal) setCiaAccess(false); });
    return () => { batal = true; };
  }, []);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [accessStatus, setAccessStatus]   = useState({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState("");
  const [dashboards, setDashboards]       = useState({});
  const [dashboardsFlat, setDashboardsFlat] = useState([]);
  const [plants, setPlants]               = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.role !== "admin" || !window.location.search.includes("open=cia-settings")) return;
    setShowAISettings(true);
    navigate("/App", { replace: true });
  }, [navigate, user?.role]);

  // Dashboard hanya boleh muncul untuk plant milik user (kecuali lintas-plant /
  // admin). Tanpa ini, konten dikelompokkan per NAMA department saja sehingga
  // department bernama sama di plant lain (mis. "Plant" milik Sentul) bocor ke
  // user plant lain. Dashboard tanpa plant (neutral) tetap tampil untuk semua.
  const inUserPlants = (dash) => {
    if (Boolean(user?.cross_plant_access) || user?.role === "admin") return true;
    const userPlantIds = new Set((user?.plants || []).map((p) => Number(p.id)));
    const pids = (Array.isArray(dash.plantIds) && dash.plantIds.length)
      ? dash.plantIds
      : (dash.plant_id != null ? [dash.plant_id] : []);
    return pids.length === 0 || pids.some((id) => userPlantIds.has(Number(id)));
  };

  const fetchDashboards = async () => {
    try {
      const res = await API.get("/api/dashboards");
      setDashboardsFlat(res.data || []);
      const grouped = (res.data || []).filter(inUserPlants).reduce((acc, dash) => {
        const dept = dash.department || "Others";
        if (!acc[dept]) acc[dept] = [];
        acc[dept].push({ id: dash.id, title: dash.title, url: dash.url, report_id: dash.report_id, description: dash.description, department: dept });
        return acc;
      }, {});
      setDashboards(grouped);
    } catch (err) {
      console.error("❌ Gagal ambil dashboard:", err);
      setDashboards({});
      setDashboardsFlat([]);
    }
  };

  const fetchPlants = async () => {
    try {
      const res = await API.get("/api/plants");
      setPlants(res.data || []);
    } catch (err) {
      console.error("❌ Gagal ambil plant:", err);
      setPlants([]);
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
    fetchPlants();
  }, []);

  // Halaman awal user = department-nya sendiri, bukan selalu "Plant". Field yang
  // benar `departemen` (bukan `dept`, yang tak ada) — dulu selalu jatuh ke "Plant".
  useEffect(() => {
    const dept = (user?.departemen || "").trim();
    setActiveMenu(dept && Object.keys(dashboards).includes(dept) ? dept : "Plant");
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
      toast.success(`Request akses untuk "${dashTitle}" telah dikirim.`);
    } catch (err) {
      console.error("Gagal request akses:", err);
      toast.error(err?.response?.data?.message || "Gagal mengirim request akses");
    }
  };

  const handleCancelRequest = async (dept, dashTitle) => {
    try {
      await API.post("/api/cancel-request", { user_id: user.id, dashboard_title: dashTitle });
      await fetchAccessStatus();
      toast.success(`Request akses untuk "${dashTitle}" dibatalkan.`);
    } catch (err) {
      console.error("Gagal cancel request:", err);
      toast.error(err?.response?.data?.message || "Gagal membatalkan request");
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

  const modalOpen = showAddUser || showManageUser || showChangePassword || showAISettings || showReportSetting || showPlantManager;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-cimoryBlue/50 via-white to-cimoryRed/50">
      <Header
        user={user}
        onLogout={onLogout}
        onAddUserClick={() => setShowAddUser(true)}
        onManageUserClick={() => setShowManageUser(true)}
        onReportSettingClick={() => setShowReportSetting(true)}
        onPlantManagerClick={() => setShowPlantManager(true)}
        onChangePasswordClick={() => setShowChangePassword(true)}
        onAISettingsClick={ciaAccess || user?.role === "admin" ? () => setShowAISettings(true) : null}
        onUnifiedChatClick={ciaAccess ? () => navigate("/cia-chat") : null}
        onMenuToggle={() => setSidebarOpen(true)}
      />

      <div className="flex flex-1 p-3 lg:p-6 gap-3 lg:gap-6 min-h-0">
        <LazyBoundary>
          <Sidebar
            active={activeMenu}
            onChange={setActiveMenu}
            user={user}
            canView={() => true}
            dashboards={dashboards}
            plants={plants}
            dashboardsFlat={dashboardsFlat}
            onDashboardSelect={handleDashboardSelect}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebarCollapsed}
          />
        </LazyBoundary>

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
            {dashboards[activeMenu]?.map((dash, i) => (
              <DashboardCard
                key={i}
                index={i}
                dash={dash}
                department={activeMenu}
                allowed={canView(activeMenu, dash.title)}
                requested={hasRequested(dash.title)}
                accessStatus={accessStatus}
                onAskAI={handleAskAI}
                onFullscreen={handleDashboardSelect}
                onRequestAccess={handleRequestAccess}
                onCancelRequest={handleCancelRequest}
              />
            ))}
          </div>
        </main>
      </div>

      <footer className="mt-4 lg:mt-6 text-center py-3 lg:py-4 bg-white/30 backdrop-blur-xl text-gray-700 border border-white/40 shadow-md text-sm">
        © Powered by{" "}
        <span className="font-medium text-cimoryBlue">Digital Transformation Plant Sentul</span>
      </footer>

      {/* Sits ABOVE the CIA launcher, which owns the bottom-right corner */}
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
          ciaAccess={Boolean(ciaAccess)}
          onRequestAccess={async (dept, title) => {
            await handleRequestAccess(dept, title);
          }}
          onCancelRequest={async (dept, title) => {
            await handleCancelRequest(dept, title);
          }}
        />
      )}

      {/* Home-screen assistant: finds the right dashboard, never reads its data */}
      {/* Navigator disembunyikan bila akses CIA belum dibuka. Penjagaan
          sebenarnya tetap di server: endpoint navigate menolak 403. */}
      {!focusedDash && ciaAccess && (
        <LazyBoundary>
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
        </LazyBoundary>
      )}

      <LazyBoundary>
        {showAddUser    && <AddUserModal onClose={() => setShowAddUser(false)} />}
        {showManageUser && <ManageUsers onClose={() => setShowManageUser(false)} />}
        {showReportSetting && <ReportSettingModal onClose={() => setShowReportSetting(false)} />}
        {showPlantManager && <PlantManager onClose={() => setShowPlantManager(false)} />}
        {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
        {showAISettings && <AISettingsModal onClose={() => setShowAISettings(false)} />}
      </LazyBoundary>
    </div>
  );
}

function NotificationsLayout({ user, onLogout }) {
  const navigate = useNavigate();
  const [activeMenu]           = useState("Notifications");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Sidebar butuh plants + dashboardsFlat untuk membangun pohon Plant ▸ Dept.
  // Tanpa ini, halaman Notifications menampilkan "Belum ada plant untuk akun ini".
  const [plants, setPlants] = useState([]);
  const [dashboardsFlat, setDashboardsFlat] = useState([]);
  useEffect(() => {
    API.get("/api/plants").then((r) => setPlants(r.data || [])).catch(() => setPlants([]));
    API.get("/api/dashboards").then((r) => setDashboardsFlat(r.data || [])).catch(() => setDashboardsFlat([]));
  }, []);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showManageUser, setShowManageUser] = useState(false);
  const [showReportSetting, setShowReportSetting] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const modalOpen = showAddUser || showManageUser || showChangePassword || showReportSetting;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-cimoryBlue/50 via-white to-cimoryRed/50">
      <Header
        user={user}
        onLogout={onLogout}
        onAddUserClick={() => setShowAddUser(true)}
        onManageUserClick={() => setShowManageUser(true)}
        onReportSettingClick={() => setShowReportSetting(true)}
        onChangePasswordClick={() => setShowChangePassword(true)}
        onMenuToggle={() => setSidebarOpen(true)}
      />

      <div className="flex flex-1 p-3 lg:p-6 gap-3 lg:gap-6 min-h-0">
        <LazyBoundary>
          <Sidebar
            active={activeMenu}
            onChange={() => navigate("/App")}
            user={user}
            canView={() => true}
            plants={plants}
            dashboardsFlat={dashboardsFlat}
            onDashboardSelect={() => navigate("/App")}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        </LazyBoundary>

        <main
          className={`flex-1 min-w-0 bg-white/60 backdrop-blur-md p-4 lg:p-8 rounded-2xl shadow-md border border-cimoryGray overflow-y-auto transition-all duration-300 ${
            modalOpen ? "blur-sm pointer-events-none" : ""
          }`}
        >
          <h1 className="text-xl lg:text-2xl font-bold text-cimoryBlue mb-6 border-b-2 border-red-200 pb-4">
            Notifications
          </h1>
          <LazyBoundary>
            <NotificationPage user={user} />
          </LazyBoundary>
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

      <LazyBoundary>
        {showAddUser    && <AddUserModal onClose={() => setShowAddUser(false)} />}
        {showManageUser && <ManageUsers onClose={() => setShowManageUser(false)} />}
        {showReportSetting && <ReportSettingModal onClose={() => setShowReportSetting(false)} />}
        {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      </LazyBoundary>
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
    <LazyBoundary>
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

      {/* Chat CIA lintas dashboard. Yang dijaga di sini hanya "sudah login";
          hak akses CIA-nya dijaga server pada tiap panggilan /api/ai/unified/*,
          karena rute frontend bukan penjaga keamanan. */}
      <Route
        path="/cia-chat"
        element={user ? <UnifiedChatPage /> : <Navigate to="/login" replace />}
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

      <Route
        path="/admin/cia"
        element={
          isAdmin(user)
            ? <CiaAdminPage />
            : user
              ? <Navigate to="/App" replace />
              : <Navigate to="/login" replace />
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </LazyBoundary>
  );
}
