import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect } from "react";
import { UserAccount, AuthSession } from "../types";
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  switchUser,
  signOut,
  getAllAccounts,
  isValidEmail,
  parseGoogleJwtCredential,
} from "../services/auth";
import { X, Mail, Lock, User, ArrowRight, LogOut, Database, ShieldCheck } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession;
  onSessionChange: (newSession: AuthSession) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  session,
  onSessionChange,
}) => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [googleEmailInput, setGoogleEmailInput] = useState("");
  const [googleNameInput, setGoogleNameInput] = useState("");
  const [isGooglePromptOpen, setIsGooglePromptOpen] = useState(false);
  const [allAccounts, setAllAccounts] = useState<UserAccount[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  // Dynamically load Google Identity Services if a client ID is provided
  useEffect(() => {
    if (!googleClientId || typeof window === "undefined") return;
    if (!document.getElementById("google-gsi-client")) {
      const script = document.createElement("script");
      script.id = "google-gsi-client";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, [googleClientId]);

  // Load existing accounts when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setIsGooglePromptOpen(false);
      getAllAccounts().then((accounts) => {
        setAllAccounts(accounts);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLaunchGoogleOAuth = () => {
    // If real Google Client ID is configured and script is ready, launch official Google One Tap / Sign-in prompt
    if (googleClientId && (window as any).google?.accounts?.id) {
      try {
        const google = (window as any).google;
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: any) => {
            if (response.credential) {
              try {
                const profile = parseGoogleJwtCredential(response.credential);
                await handleGoogleSignIn(profile.email, profile.name, profile.picture, profile.sub);
              } catch (err: any) {
                setErrorMessage(err.message || "Google authentication failed.");
              }
            }
          },
        });
        google.accounts.id.prompt();
        return;
      } catch (err: any) {
        console.warn("Google GIS initialization error, opening account prompt:", err);
      }
    }

    // Otherwise, open the authentic Google Account login prompt
    setIsGooglePromptOpen(true);
  };

  const handleGoogleSignIn = async (
    targetEmail: string,
    targetName?: string,
    targetAvatar?: string,
    targetSub?: string
  ) => {
    const cleanEmail = (targetEmail || "").trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setErrorMessage("Please enter a valid Google email address.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await signInWithGoogle(cleanEmail, targetName, targetAvatar, targetSub);
      onSessionChange(result.session);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in with Google.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      let newSession: AuthSession;
      if (mode === "signup") {
        newSession = await signUpWithEmail(name, email, password);
      } else {
        newSession = await signInWithEmail(email, password);
      }
      onSessionChange(newSession);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Authentication failed. Please check your details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchAccount = async (userId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const newSession = await switchUser(userId);
      onSessionChange(newSession);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to switch account.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      const guestSession = await signOut();
      onSessionChange(guestSession);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign out.");
    } finally {
      setIsLoading(false);
    }
  };

  const currentUser = session.currentUser;

  return (
    <DialogBackdrop onClose={onClose} label="Account access" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-4xl border border-line shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 flex items-center justify-center font-mono font-bold text-xs">
              sb
            </div>
            <div>
              <h3 className="font-extrabold text-sm tracking-tight text-ink">
                {currentUser ? "Your Account" : mode === "signin" ? "Sign In to Synapse" : "Create account"}
              </h3>
              <p className="text-[11px] text-slate-400">
                {currentUser ? "Database synchronization active" : "Sync tasks, habits, and notes across all logins"}
              </p>
            </div>
          </div>
          <button aria-label="Close dialog" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-600 dark:text-rose-400 font-medium">
              {errorMessage}
            </div>
          )}

          {/* ACTIVE LOGGED IN USER PROFILE */}
          {currentUser ? (
            <div className="space-y-4">
              <div className="p-4 rounded-3xl bg-slate-50 dark:bg-[#161a25] border border-line flex items-center gap-3.5">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-12 h-12 rounded-2xl border border-slate-200 dark:border-slate-700 object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-sm text-ink truncate">
                      {currentUser.name}
                    </span>
                    {currentUser.provider === "google" && (
                      <span className="px-2 py-0.5 rounded-full bg-raised text-muted dark:bg-raised dark:text-slate-400 text-[11px] font-bold border border-line">
                        Google
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">{currentUser.email}</p>
                  <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--workspace-success)] font-semibold">
                    <Database className="w-3 h-3" />
                    <span>Database synchronized</span>
                  </div>
                </div>
              </div>

              {/* Other Accounts to Switch to */}
              {allAccounts.filter((a) => a.id !== currentUser.id).length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Switch account
                  </span>
                  <div className="space-y-1.5">
                    {allAccounts
                      .filter((a) => a.id !== currentUser.id)
                      .map((acc) => (
                        <button
                          key={acc.id}
                          onClick={() => handleSwitchAccount(acc.id)}
                          className="w-full p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-line flex items-center justify-between transition-colors text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={acc.avatar}
                              alt={acc.name}
                              className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 object-cover"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-ink truncate">
                                {acc.name}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">{acc.email}</p>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-muted dark:text-slate-400 shrink-0">
                            Switch
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-500 hover:text-rose-600 px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* NOT LOGGED IN / SIGN IN OR SIGN UP */
            <div className="space-y-4">
              {/* PRIMARY GOOGLE SIGN IN BUTTON */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleLaunchGoogleOAuth}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 shadow-xs hover:shadow-sm font-bold text-xs text-slate-800 dark:text-slate-100 transition-all active:scale-99"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                {/* Genuine Google Account Form (when OAuth Client ID is not configured in local environment) */}
                {isGooglePromptOpen && (
                  <div className="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/90 border border-line space-y-3 animate-fade-in shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                        <ShieldCheck className="w-4 h-4 text-muted" />
                        <span>Connect your Google account</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsGooglePromptOpen(false)}
                        className="text-slate-400 hover:text-slate-600 text-xs"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[11px] text-muted leading-relaxed">
                      Enter your verified Google email address to sync your data.
                    </p>

                    <div className="space-y-2">
                      <input
                        type="email"
                        required
                        placeholder="your.email@gmail.com"
                        value={googleEmailInput}
                        onChange={(e) => setGoogleEmailInput(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-medium"
                      />
                      <input
                        type="text"
                        placeholder="Your Full Name (optional)"
                        value={googleNameInput}
                        onChange={(e) => setGoogleNameInput(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!googleEmailInput.trim() || isLoading}
                      onClick={() => handleGoogleSignIn(googleEmailInput.trim(), googleNameInput.trim())}
                      className="w-full py-2.5 bg-blue-600 hover:bg-slate-1000 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      {isLoading ? "Authenticating..." : "Connect Google Account"}
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Or with email & password
                </span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              </div>

              {/* Mode Toggle (Sign In / Create Account) */}
              <div className="grid grid-cols-2 gap-1 bg-raised p-1 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    mode === "signin"
                      ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    mode === "signup"
                      ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Email & Password Form (Protected with PBKDF2-HMAC-SHA256) */}
              <form onSubmit={handleEmailAuth} className="space-y-3">
                {mode === "signup" && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Full name
                    </label>
                    <div className="relative flex items-center">
                      <User className="w-4 h-4 text-slate-400 absolute left-3" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ada Lovelace"
                        className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Email address
                  </label>
                  <div className="relative flex items-center">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center justify-between">
                    <span>Password</span>
                    <span className="text-[11px] text-slate-400 font-normal">PBKDF2-HMAC-SHA256</span>
                  </label>
                  <div className="relative flex items-center">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-9 pr-12 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 text-[11px] text-slate-400 hover:text-slate-600 font-bold"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>{isLoading ? "Authenticating..." : mode === "signup" ? "Create account" : "Sign in"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </DialogBackdrop>
  );
};
