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

applyRememberedTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Account builds sign in first, in the browser and in the desktop app alike: without a session the app has no records to load. */}
    {managedAuthEnabled ? <ManagedRoot /> : <App />}
  </React.StrictMode>,
);
