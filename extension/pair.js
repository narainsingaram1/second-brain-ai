const params = new URLSearchParams(location.search);
const id = params.get("id") || "";
document.getElementById("origin").textContent = params.get("origin") || "A Synapse app";
const decide = allow => chrome.runtime.sendMessage({ type: "pair-decision", id, allow }, () => window.close());
document.getElementById("allow").addEventListener("click", () => decide(true));
document.getElementById("deny").addEventListener("click", () => decide(false));
