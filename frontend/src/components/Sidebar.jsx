import React, { useState, useEffect } from "react";
import API from "../api/api";
import {
  Bell, Factory, Wrench, Boxes, Users, CheckCircle, Shield,
  Cog, Truck, PawPrint, Monitor, RefreshCcw, Landmark,
  ChevronDown, ChevronRight, LayoutGrid, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

const DEPT_ICONS = {
  "Plant":             Factory,
  "Production":        Cog,
  "Dairy Service":     PawPrint,
  "Engineering":       Wrench,
  "PPIC":              Boxes,
  "Quality Control":   CheckCircle,
  "Warehouse":         Truck,
  "PE":                RefreshCcw,
  "HRDGA":             Users,
  "Quality Assurance": Shield,
  "Finance":           Landmark,
};

const DEPT_ORDER = [
  "Plant", "Production", "Dairy Service", "Engineering", "PPIC",
  "Quality Control", "Warehouse", "PE", "HRDGA", "Quality Assurance", "Finance",
];

const expandBtn = {
  rest:  { scale: 1 },
  hover: { scale: 1.02, transition: { type: "spring", stiffness: 260, damping: 18 } },
  tap:   { scale: 0.97 },
};

export default function Sidebar({
  active,
  onChange,
  user,
  canView,
  dashboards = {},
  onDashboardSelect,
  isOpen,
  onClose,
}) {
  const navigate = useNavigate();
  const [expandedDept, setExpandedDept] = useState(null);
  const [jumlahBaru, setJumlahBaru] = useState(0);

  // Endpoint ini sudah ada sejak lama tetapi belum pernah dipakai sidebar,
  // sehingga tidak ada tanda apa pun sampai halaman notifikasi dibuka.
  // Balasannya { total }, bukan { count }.
  useEffect(() => {
    if (!user?.id) return;
    let dibatalkan = false;

    API.get(`/api/notifications/count/${user.id}`)
      .then((res) => { if (!dibatalkan) setJumlahBaru(Number(res.data?.total) || 0); })
      // Diam saja: badge yang gagal dimuat tidak boleh mengganggu navigasi.
      .catch(() => {});

    return () => { dibatalkan = true; };
  }, [user?.id]);

  // Esc menutup drawer di tampilan mobile. Sebelumnya hanya bisa lewat tombol X.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleDeptClick = (name) => {
    const allowed = canView(name) || user?.departemen === name;
    if (!allowed) return;
    onChange(name);
    setExpandedDept((prev) => (prev === name ? null : name));
  };

  const handleDashClick = (dash) => {
    if (onDashboardSelect) onDashboardSelect(dash);
    if (onClose) onClose();
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full p-4 overflow-y-auto">

      {/* Mobile close */}
      <div className="flex justify-end mb-1 lg:hidden">
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white/20 transition"
        >
          <X size={18} className="text-white" />
        </button>
      </div>

      {/* Notifications */}
      {(user?.tipe_akses === "All Access" || user?.tipe_akses === "Department Access Only") && (
        <motion.button
          variants={expandBtn} initial="rest" whileHover="hover" whileTap="tap"
          onClick={() => { navigate("/notifications"); if (onClose) onClose(); }}
          className={`flex items-center gap-3 px-4 py-3 mb-3 rounded-xl transition-all duration-200 w-full ${
            active === "Notifications"
              ? "bg-white text-cimoryBlue font-semibold shadow-md"
              : "bg-cimoryRed hover:bg-white hover:text-cimoryBlue text-white"
          }`}
        >
          <Bell size={18} />
          <span className="flex-1 text-left">Notifications</span>
          {jumlahBaru > 0 && (
            // "9+" menjaga lebar badge tetap, supaya tata letak tombol tidak
            // melompat saat angkanya jadi dua digit.
            <span
              className="min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-cimoryRed text-white text-[11px] font-semibold leading-none flex items-center justify-center"
              aria-label={`${jumlahBaru} notifikasi belum dibaca`}
            >
              {jumlahBaru > 9 ? "9+" : jumlahBaru}
            </span>
          )}
        </motion.button>
      )}

      {/* Data Center */}
      {user?.tipe_akses === "All Access" && (
        <motion.button
          variants={expandBtn} initial="rest" whileHover="hover" whileTap="tap"
          onClick={() => { navigate("/data-center"); if (onClose) onClose(); }}
          className="flex items-center gap-3 px-4 py-3 mb-3 rounded-xl transition-all duration-300 w-full
            bg-gradient-to-r from-purple-900 to-cimoryRed
            hover:from-cimoryRed hover:to-purple-900
            text-white shadow-lg hover:shadow-xl"
        >
          <Monitor size={18} />
          <span>Data Center</span>
        </motion.button>
      )}

      {/* Department list */}
      <ul className="space-y-1">
        {DEPT_ORDER.map((name) => {
          const Icon        = DEPT_ICONS[name] || Factory;
          const isOwnDept   = user?.departemen === name;
          const allowed     = canView(name) || isOwnDept;
          const isActive    = active === name;
          const isExpanded  = expandedDept === name;
          const deptDashes  = dashboards[name] || [];
          const hasDashes   = deptDashes.length > 0;

          return (
            <li key={name}>
              {/* Baris departemen.
                  Dulu sebuah div dengan onClick, sehingga pemakai keyboard
                  tidak bisa menjangkaunya sama sekali: div tidak dapat fokus
                  dan tidak menanggapi Enter atau Space. Sekarang button
                  sungguhan, yang memberi ketiganya tanpa kode tambahan. */}
              <motion.button
                type="button"
                whileHover={allowed ? { scale: 1.02 } : {}}
                whileTap={allowed  ? { scale: 0.97 } : {}}
                onClick={() => handleDeptClick(name)}
                disabled={!allowed}
                aria-expanded={hasDashes ? isExpanded : undefined}
                aria-controls={hasDashes ? `dash-list-${name}` : undefined}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 select-none
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80
                  ${isActive
                    ? "bg-white text-cimoryBlue font-semibold shadow-md"
                    : allowed
                      ? "text-white hover:bg-cimoryRed/90 cursor-pointer"
                      : "opacity-40 text-white cursor-not-allowed"
                  }`}
              >
                <Icon size={18} className={isActive ? "text-cimoryBlue" : "text-white"} />
                <span className="flex-1 text-sm">{name}</span>
                {hasDashes && (
                  isExpanded
                    ? <ChevronDown  size={13} className={isActive ? "text-cimoryBlue" : "text-white/60"} />
                    : <ChevronRight size={13} className={isActive ? "text-cimoryBlue" : "text-white/60"} />
                )}
              </motion.button>

              {/* Dashboard sub-list */}
              <AnimatePresence initial={false}>
                {isExpanded && hasDashes && (
                  <motion.ul
                    key="sub"
                    id={`dash-list-${name}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: "easeInOut" }}
                    className="overflow-hidden ml-3 mt-0.5 space-y-0.5 border-l border-white/20 pl-3"
                  >
                    {deptDashes.map((dash, idx) => (
                      <li
                        key={idx}
                        onClick={() => handleDashClick(dash)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/85
                          hover:bg-white/20 hover:text-white cursor-pointer transition-all duration-150"
                      >
                        <LayoutGrid size={12} className="shrink-0 text-white/50" />
                        <span className="truncate">{dash.title}</span>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar (inline) ── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-cimoryBlue text-white rounded-2xl shadow-lg">
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              key="backdrop"
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              key="drawer"
              className="lg:hidden fixed top-0 left-0 h-full w-72 bg-cimoryBlue text-white rounded-r-2xl shadow-2xl z-50 flex flex-col"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
