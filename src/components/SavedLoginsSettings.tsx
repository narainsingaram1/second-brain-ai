import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { hasNativeApproval } from "../services/nativeApproval";
import { vaultCall, type SavedLogin } from "../services/vaultAgent";

/**
 * Saved logins (macOS app only). This window sees sites and partly hidden usernames, like the assistant does;
 * adding, checking and removing happen in the separate Saved logins window, where passwords are typed.
 */
export function SavedLoginsSettings() {
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { setLogins(await vaultCall<SavedLogin[]>("vault_list")); } catch (e) { setMessage(String(e)); } };
  useEffect(() => {
    if (!hasNativeApproval()) return;
    void refresh();
    // The vault window changes the list; catch up when the user comes back here.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  if (!hasNativeApproval()) return null;

  const open = async () => { try { await vaultCall("vault_open"); setMessage(""); } catch (e) { setMessage(String(e)); } };

  return <section className="p-3.5 rounded-2xl border border-line space-y-2" aria-labelledby="saved-logins-heading">
    <h4 id="saved-logins-heading" className="text-xs font-bold text-ink flex items-center gap-1.5">
      <KeyRound className="w-4 h-4 text-muted" aria-hidden="true" />
      Saved logins
    </h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
      Logins are kept only in this Mac's Keychain. The assistant sees the site and a partly hidden username, never a password, and reading a
      password always asks for Touch ID. Signing in with them is coming next; for now the assistant can tell which sites have one.
    </p>
    {logins && <ul className="space-y-1 max-h-40 overflow-y-auto" aria-label="Saved logins">
      {logins.map(l => <li key={l.nickname} className="flex items-center justify-between gap-3 text-xs text-ink">
        <span className="min-w-0 truncate">{l.site.replace(/^https:\/\//, "")}</span>
        <span className="text-slate-400 truncate">{l.username}</span>
      </li>)}
      {!logins.length && <li className="text-[11px] text-slate-400">None saved yet.</li>}
    </ul>}
    <button type="button" onClick={() => void open()} className="px-3 py-2 rounded-xl border border-line text-xs font-bold">Manage saved logins</button>
    {message && <p className="text-[11px] text-slate-500" role="status">{message}</p>}
  </section>;
}
