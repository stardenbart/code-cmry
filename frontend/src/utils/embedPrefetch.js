// ─────────────────────────────────────────────────────────────────────────────
// Prefetch embed token saat kursor menyentuh kartu dashboard.
//
// Cakupannya sempit dan itu disengaja. Pengukuran menunjukkan jalur default
// (iframe) tidak memakai token sama sekali — tokenMs-nya 0. Yang ditolong di
// sini adalah jalur embed token, yaitu saat user menekan CODE AI atau
// menyalakan Export Mode dari kartu yang sedang ia arahkan kursornya. Di sana
// pengambilan token dingin terukur 1.395 ms.
//
// Token disimpan HANYA di memori JavaScript — tidak di localStorage maupun
// sessionStorage. Embed token adalah kredensial pembawa untuk sebuah laporan;
// menuliskannya ke penyimpanan yang bertahan membuatnya hidup lebih lama
// daripada tab yang membutuhkannya.
// ─────────────────────────────────────────────────────────────────────────────

import API from "../api/api.js";

const HOVER_DELAY_MS = 150;   // kursor yang cuma melintas tidak memicu apa-apa
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const ready    = new Map(); // reportId -> { config, expiresAt }
const inFlight = new Map(); // reportId -> Promise
const timers   = new Map(); // reportId -> timeout id

/** Perangkat sentuh melaporkan "hover" palsu; jangan prefetch di sana. */
export function canHover() {
  try {
    return window.matchMedia?.("(hover: hover)").matches ?? false;
  } catch {
    return false;
  }
}

function fetchNow(reportId) {
  if (inFlight.has(reportId)) return inFlight.get(reportId);

  const p = API.get(`/api/powerbi/embed-config-by-report/${reportId}`)
    .then(({ data }) => {
      // Masa berlaku datang dari server, bukan durasi tetap yang ditebak klien.
      const expiresAt = new Date(data.tokenExpiry).getTime() - EXPIRY_MARGIN_MS;
      ready.set(reportId, { config: data, expiresAt });
      return data;
    })
    .catch(() => {
      // Diam. User belum meminta apa pun; menampilkan error atas sesuatu yang
      // tidak ia minta hanya membingungkan.
      return null;
    })
    .finally(() => {
      inFlight.delete(reportId);
    });

  inFlight.set(reportId, p);
  return p;
}

/** Dipanggil saat kursor masuk atau kartu mendapat fokus keyboard. */
export function prefetchEmbed(reportId) {
  if (!reportId || !canHover()) return;

  const cached = ready.get(reportId);
  if (cached && Date.now() < cached.expiresAt) return;
  if (inFlight.has(reportId) || timers.has(reportId)) return;

  const id = setTimeout(() => {
    timers.delete(reportId);
    fetchNow(reportId);
  }, HOVER_DELAY_MS);

  timers.set(reportId, id);
}

/** Dipanggil saat kursor pergi sebelum penundaan habis. */
export function cancelPrefetch(reportId) {
  const id = timers.get(reportId);
  if (id) {
    clearTimeout(id);
    timers.delete(reportId);
  }
}

/** Dipakai saat token benar-benar dibutuhkan. null bila tidak ada yang siap. */
export function takeEmbed(reportId) {
  const cached = ready.get(reportId);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    ready.delete(reportId);
    return null;
  }
  return cached.config;
}
