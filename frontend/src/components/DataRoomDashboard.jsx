import { useState } from "react";
import { Home, Monitor, BarChart3, ShieldCheck, DollarSign, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

const PBI_TOOLBAR_HEIGHT = 60;

const DASHBOARDS = {
  service:       { label: "Service Level",           url: "https://app.powerbi.com/view?r=eyJrIjoiODljYTc5MTktYzg1NS00ODNjLTg4YjEtZTJiNGUzMjI2YmRjIiwidCI6ImNhMzczMzQyLTY0ZWUtNDZkNy05NWU4LWNjODEwMjRlOTY4MiIsImMiOjEwfQ%3D%3D" },
  quality:       { label: "Quality",                 url: "https://app.powerbi.com/view?r=eyJrIjoiNGIzMTlhZjAtZDhjYi00NTY3LWJiMTQtOTk5NjcyNjY0N2M3IiwidCI6ImNhMzczMzQyLTY0ZWUtNDZkNy05NWU4LWNjODEwMjRlOTY4MiIsImMiOjEwfQ%3D%3D" },
  cost:          { label: "Cost",                    url: "https://app.powerbi.com/view?r=eyJrIjoiNjBjYjUxZDgtYmM2MC00MmYyLTg4ODgtMTliY2Y1OTVmYmUyIiwidCI6ImNhMzczMzQyLTY0ZWUtNDZkNy05NWU4LWNjODEwMjRlOTY4MiIsImMiOjEwfQ%3D%3D" },
  safetysustain: { label: "Safety & Sustainability", url: "https://app.powerbi.com/view?r=eyJrIjoiMzIxOGQ5ZmMtOTE1MS00YmJhLTkwMGYtNWJlNzliYWRjYTVlIiwidCI6ImNhMzczMzQyLTY0ZWUtNDZkNy05NWU4LWNjODEwMjRlOTY4MiIsImMiOjEwfQ%3D%3D" },
};

function PowerBIFrame({ url, className }) {
  if (!url) return (
    <div className={`${className} flex items-center justify-center bg-gray-900`}>
      <p className="text-gray-400 text-sm">No embed URL configured.</p>
    </div>
  );
  return (
    <div className={`${className} overflow-hidden`}>
      <div style={{ width: "100%", height: `calc(100% + ${PBI_TOOLBAR_HEIGHT}px)`, marginBottom: `-${PBI_TOOLBAR_HEIGHT}px` }}>
        <iframe
          src={url}
          className="w-full h-full border-0"
          allowFullScreen
          title="Power BI Report"
        />
      </div>
    </div>
  );
}

export default function DataRoomDashboard() {
  const [view, setView] = useState("home");

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">

      <div className="fixed top-3 left-3 z-[999] group">
        <div className="w-11 h-11 flex items-center justify-center text-xl cursor-pointer rounded-lg bg-cimoryBlue/95 text-white">
          ☰
        </div>

        <div className="
          absolute top-0 left-9
          w-64
          bg-cimoryBlue/95 backdrop-blur-md
          rounded-r-2xl shadow-xl
          opacity-0 translate-x-[-8px]
          pointer-events-none
          group-hover:opacity-100
          group-hover:translate-x-0
          group-hover:pointer-events-auto
          transition-all duration-300
        ">
          <ul className="p-3 space-y-1 text-white text-sm">
            <li className="flex items-center gap-3 p-3 hover:bg-white/20">
              <Link to="/App" className="flex items-center gap-3 w-full">
                <Home size={16} />
                <span>Central of Digitalization</span>
              </Link>
            </li>
            <li
              className="flex items-center gap-3 p-3 hover:bg-purple-600/70 cursor-pointer"
              onClick={() => setView("home")}
            >
              <Monitor size={16} />
              <span>Data Center</span>
            </li>

            <div className="border-t border-white/20 my-1" />

            <li className="flex items-center gap-3 p-3 hover:bg-white/20 cursor-pointer" onClick={() => setView("service")}>
              <Wrench size={16} />
              <span>Service Level</span>
            </li>
            <li className="flex items-center gap-3 p-3 hover:bg-white/20 cursor-pointer" onClick={() => setView("quality")}>
              <ShieldCheck size={16} />
              <span>Quality</span>
            </li>
            <li className="flex items-center gap-3 p-3 hover:bg-white/20 cursor-pointer" onClick={() => setView("cost")}>
              <DollarSign size={16} />
              <span>Cost</span>
            </li>
            <li className="flex items-center gap-3 p-3 hover:bg-white/20 cursor-pointer" onClick={() => setView("safetysustain")}>
              <BarChart3 size={16} />
              <span>Safety &amp; Sustainability</span>
            </li>
          </ul>
        </div>
      </div>

      {view === "home" && (
        <>
          <PowerBIFrame url={DASHBOARDS.service.url}       className="fixed top-0   left-0   w-1/2 h-1/2" />
          <PowerBIFrame url={DASHBOARDS.quality.url}       className="fixed top-0   left-1/2 w-1/2 h-1/2" />
          <PowerBIFrame url={DASHBOARDS.cost.url}          className="fixed top-1/2 left-0   w-1/2 h-1/2" />
          <PowerBIFrame url={DASHBOARDS.safetysustain.url} className="fixed top-1/2 left-1/2 w-1/2 h-1/2" />
        </>
      )}

      {view !== "home" && (
        <PowerBIFrame url={DASHBOARDS[view].url} className="fixed inset-0 w-screen h-screen" />
      )}
    </div>
  );
}
