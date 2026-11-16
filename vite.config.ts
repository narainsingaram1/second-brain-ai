import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { apiRoutes } from "./scripts/vite-api-plugin";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Server-only settings for the dev API routes (never exposed to the browser bundle).
  for (const key of ["SYNAPSE_SECRETS_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"]) if (env[key] && !process.env[key]) process.env[key] = env[key];

  let supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  let supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  let authProvider = env.VITE_AUTH_PROVIDER || process.env.VITE_AUTH_PROVIDER || "";

  // The hosted web app, where links in account emails land (the desktop app's own address can't open from a browser).
  let publicAppUrl = env.VITE_PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "";
  try {
    const independentConfigPath = path.resolve(process.cwd(), "hosting/independent.json");
    if (fs.existsSync(independentConfigPath)) {
      const config = JSON.parse(fs.readFileSync(independentConfigPath, "utf-8"));
      if (!publicAppUrl && typeof config.liveUrl === "string") publicAppUrl = config.liveUrl;
      if (!supabaseUrl || !supabaseKey) {
        if (!supabaseUrl && config.supabaseUrl) supabaseUrl = config.supabaseUrl;
        if (!supabaseKey && config.supabasePublishableKey) supabaseKey = config.supabasePublishableKey;
        if (!authProvider) authProvider = "supabase";
      }
    }
  } catch {}

  return {
    plugins: [react(), apiRoutes()],
    // approval.html is the desktop app's native approval window (src-tauri/src/approval.rs); vault.html is its
    // Saved logins window (src-tauri/src/vault).
    build: { rollupOptions: { input: { main: path.resolve(process.cwd(), "index.html"), approval: path.resolve(process.cwd(), "approval.html"), vault: path.resolve(process.cwd(), "vault.html") } } },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
      "import.meta.env.VITE_AUTH_PROVIDER": JSON.stringify(authProvider || "supabase"),
      "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(publicAppUrl.replace(/\/$/, "")),
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
