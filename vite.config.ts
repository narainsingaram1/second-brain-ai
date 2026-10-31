import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  let supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  let supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  let authProvider = env.VITE_AUTH_PROVIDER || process.env.VITE_AUTH_PROVIDER || "";

  if (!supabaseUrl || !supabaseKey) {
    try {
      const independentConfigPath = path.resolve(process.cwd(), "hosting/independent.json");
      if (fs.existsSync(independentConfigPath)) {
        const config = JSON.parse(fs.readFileSync(independentConfigPath, "utf-8"));
        if (!supabaseUrl && config.supabaseUrl) supabaseUrl = config.supabaseUrl;
        if (!supabaseKey && config.supabasePublishableKey) supabaseKey = config.supabasePublishableKey;
        if (!authProvider) authProvider = "supabase";
      }
    } catch {}
  }

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
      "import.meta.env.VITE_AUTH_PROVIDER": JSON.stringify(authProvider || "supabase"),
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
