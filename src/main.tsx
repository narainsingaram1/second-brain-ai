import { ManagedRoot } from "./components/ManagedRoot";
import { localManagedUser, managedAuthConfigured, managedAuthEnabled, verifiedManagedUser } from "./services/managedAuth";
import { readStartupCache } from "./services/startupCache";
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

// Start the account check and the read of this device's cached workspace before React renders; the sign-in
// gate and the app reuse both instead of starting them later.
if (managedAuthEnabled && managedAuthConfigured) {
  verifiedManagedUser().catch(() => {});
  localManagedUser().then(user => (user ? readStartupCache(user.id) : null)).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Account builds sign in first, in the browser and in the desktop app alike: without a session the app has no records to load. */}
    {managedAuthEnabled ? <ManagedRoot /> : <App />}
  </React.StrictMode>,
);
