import { useEffect, useRef, useState } from "react";

/**
 * Melaporkan sekali saja saat elemen mendekati layar.
 *
 * Sekali, bukan terus-menerus: yang dipakai untuk memuat iframe Power BI, dan
 * membongkarnya kembali saat digulir menjauh berarti user membayar 7 detik
 * lagi ketika menggulir balik.
 *
 * @param {string} rootMargin Seberapa jauh sebelum masuk layar sudah dianggap
 *   terlihat. Diberi kelonggaran supaya dashboard sudah mulai dimuat sebelum
 *   benar-benar sampai — tidak ada gunanya menunggu sampai user menatap kotak
 *   kosong.
 */
export function useInViewport(rootMargin = "600px") {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;

    // Peramban tanpa IntersectionObserver memuat semuanya seperti sebelumnya;
    // lebih lambat, tapi tidak ada dashboard yang hilang.
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, rootMargin]);

  return [ref, seen];
}
