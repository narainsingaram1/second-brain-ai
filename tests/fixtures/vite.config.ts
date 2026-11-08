import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  cacheDir: "/tmp/synapse-chat-ui-fixture-cache",
  server: { host: "127.0.0.1", port: 1423, strictPort: true },
  // Hosted-account mode against a placeholder project. Fixtures intercept fetch, so nothing is contacted.
  define: {
    "import.meta.env.VITE_AUTH_PROVIDER": JSON.stringify("supabase"),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://fixture.supabase.test"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("fixture-publishable-key"),
  },
});
