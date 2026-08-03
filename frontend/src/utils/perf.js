// ─────────────────────────────────────────────────────────────────────────────
// Telemetri performa sisi browser.
//
// Aturan utama modul ini: tidak pernah melempar ke pemanggilnya. Telemetri yang
// menjatuhkan fitur yang diukurnya lebih buruk daripada tidak ada telemetri.
// ─────────────────────────────────────────────────────────────────────────────

// Sengaja axios telanjang, BUKAN ../api/api.js. Interceptor di sana menjawab
// 401 dengan mencoba refresh token, dan bila refresh gagal ia menjalankan
// localStorage.clear() lalu redirect ke "/". Telemetri menyala juga di halaman
// login, di mana belum ada token sama sekali — lewat API biasa, pengukuran
// muat halaman justru akan melempar user keluar dari halaman login.
import axios from "axios";

let appLoadMeasured = false;
let pendingAppLoad = null;

function send(payload) {
  const token = localStorage.getItem("token");
  // Tanpa token tidak ada yang bisa dikirim; server menolaknya, dan diam di
  // sini lebih baik daripada permintaan yang pasti gagal.
  if (!token) return false;

  // Dilepas tanpa ditunggu; kegagalan sengaja ditelan.
  axios
    .post("/api/perf", payload, { headers: { Authorization: `Bearer ${token}` } })
    .catch(() => {});
  return true;
}

/**
 * Dipanggil sekali saat React selesai render pertama.
 *
 * Angkanya diambil DI SINI meski belum tentu bisa dikirim sekarang. Jalur
 * masuk yang paling umum adalah mendarat di /login tanpa token, mengetik
 * password, lalu berpindah rute tanpa memuat ulang halaman. Mengukur ulang
 * setelah login akan memasukkan waktu user mengetik ke dalam "waktu muat".
 */
export function markAppReady() {
  if (appLoadMeasured) return;
  appLoadMeasured = true;

  try {
    // performance.timing sudah usang; entri navigasi memberi angka yang
    // relatif terhadap awal navigasi, jadi tidak perlu dikurangi sendiri.
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return;

    pendingAppLoad = {
      kind: "app_load",
      metrics: {
        ttfb:           Math.round(nav.responseStart),
        domInteractive: Math.round(nav.domInteractive),
        appReady:       Math.round(performance.now()),
      },
    };
    flushAppLoad();
  } catch {
    /* pengukuran tidak boleh menjatuhkan aplikasi */
  }
}

/**
 * Mengirim pengukuran muat yang tertunda, bila sekarang sudah ada token.
 * Dipanggil sekali lagi setelah login berhasil.
 */
export function flushAppLoad() {
  if (!pendingAppLoad) return;
  if (send(pendingAppLoad)) pendingAppLoad = null;
}

/**
 * Mengukur satu kali buka dashboard.
 *
 * Memisahkan waktu ambil token dari waktu render Power BI adalah inti dari
 * seluruh instrumentasi ini: kalau render yang mendominasi, kita tahu batas
 * atas perbaikan yang mungkin dan berhenti mengoptimasi bagian yang salah.
 */
export function startDashboardTimer(dashboardId) {
  const t0 = performance.now();
  let tokenAt = null;
  let sent = false;

  return {
    tokenDone() {
      if (tokenAt === null) tokenAt = performance.now();
    },
    renderDone(prefetchHit = false) {
      if (sent) return; // "rendered" menyala lagi tiap ganti filter
      sent = true;
      try {
        const end = performance.now();
        const tokenMs = tokenAt === null ? 0 : tokenAt - t0;
        send({
          kind: "dashboard_open",
          dashboard_id: Number.isInteger(dashboardId) ? dashboardId : null,
          metrics: {
            tokenMs:  Math.round(tokenMs),
            renderMs: Math.round(end - (tokenAt ?? t0)),
            prefetchHit: Boolean(prefetchHit),
          },
        });
      } catch {
        /* abaikan */
      }
    },
  };
}
