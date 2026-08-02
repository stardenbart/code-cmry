import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Dev-proxy target. Must match PORT in backend/.env (default 5050).
  // Override per machine with VITE_BACKEND_TARGET in frontend/.env
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_BACKEND_TARGET || "http://localhost:5050";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        components: path.resolve(__dirname, "./src/components"),
      },
    },
    server: {
      proxy: {
        "/api":     { target, changeOrigin: true },
        "/uploads": { target, changeOrigin: true },
      },
    },
  };
});
