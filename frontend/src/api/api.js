import axios from "axios";

const API = axios.create({
  baseURL: "/",
});

// ── Request interceptor — selalu attach JWT token terbaru ──────────────────
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — auto-refresh kalau token expired ───────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

/** Keluarkan user dan bawa ke halaman awal. */
function forceLogout() {
  localStorage.clear();
  window.location.href = "/";
}

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Token masih sah tapi akunnya sudah dihapus atau dicabut. Server sudah
    // benar menolak; tanpa ini frontend hanya mencatat error dan membiarkan
    // user di halaman yang rusak sampai tokennya habis (8 jam) — pencabutan
    // akses jadi tidak terlihat oleh yang bersangkutan.
    //
    // Dibedakan lewat `code`, bukan status: 403 juga dipakai untuk penolakan
    // biasa ("butuh hak admin") pada akun yang masih aktif, dan mengeluarkan
    // user karena itu akan salah.
    if (error.response?.status === 403 && error.response?.data?.code === "ACCOUNT_INACTIVE") {
      forceLogout();
      return Promise.reject(error);
    }

    // Kalau 401 dan bukan dari endpoint refresh/login itu sendiri
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes("/api/login") &&
      !originalRequest.url.includes("/api/refresh-token")
    ) {
      if (isRefreshing) {
        // Kalau sedang refresh, queue request ini sampai refresh selesai
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return API(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(
          "/api/refresh-token",
          {},
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );

        localStorage.setItem("token", data.token);
        API.defaults.headers.common.Authorization = `Bearer ${data.token}`;
        processQueue(null, data.token);

        originalRequest.headers.Authorization = `Bearer ${data.token}`;
        return API(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Refresh gagal — token benar-benar expired, force logout
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default API;
