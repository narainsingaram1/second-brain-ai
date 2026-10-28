import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  cacheDir: "/tmp/synapse-chat-ui-fixture-cache",
  server: { host: "127.0.0.1", port: 1423, strictPort: true },
});
