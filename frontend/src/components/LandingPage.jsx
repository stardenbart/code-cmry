import React, { useEffect, useState } from "react";
import { Cpu, ChevronLeft, ChevronRight } from "lucide-react";
import { normalkanUrlUnggahan } from "../utils/uploadUrl";
// Gambar dirujuk lewat path runtime dari public/, bukan diimpor sebagai modul.
//
// Impor `from "/images/..."` diselesaikan Vite dari root proyek, yaitu
// frontend/images/ — bukan public/. Logo yang sama dipakai header.jsx lewat
// path runtime, jadi berkas itu terunduh DUA KALI dengan URL berbeda: satu
// versi ber-hash dari bundler, satu lagi dari public/.

const departments = [
  "Plant", "Dairy Service", "Engineering", "PPIC", "Production",
  "Warehouse", "Quality Control", "HRDGA", "Quality Assurance",
  "Performance Excellence", "Finance & Accounting",
];

const ITEMS_PER_PAGE = 8;

export default function LandingPage() {
  const [links, setLinks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(0);

  useEffect(() => {
    document.title = "Cimory Operation Portal";
    fetch("/api/portal-links")
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => setLinks(Array.isArray(data) ? data : []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, []);

  const totalPages   = Math.max(1, Math.ceil(links.length / ITEMS_PER_PAGE));
  const currentLinks = links.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  // setDir dulu dipanggil di sini, tetapi tidak ada yang pernah membaca
  // nilainya: pageVariants pun tidak memakainya. Kode mati, dibuang.
  const goTo = (next) => setPage(next);

  return (
    <>
      {/* ── Hero ── */}
      <div className="relative min-h-screen overflow-hidden">
        {/* Dulu ini backgroundImage CSS. Diganti <picture> supaya browser bisa
            memilih WebP; latar CSS tidak punya mekanisme negosiasi format.
            object-cover/center menggantikan backgroundSize/Position. */}
        <picture>
          <source srcSet="/images/home_banner_1.webp" type="image/webp" />
          <img
            src="/images/home_banner_1.jpg"
            alt=""
            width={1920}
            height={844}
            /* React 18 belum mengenali camelCase fetchPriority — huruf kecil */
            fetchpriority="high"
            className="absolute inset-0 w-full h-full object-cover object-center -z-10"
          />
        </picture>

        {/* Radial vignette */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at center, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.06) 62%, rgba(255,255,255,0) 78%)",
          }}
        />

        <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 sm:px-8 flex flex-col items-center min-h-screen pt-6 sm:pt-10 pb-24">

          {/* Brand heading */}
          <div className="flex flex-col items-center text-center mb-6 sm:mb-8 animate-rise-in motion-reduce:animate-none">
            <img
              src="/images/Logo_Cimory.png"
              alt="Cimory Logo"
              className="w-28 sm:w-40 lg:w-48 mb-3 drop-shadow-xl"
            />
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold mb-2 text-sky-900 leading-tight tracking-tight"
              style={{ textShadow: "0 0 12px rgba(255,255,255,0.95), 0 0 22px rgba(255,255,255,0.7)" }}
            >
              CIMORY OPERATION PORTAL
            </h1>
            <p
              className="text-base sm:text-lg lg:text-xl text-sky-900 font-semibold"
              style={{ textShadow: "0 0 8px rgba(255,255,255,1), 0 0 16px rgba(255,255,255,0.9)" }}
            >
              Empowering Digitalization for Operational Excellence
            </p>
          </div>

          {/* ── Carousel ── */}
          <div className="w-full flex flex-col items-center gap-4">

            {/* Grid row — arrows only mount when there are multiple pages */}
            <div className={`w-full flex items-center ${totalPages > 1 ? "gap-2 sm:gap-3" : ""}`}>

              {totalPages > 1 && (
                <button
                  onClick={() => goTo(page - 1)}
                  disabled={page === 0}
                  className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/60 backdrop-blur-sm shadow-md flex items-center justify-center text-sky-800 hover:bg-white/90 transition disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={20} strokeWidth={2.5} />
                </button>
              )}

              {/* Grid wrapper — NO overflow-hidden so hover scale is never clipped */}
              <div className="flex-1 py-4">
                {loading ? (
                  <div className="flex flex-wrap justify-center gap-4 sm:gap-5 lg:gap-6">
                    {Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                      <div
                        key={i}
                        className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-2xl bg-white/30 animate-pulse"
                      />
                    ))}
                  </div>
                ) : (
                  // Penyederhanaan yang disengaja: animasi halaman yang KELUAR
                  // dihapus. Menahan elemen keluar tetap terpasang adalah
                  // persisnya pekerjaan AnimatePresence, dan membangunnya ulang
                  // dengan tangan membatalkan tujuan mencabut dependensinya.
                  // Yang dipertahankan animasi halaman MASUK: key pada indeks
                  // halaman membuat React memasang ulang, sehingga animasi CSS
                  // berjalan setiap kali halaman berganti.
                  <div
                    key={page}
                    className="flex flex-wrap justify-center gap-4 sm:gap-5 lg:gap-6 animate-slide-in motion-reduce:animate-none"
                  >
                      {currentLinks.map((link, idx) => (
                        <div
                          key={link.id ?? idx}
                          onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
                          className="cursor-pointer transition-transform duration-200 ease-out
                            hover:scale-[1.14] hover:-translate-y-[7px] hover:drop-shadow-xl
                            motion-reduce:transform-none"
                        >
                          <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 flex items-center justify-center">
                            {link.image_url ? (
                              <img
                                src={normalkanUrlUnggahan(link.image_url)}
                                alt={link.title}
                                className="max-w-full max-h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full rounded-2xl bg-white/55 backdrop-blur-sm flex items-center justify-center text-center text-sky-800 font-semibold text-sm px-3 shadow-sm">
                                {link.title}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {totalPages > 1 && (
                <button
                  onClick={() => goTo(page + 1)}
                  disabled={page === totalPages - 1}
                  className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/60 backdrop-blur-sm shadow-md flex items-center justify-center text-sky-800 hover:bg-white/90 transition disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={20} strokeWidth={2.5} />
                </button>
              )}
            </div>

            {/* Page dots */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2 -mt-2">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === page
                        ? "w-6 h-2.5 bg-sky-700 shadow"
                        : "w-2.5 h-2.5 bg-white/60 hover:bg-white/90"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Dashboard CMD */}
            <button
              type="button"
              onClick={() => window.open("/login", "_blank")}
              className="w-full md:w-3/4 lg:w-1/2 mx-auto px-6 py-4 sm:py-5 rounded-2xl
                bg-gradient-to-r from-sky-600 to-sky-700
                text-white font-semibold text-sm sm:text-base
                flex flex-col items-center justify-center gap-1.5
                shadow-xl shadow-sky-900/30
                transition-transform duration-200 ease-out
                hover:-translate-y-[3px] hover:scale-[1.04] motion-reduce:transform-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <Cpu className="w-7 h-7 sm:w-9 sm:h-9" />
              Dashboard CMD
            </button>
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="w-full bg-cimoryBlue text-white px-4 sm:px-6 py-5 sm:py-6 shadow-inner">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-3 sm:gap-4">
          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-widest text-white/90">
            Available Dashboard
          </h3>
          <div className="flex flex-wrap justify-center gap-x-4 sm:gap-x-6 gap-y-2 text-xs sm:text-sm font-semibold text-white/80">
            {departments.map((dept, idx) => (
              <button
                key={idx}
                onClick={() => window.open("/login", "_blank")}
                className="hover:text-white transition-colors"
              >
                {dept}
              </button>
            ))}
          </div>
          <div className="text-xs text-white/60 text-center mt-1">
            © 2025 Cimory Operation Portal, Digital Transformation
          </div>
        </div>
      </footer>
    </>
  );
}
