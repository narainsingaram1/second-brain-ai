import React, { useState, useEffect } from "react";
import { UserAccount, AuthSession } from "../types";
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  switchUser,
  signOut,
  getAllAccounts,
} from "../services/auth";
import { X, Mail, Lock, User, ArrowRight, LogOut, Database } from "lucide-react";
import confetti from "canvas-confetti";

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
  const [customGoogleEmail, setCustomGoogleEmail] = useState("");
  const [isCustomGoogleOpen, setIsCustomGoogleOpen] = useState(false);
  const [allAccounts, setAllAccounts] = useState<UserAccount[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load existing accounts when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      getAllAccounts().then((accounts) => {
        setAllAccounts(accounts);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async (targetEmail?: string, targetName?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await signInWithGoogle(targetEmail, targetName);
      onSessionChange(result.session);
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.5 },
        colors: ["#4285F4", "#34A853", "#FBBC05", "#EA4335"],
      });
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
        confetti({
          particleCount: 30,
          spread: 50,
          origin: { y: 0.5 },
          colors: ["#10b981", "#3b82f6", "#6366f1"],
        });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-[#12151e] rounded-4xl border border-slate-200/90 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 flex items-center justify-center font-mono font-bold text-xs">
              sb
            </div>
            <div>
              <h3 className="font-extrabold text-sm tracking-tight text-slate-900 dark:text-white">
                {currentUser ? "Your Account" : mode === "signin" ? "Sign In to Synapse" : "Create Account"}
              </h3>
              <p className="text-[11px] text-slate-400">
                {currentUser ? "Database synchronization active" : "Sync tasks, habits, and notes across all logins"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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
              <div className="p-4 rounded-3xl bg-slate-50 dark:bg-[#161a25] border border-slate-200/80 dark:border-slate-800 flex items-center gap-3.5">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-12 h-12 rounded-2xl border border-slate-200 dark:border-slate-700 object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                      {currentUser.name}
                    </span>
                    {currentUser.provider === "google" && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300 text-[10px] font-bold border border-blue-200/60">
                        Google
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">{currentUser.email}</p>
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    <Database className="w-3 h-3" />
                    <span>User Database Connected & Synced</span>
                  </div>
                </div>
              </div>

              {/* Other Accounts to Switch to */}
              {allAccounts.filter((a) => a.id !== currentUser.id).length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Switch Account
                  </span>
                  <div className="space-y-1.5">
                    {allAccounts
                      .filter((a) => a.id !== currentUser.id)
                      .map((acc) => (
                        <button
                          key={acc.id}
                          onClick={() => handleSwitchAccount(acc.id)}
                          className="w-full p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between transition-colors text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={acc.avatar}
                              alt={acc.name}
                              className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 object-cover"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {acc.name}
                              </p>
                              <p className="text-[10px] text-slate-400 truncate">{acc.email}</p>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 shrink-0">
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
                  <span>Sign Out</span>
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
                  onClick={() => handleGoogleSignIn("narainsingaram@gmail.com", "Narain Singaram")}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 shadow-xs hover:shadow-sm font-bold text-xs text-slate-800 dark:text-slate-100 transition-all hover:scale-101 active:scale-99"
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

                {/* Optional Custom Google Account input */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setIsCustomGoogleOpen(!isCustomGoogleOpen)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                  >
                    {isCustomGoogleOpen ? "Hide custom Google account" : "Use custom Google email..."}
                  </button>
                </div>

                {isCustomGoogleOpen && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-2 animate-fade-in">
                    <input
                      type="email"
                      placeholder="your.name@gmail.com"
                      value={customGoogleEmail}
                      onChange={(e) => setCustomGoogleEmail(e.target.value)}
                      className="flex-1 bg-white dark:bg-slate-800 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customGoogleEmail.trim()) {
                          handleGoogleSignIn(customGoogleEmail.trim());
                        }
                      }}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
                    >
                      Login
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Or with email
                </span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              </div>

              {/* Mode Toggle (Sign In / Create Account) */}
              <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    mode === "signin"
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
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
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Email & Password Form */}
              <form onSubmit={handleEmailAuth} className="space-y-3">
                {mode === "signup" && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Full Name
                    </label>
                    <div className="relative flex items-center">
                      <User className="w-3.5 h-3.5 text-slate-400 absolute left-3.5" />
                      <input
                        type="text"
                        required
                        placeholder="Narain Singaram"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address
                  </label>
                  <div className="relative flex items-center">
                    <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3.5" />
                    <input
                      type="email"
                      required
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Password
                  </label>
                  <div className="relative flex items-center">
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3.5" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold pl-9 pr-12 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 text-[10px] text-slate-400 hover:text-slate-600 font-bold"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-3 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-extrabold shadow-sm hover:opacity-90 active:scale-98 transition-all flex items-center justify-center gap-1.5"
                >
                  <span>{mode === "signin" ? "Sign In" : "Create Account & Sync DB"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>

              {/* Existing accounts switcher if any registered */}
              {allAccounts.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Existing Accounts in Database
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {allAccounts.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => handleSwitchAccount(acc.id)}
                        className="w-full p-2 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={acc.avatar}
                            alt={acc.name}
                            className="w-6 h-6 rounded-lg object-cover border border-slate-200"
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate">
                              {acc.name}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                          Log In
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
