import { ManagedRoot } from "./components/ManagedRoot";
import { managedAuthEnabled } from "./services/managedAuth";
import "./chat.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./redesign.css";
import "./pages.css";
import "./forms.css";
import { applyRememberedTheme } from "./utils/startupMemory";

const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

applyRememberedTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {managedAuthEnabled && !isTauri ? <ManagedRoot /> : <App />}
  </React.StrictMode>,
);
