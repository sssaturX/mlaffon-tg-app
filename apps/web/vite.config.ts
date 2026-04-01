import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    /** Не отдаём исходники в .map на проде (усложняет копирование логики). */
    sourcemap: false,
    minify: "esbuild",
    esbuild: {
      /** Убираем отладочный вывод из бандла. */
      drop: ["console", "debugger"],
      legalComments: "none",
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
