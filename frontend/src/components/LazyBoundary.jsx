import React, { Suspense, useEffect, useState } from "react";

/**
 * Penanda muat yang baru muncul setelah 200 ms.
 *
 * Di LAN kantor, mengambil chunk 40 KB memakan puluhan milidetik. Menampilkan
 * spinner untuk itu justru terasa lebih lambat daripada tidak menampilkan
 * apa-apa — mata menangkap kedipannya.
 */
function DelayedSpinner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <div className="w-full h-full min-h-[120px] flex items-center justify-center text-gray-400 text-sm animate-pulse">
      Memuat…
    </div>
  );
}

/**
 * React.lazy melempar saat unduhan chunk gagal. Di VPN yang putus-putus itu
 * bukan kejadian teoretis, dan tanpa penanganan hasilnya layar putih.
 */
class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Gagal memuat bagian aplikasi:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="w-full h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-sm text-gray-600">
        <p>Gagal memuat bagian ini. Koneksi mungkin terputus.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 rounded-lg bg-cimoryBlue text-white hover:bg-blue-700 transition"
        >
          Muat ulang
        </button>
      </div>
    );
  }
}

export default function LazyBoundary({ children }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<DelayedSpinner />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}
