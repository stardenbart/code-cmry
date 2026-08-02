import { useState, useRef, useEffect } from "react";
import {
  UserPlus, Users, KeyRound, LogOut, LayoutDashboard, Home,
  Menu, MoreVertical, Globe, Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Header({
  user,
  onLogout,
  onAddUserClick,
  onManageUserClick,
  onChangePasswordClick,
  onAISettingsClick,
  onMenuToggle,
}) {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isAdmin =
    user.nama === "Digital Transformer" ||
    user.username === "digital.transformation";

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const IconButton = ({ onClick, icon: Icon, color, tooltip }) => (
    <button
      onClick={onClick}
      className={`p-2 rounded-full transition transform hover:scale-110 ${color}`}
      title={tooltip}
    >
      <Icon className="w-5 h-5 text-white" />
    </button>
  );

  // Mobile action list item
  const MobileAction = ({ onClick, icon: Icon, label, color }) => (
    <button
      onClick={() => { onClick(); setMobileMenuOpen(false); }}
      className={`flex items-center gap-3 w-full px-4 py-3 text-sm font-medium text-white rounded-xl transition-all ${color}`}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );

  return (
    <header className="bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white shadow-md relative z-30">
      <div className="max-w-7xl mx-auto flex justify-between items-center py-3 px-4 lg:py-4 lg:px-6">

        {/* ── Left: sidebar toggle (mobile) + brand ── */}
        <div className="flex items-center gap-2 lg:gap-3">
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-full hover:bg-white/20 transition shrink-0"
            title="Open menu"
          >
            <Menu className="w-5 h-5 text-white" />
          </button>

          <img
            src="/images/Logo_Cimory.png"
            alt="Logo Cimory"
            className="h-7 sm:h-9 lg:h-10 w-auto object-contain drop-shadow-md shrink-0"
          />

          <div className="hidden sm:block">
            <h1 className="text-sm lg:text-lg font-semibold tracking-wide leading-tight">
              Cimory Operational Digital Enhancement
            </h1>
            <p className="text-xs text-white/70">CMD Plant Sentul</p>
          </div>
        </div>

        {/* ── Right: desktop icons | mobile ⋮ button ── */}
        <div className="flex items-center gap-2 lg:gap-4">

          {/* Desktop action icons (hidden on mobile) */}
          <div className="hidden lg:flex items-center gap-3 text-sm italic">
            <span>Logged: <span className="font-semibold">{user.nama}</span></span>

            <IconButton onClick={() => navigate("/cop")} icon={Home}
              color="bg-cimoryBlue/80 hover:bg-cimoryBlue" tooltip="Cimory Operation Portal" />

            {isAdmin && (
              <>
                <IconButton onClick={() => navigate("/dashboard")} icon={LayoutDashboard}
                  color="bg-purple-500 hover:bg-purple-600" tooltip="Dashboard Manager" />
                <IconButton onClick={() => navigate("/portal-manager")} icon={Globe}
                  color="bg-teal-500 hover:bg-teal-600" tooltip="Portal Link Manager" />
                <IconButton onClick={onAddUserClick} icon={UserPlus}
                  color="bg-green-500 hover:bg-green-600" tooltip="Add User" />
                <IconButton onClick={onManageUserClick} icon={Users}
                  color="bg-blue-500 hover:bg-blue-600" tooltip="Manage Users" />
              </>
            )}

            {onAISettingsClick && (
              <IconButton onClick={onAISettingsClick} icon={Sparkles}
                color="bg-indigo-500 hover:bg-indigo-600" tooltip="Pengaturan CODE AI" />
            )}

            <IconButton onClick={onChangePasswordClick} icon={KeyRound}
              color="bg-yellow-500 hover:bg-yellow-600" tooltip="Change Password" />
            <IconButton onClick={onLogout} icon={LogOut}
              color="bg-red-500 hover:bg-red-600" tooltip="Logout" />
          </div>

          {/* Mobile: show name + ⋮ menu button */}
          <span className="lg:hidden text-xs text-white/80 hidden sm:block truncate max-w-[100px]">
            {user.nama}
          </span>
          <div className="lg:hidden relative" ref={menuRef}>
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="p-2 rounded-full hover:bg-white/20 transition"
              title="Actions"
            >
              <MoreVertical className="w-5 h-5 text-white" />
            </button>

            {/* Dropdown */}
            {mobileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 bg-cimoryBlue/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-2 flex flex-col gap-1 z-50">
                <p className="text-xs text-white/50 px-4 pt-1 pb-2 border-b border-white/10 truncate">
                  {user.nama}
                </p>

                <MobileAction onClick={() => navigate("/cop")} icon={Home}
                  label="Operation Portal" color="hover:bg-white/10" />

                {isAdmin && (
                  <>
                    <MobileAction onClick={() => navigate("/dashboard")} icon={LayoutDashboard}
                      label="Admin Dashboard" color="hover:bg-purple-600/60" />
                    <MobileAction onClick={() => navigate("/portal-manager")} icon={Globe}
                      label="Portal Link Manager" color="hover:bg-teal-600/60" />
                    <MobileAction onClick={onAddUserClick} icon={UserPlus}
                      label="Add User" color="hover:bg-green-600/60" />
                    <MobileAction onClick={onManageUserClick} icon={Users}
                      label="Manage Users" color="hover:bg-blue-600/60" />
                  </>
                )}

                {onAISettingsClick && (
                  <MobileAction onClick={onAISettingsClick} icon={Sparkles}
                    label="Pengaturan CODE AI" color="hover:bg-indigo-600/60" />
                )}

                <MobileAction onClick={onChangePasswordClick} icon={KeyRound}
                  label="Change Password" color="hover:bg-yellow-600/60" />

                <div className="border-t border-white/10 mt-1 pt-1">
                  <MobileAction onClick={onLogout} icon={LogOut}
                    label="Logout" color="hover:bg-red-600/60" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
