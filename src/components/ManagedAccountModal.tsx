import { useState, useEffect } from "react";
import type { AuthSession } from "../types";
import { signOutManaged } from "../services/managedAuth";
import { cloudStatus } from "../services/cloudSync";
import { X, PenLine, LogOut, CheckCircle2, ShieldCheck, AlertCircle } from "lucide-react";

interface ManagedAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession;
}

export function ManagedAccountModal({ isOpen, onClose, session }: ManagedAccountModalProps) {
  const [error, setError] = useState("");
  const [syncState, setSyncState] = useState(cloudStatus());
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const handleSyncStatus = () => setSyncState(cloudStatus());
    window.addEventListener("synapse-sync-status", handleSyncStatus);
    return () => window.removeEventListener("synapse-sync-status", handleSyncStatus);
  }, []);

  if (!isOpen) return null;

  const user = session.currentUser;
  const displayName = user?.name || user?.email?.split("@")[0] || "Account";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  const handleSignOut = async () => {
    if (
      syncState !== "Synced" &&
      !window.confirm("Some recent changes may still be syncing to the cloud. Sign out anyway?")
    ) {
      return;
    }
    setSigningOut(true);
    setError("");
    try {
      await signOutManaged();
      onClose();
    } catch {
      setError("Could not sign out. Try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="workspace-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fade-in">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-raised border border-line flex items-center justify-center text-muted">
              <PenLine className="w-4 h-4 " />
            </div>
            <div>
              <h2 id="account-title" className="font-extrabold text-sm tracking-tight text-ink">
                Your account
              </h2>
              <p className="text-[11px] text-slate-400">Synapse cloud workspace</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div role="alert" className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* User Profile Card */}
          <div className="p-4 rounded-3xl bg-slate-50 dark:bg-[#161a25] border border-line flex items-center gap-3.5">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={displayName}
                className="w-12 h-12 rounded-2xl border border-slate-200 dark:border-slate-700 object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-raised border border-line text-muted font-bold text-sm flex items-center justify-center shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-ink truncate">
                  {displayName}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                    user?.provider === "google"
                      ? "bg-raised text-muted dark:bg-raised dark:text-slate-400 border-line"
                      : "bg-raised text-muted dark:bg-raised dark:text-slate-400 border-line"
                  }`}
                >
                  {user?.provider === "google" ? "Google" : "Email"}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{user?.email}</p>
            </div>
          </div>

          {/* Cloud Sync & Security Badges */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-2xl bg-slate-50/70 dark:bg-slate-900/40 border border-line flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-raised0/10 text-[var(--workspace-success)] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                  {syncState === "Synced" ? "Cloud Synced" : syncState}
                </p>
                <p className="text-[11px] text-slate-400 truncate">PostgreSQL Storage</p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50/70 dark:bg-slate-900/40 border border-line flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-raised0/10 text-muted dark:text-slate-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                  Row isolation
                </p>
                <p className="text-[11px] text-slate-400 truncate">Private to account</p>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted">
            Your tasks, notes, habits, journal, and conversations sync automatically across all devices signed into this account.
          </p>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              disabled={signingOut}
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/60 text-xs font-bold transition-all disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
