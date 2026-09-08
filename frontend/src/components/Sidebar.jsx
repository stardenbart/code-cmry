import React, { useState, useEffect } from "react";
import API from "../api/api";
import {
  Bell, Factory, Monitor,
  ChevronDown, ChevronRight, LayoutGrid, X, Building2,
  ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// Sidebar hierarkis: Plant ▸ Department ▸ Dashboard.
//
// Plant yang ditampilkan hanya plant yang boleh diakses user: plant yang
// di-assign ke dia, ATAU semua plant bila user.cross_plant_access. Dashboard
// dikelompokkan per (plant, department) memakai plant_id/department_id yang
// dibawa /api/dashboards. Akses aktual tetap ditegakkan di tempat lain — sidebar
// hanya navigasi.
export default function Sidebar({
  active,
  onChange,
  user,
  dashboards = {},        // dipertahankan untuk kompatibilitas pemanggil lama
  plants = [],
  dashboardsFlat = [],
  onDashboardSelect,
  isOpen,
  onClose,
  collapsed = false,
  onToggleCollapse,
}) {
  const navigate = useNavigate();
  const [expandedPlant, setExpandedPlant] = useState(null);
  const [expandedDept, setExpandedDept] = useState(null);
  const [jumlahBaru, setJumlahBaru] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let dibatalkan = false;
    API.get(`/api/notifications/count/${user.id}`)
      .then((res) => { if (!dibatalkan) setJumlahBaru(Number(res.data?.total) || 0); })
      .catch(() => {});
    return () => { dibatalkan = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Plant yang boleh dilihat user.
  const crossPlant = Boolean(user?.cross_plant_access) || user?.role === "admin";
  const userPlantIds = new Set((user?.plants || []).map((p) => Number(p.id)));
  const visiblePlants = (Array.isArray(plants) ? plants : [])
    .filter((p) => crossPlant || userPlantIds.has(Number(p.id)));

  // Dashboard per (plant_id, department_id).
  const dashByKey = new Map();
  for (const d of Array.isArray(dashboardsFlat) ? dashboardsFlat : []) {
    if (d.plant_id == null || d.department_id == null) continue;
    const key = `${d.plant_id}:${d.department_id}`;
    if (!dashByKey.has(key)) dashByKey.set(key, []);
    dashByKey.get(key).push({
      id: d.id, title: d.title, url: d.url, report_id: d.report_id,
      description: d.description, department: d.department_name || d.department || "",
    });
  }

  const handleDashClick = (dash) => {
    if (onDashboardSelect) onDashboardSelect(dash);
    if (onClose) onClose();
  };

  const buatIsi = (varian) => (
    <div className="flex flex-col h-full w-full min-w-[16rem] p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        {/* Sembunyikan sidebar (desktop) */}
        <button onClick={onToggleCollapse}
          className="hidden lg:inline-flex items-center justify-center p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/15 transition-all duration-200 hover:-translate-x-0.5 active:scale-90 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          title="Sembunyikan menu" aria-label="Sembunyikan menu">
          <ChevronsLeft size={18} />
        </button>
        <button onClick={onClose} className="lg:hidden p-1.5 rounded-full hover:bg-white/20 transition ml-auto">
          <X size={18} className="text-white" />
        </button>
      </div>

      {(user?.tipe_akses === "All Access" || user?.tipe_akses === "Department Access Only") && (
        <button
          type="button"
          onClick={() => { navigate("/notifications"); if (onClose) onClose(); }}
          className={`flex items-center gap-3 px-4 py-3 mb-3 rounded-xl transition-all duration-200 w-full hover:scale-[1.02] active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            active === "Notifications"
              ? "bg-white text-cimoryBlue font-semibold shadow-md"
              : "bg-cimoryRed hover:bg-white hover:text-cimoryBlue text-white"
          }`}
        >
          <Bell size={18} />
          <span className="flex-1 text-left">Notifications</span>
          {jumlahBaru > 0 && (
            <span
              className={`min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[11px] font-semibold leading-none flex items-center justify-center ${
                active === "Notifications" ? "bg-cimoryRed text-white" : "bg-white text-cimoryRed"
              }`}
              aria-label={`${jumlahBaru} notifikasi belum dibaca`}
            >
              {jumlahBaru > 9 ? "9+" : jumlahBaru}
            </span>
          )}
        </button>
      )}

      {user?.tipe_akses === "All Access" && (
        <button
          type="button"
          onClick={() => { navigate("/data-center"); if (onClose) onClose(); }}
          className="flex items-center gap-3 px-4 py-3 mb-3 rounded-xl transition-all duration-300 w-full hover:scale-[1.02] active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80
            bg-gradient-to-r from-purple-900 to-cimoryRed hover:from-cimoryRed hover:to-purple-900 text-white shadow-lg hover:shadow-xl"
        >
          <Monitor size={18} />
          <span>Data Center</span>
        </button>
      )}

      {/* Pohon Plant ▸ Department ▸ Dashboard */}
      <ul className="space-y-1">
        {visiblePlants.length === 0 && (
          <li className="px-4 py-3 text-xs text-white/60">Belum ada plant untuk akun ini.</li>
        )}
        {visiblePlants.map((plant) => {
          const plantOpen = expandedPlant === plant.id;
          // Department yang punya dashboard saja.
          const depts = (plant.departments || []).filter(
            (dep) => (dashByKey.get(`${plant.id}:${dep.id}`) || []).length > 0);
          return (
            <li key={`plant-${plant.id}`}>
              <button
                type="button"
                onClick={() => setExpandedPlant((prev) => (prev === plant.id ? null : plant.id))}
                aria-expanded={plantOpen}
                aria-controls={`plant-${varian}-${plant.id}`}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 select-none
                  text-white hover:bg-cimoryRed/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <Factory size={18} className="text-white" />
                <span className="flex-1 text-sm font-semibold">{plant.name}</span>
                <span className="text-[10px] text-white/50">{plant.code}</span>
                {plantOpen
                  ? <ChevronDown size={14} className="text-white/70" />
                  : <ChevronRight size={14} className="text-white/70" />}
              </button>

              <div
                id={`plant-${varian}-${plant.id}`}
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
                  plantOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <ul aria-hidden={!plantOpen} inert={!plantOpen ? "" : undefined}
                  className="overflow-hidden ml-3 mt-0.5 space-y-0.5 border-l border-white/20 pl-2">
                  {depts.length === 0 && (
                    <li className="px-3 py-2 text-[11px] text-white/50">Tidak ada dashboard.</li>
                  )}
                  {depts.map((dep) => {
                    const deptKey = `${plant.id}:${dep.id}`;
                    const deptOpen = expandedDept === deptKey;
                    const items = dashByKey.get(deptKey) || [];
                    return (
                      <li key={`dept-${deptKey}`}>
                        <button
                          type="button"
                          onClick={() => { onChange?.(dep.name); setExpandedDept((prev) => (prev === deptKey ? null : deptKey)); }}
                          aria-expanded={deptOpen}
                          className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                            text-white/90 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                        >
                          <Building2 size={14} className="text-white/70" />
                          <span className="flex-1">{dep.name}</span>
                          {deptOpen
                            ? <ChevronDown size={12} className="text-white/60" />
                            : <ChevronRight size={12} className="text-white/60" />}
                        </button>
                        <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
                          deptOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                          <ul aria-hidden={!deptOpen} inert={!deptOpen ? "" : undefined}
                            className="overflow-hidden ml-3 mt-0.5 space-y-0.5 border-l border-white/15 pl-2">
                            {items.map((dash, idx) => (
                              <li key={idx}
                                onClick={() => handleDashClick(dash)}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/85
                                  hover:bg-white/20 hover:text-white cursor-pointer transition-all duration-150">
                                <LayoutGrid size={12} className="shrink-0 text-white/50" />
                                <span className="truncate">{dash.title}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col shrink-0 bg-cimoryBlue text-white rounded-2xl shadow-lg overflow-hidden
          transition-[width,opacity,transform] duration-300 ease-in-out motion-reduce:transition-none ${
            collapsed ? "w-0 opacity-0 -translate-x-1 pointer-events-none" : "w-64 opacity-100 translate-x-0"
          }`}
        aria-hidden={collapsed}
        inert={collapsed ? "" : undefined}
      >
        {buatIsi("desktop")}
      </aside>

      {/* Rail untuk memunculkan lagi sidebar (desktop) — selalu ter-mount agar transisinya mulus */}
      <button
        type="button"
        onClick={onToggleCollapse}
        title="Tampilkan menu"
        aria-label="Tampilkan menu"
        aria-hidden={!collapsed}
        className={`hidden lg:flex items-center justify-center self-start shrink-0 h-10 overflow-hidden
          rounded-xl bg-cimoryBlue text-white shadow-lg hover:bg-cimoryBlue/90 hover:translate-x-0.5
          transition-[width,opacity,transform] duration-300 ease-in-out motion-reduce:transition-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cimoryBlue/50 ${
            collapsed ? "w-10 opacity-100" : "w-0 opacity-0 pointer-events-none"
          }`}
      >
        <ChevronsRight size={20} className="shrink-0" />
      </button>

      <div
        className={`lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity duration-200 motion-reduce:transition-none ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`lg:hidden fixed top-0 left-0 h-full w-72 bg-cimoryBlue text-white rounded-r-2xl shadow-2xl z-50 flex flex-col
          transition-transform duration-300 ease-out motion-reduce:transition-none ${
            isOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        aria-hidden={!isOpen}
      >
        {buatIsi("mobile")}
      </aside>
    </>
  );
}
