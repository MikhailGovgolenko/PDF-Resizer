import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const base = process.env.TAURI_ENV_PLATFORM ? "/" : "/PDF-Converter/";

// https://vite.dev/config/
export default defineConfig(async () => ({
  base,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 4321,
    strictPort: true,
    host: "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 4321,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
