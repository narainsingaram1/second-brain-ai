// What the app needs to know before its data has loaded. Storage can throw (private windows, blocked
// site data), and losing either value only means starting on Home in the default theme.

const TAB_KEY = "synapse_active_tab";
const THEME_KEY = "synapse_theme";
const PAGES = ["home", "tasks", "events", "knowledge", "goals", "habits", "journal", "copilot", "workspaces"];

/** The page this browser tab was on, so a reload stays there. A new tab starts on Home. */
export function rememberedTab(): string {
  try {
    const tab = sessionStorage.getItem(TAB_KEY) || "";
    if (tab === "copilot") return "home";
    return PAGES.includes(tab) || tab.startsWith("workspace:") ? tab : "home";
  } catch { return "home"; }
}

export function rememberTab(tab: string) {
  // "workspace-new" opens the create dialog, which should not reappear after a reload.
  try { sessionStorage.setItem(TAB_KEY, tab === "workspace-new" ? "workspaces" : tab); } catch { /* Starts on Home instead. */ }
}

/** Applies the last theme right away, because the saved one only arrives with the user's data. */
export function applyRememberedTheme() {
  try { document.documentElement.classList.toggle("dark", localStorage.getItem(THEME_KEY) === "dark"); } catch { /* Stays light until the data loads. */ }
}

export function rememberTheme(theme: string) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* The next load briefly uses the light theme. */ }
}
