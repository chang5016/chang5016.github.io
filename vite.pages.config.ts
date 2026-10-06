// Static single-page build for GitHub Pages (no Worker / server runtime).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist-pages",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
