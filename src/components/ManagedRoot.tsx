import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import App from "../App";
import { AppSkeleton } from "./AppSkeleton";
import { clearRetrievalMemory } from "../services/brainRetrieval";
import {
  getSupabase,
  googleOnly,
  googleSignInAvailable,
  managedAuthConfigured,
  signInManagedGoogle,
} from "../services/managedAuth";
import {
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

export function ManagedRoot() {
  const [googleAvailable, setGoogleAvailable] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signin" | "signup" | "reset" | "recovery">(
    new URLSearchParams(window.location.search).has("recovery") ? "recovery" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!managedAuthConfigured) {
      setError("Account service is not configured. Contact the app owner.");
      setLoading(false);
      return;
    }
    let mounted = true;
    googleSignInAvailable()
      .then((available) => {
        if (mounted) setGoogleAvailable(available);
      })
      .catch(() => {});

    let version = 0;
    const client = getSupabase();
    const validate = async () => {
      const current = ++version;
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const result = sessionData.session ? await client.auth.getUser() : null;
        if (result?.error) throw result.error;
        if (mounted && current === version) setUser(result?.data.user || null);
      } catch {
        if (mounted && current === version) {
          setUser(null);
          setError("Could not verify your session. Sign in again or retry.");
        }
      } finally {
        if (mounted && current === version) setLoading(false);
      }
    };

    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && mounted) setMode("recovery");
      if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "PASSWORD_RECOVERY"].includes(event)) {
        if (mounted && event === "SIGNED_OUT") {
          clearRetrievalMemory();
          setUser(null);
          setLoading(false);
        }
        window.setTimeout(() => {
          if (mounted) void validate();
        }, 0);
      }
    });

    void validate();
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const client = getSupabase();
      if (mode === "signup") {
        const trimmedEmail = email.trim().toLowerCase();
        const trimmedName = name.trim();
        if (!trimmedEmail) throw new Error("Please enter your email address.");
        if (password.length < 12) throw new Error("Password must be at least 12 characters.");

        const { data, error: signUpError } = await client.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: trimmedName },
            emailRedirectTo: window.location.origin + "/",
          },
        });
        if (signUpError) throw signUpError;

        if (data.user && !data.session) {
          setNotice(
            `A confirmation link has been sent to ${trimmedEmail}. Open it to finish signing up. Check spam if it is not in your inbox.`
          );
        } else if (data.session) {
          setUser(data.user);
        }
      } else if (mode === "reset") {
        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) throw new Error("Please enter your email address.");
        const { error: resetError } = await client.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: window.location.origin + "/?recovery=1",
        });
        if (resetError) throw resetError;
        setNotice(`If an account exists for ${trimmedEmail}, you will receive a password reset link.`);
      } else if (mode === "recovery") {
        if (password.length < 12) throw new Error("Password must be at least 12 characters.");
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
        window.history.replaceState({}, "", "/");
        setMode("signin");
        setNotice("Password successfully updated. You can now sign in.");
      } else {
        const trimmedEmail = email.trim().toLowerCase();
        const { data, error: signInError } = await client.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (signInError) {
          if (signInError.message?.toLowerCase().includes("email not confirmed")) {
            throw new Error("Your email address has not been confirmed yet. Please check your inbox for the confirmation link.");
          }
          throw new Error("Invalid email or password. Please verify your credentials.");
        }
        if (data.user) setUser(data.user);
      }
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const handleGoogleClick = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await signInManagedGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google authentication failed.");
      setBusy(false);
    }
  };

  if (loading) {
    return <AppSkeleton />;
  }

  if (user && mode !== "recovery") {
    return <App key={user.id} />;
  }

  return (
    <main className="managed-auth-surface min-h-screen text-ink flex items-center justify-center p-4 sm:p-6 relative overflow-hidden select-none">

      <section
        aria-label="Account access"
        className="managed-auth-card w-full max-w-md bg-panel backdrop-blur-2xl border border-white/60 dark:border-slate-800 shadow-2xl rounded-3xl p-6 sm:p-8 relative z-10 animate-fade-in"
      >
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <span className="iris-mark mb-4" style={{ width: 64, height: 64 }} aria-hidden="true" />
          <h1 className="page-title">Iris</h1>
          <p className="text-xs text-muted mt-1">
            Tasks, notes, goals and courses, synced across your devices
          </p>
        </div>

        {/* Tab Switcher (Sign In vs Create Account) */}
        {!googleOnly && (mode === "signin" || mode === "signup") && (
          <div className="flex p-1 bg-slate-100/80 dark:bg-slate-900/80 rounded-2xl mb-5 border border-line">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError("");
                setNotice("");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                mode === "signin"
                  ? "bg-panel text-muted dark:text-[#a5b4fc] shadow-xs"
                  : "text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError("");
                setNotice("");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                mode === "signup"
                  ? "bg-panel text-muted dark:text-[#a5b4fc] shadow-xs"
                  : "text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Status and Error Alerts */}
        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-800/60 text-xs text-rose-600 dark:text-rose-400 font-medium flex items-start gap-2.5 mb-4 animate-fade-in"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{error}</div>
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="p-3.5 rounded-2xl bg-raised border border-line text-xs text-[var(--workspace-success)] font-medium flex items-start gap-2.5 mb-4 animate-fade-in"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{notice}</div>
          </div>
        )}

        {/* Google OAuth Button */}
        {(mode === "signin" || mode === "signup") && (
          <>
            <button
              type="button"
              disabled={busy || !managedAuthConfigured || !googleAvailable}
              onClick={handleGoogleClick}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-panel hover:bg-slate-50 dark:hover:bg-[#1a1e35] text-slate-700 dark:text-slate-200 text-xs font-bold shadow-xs hover:shadow-sm active:scale-[0.99] transition-all disabled:opacity-50"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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

            {!googleAvailable && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
                Requires Google OAuth to be enabled in Supabase
              </p>
            )}

            {!googleOnly && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  or with email
                </span>
                <div className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
              </div>
            )}
          </>
        )}

        {/* Email & Password Form */}
        {!googleOnly && (
          <form onSubmit={submit} className="space-y-3.5">
            {mode === "reset" && (
              <div className="text-xs text-muted mb-2">
                Enter your registered email address and we'll send you a password reset link.
              </div>
            )}

            {mode === "recovery" && (
              <div className="text-xs text-muted mb-2">
                Choose a new secure password for your account.
              </div>
            )}

            {/* Name Input for Signup */}
            {mode === "signup" && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
                  Full name
                </label>
                <div className="relative flex items-center">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Narain Singaram"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-slate-300 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Email Input */}
            {mode !== "recovery" && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
                  Email address
                </label>
                <div className="relative flex items-center">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-slate-300 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Password Input */}
            {mode !== "reset" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted">
                    {mode === "recovery" ? "New password" : "Password"}
                  </label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMode("reset");
                        setError("");
                        setNotice("");
                      }}
                      className="text-[11px] font-semibold text-muted dark:text-slate-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={mode === "signin" ? 1 : 12}
                    maxLength={128}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-10 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-slate-300 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 absolute right-3 transition-colors"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <span className="block text-[11px] text-slate-400 mt-1">
                    At least 12 characters required.
                  </span>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={busy || !managedAuthConfigured || (mode === "recovery" && !user)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold hover:opacity-90 active:scale-[0.99] transition-all shadow-md shadow-slate-950/10 disabled:opacity-50 mt-2"
            >
              {busy ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing…</span>
                </>
              ) : (
                <>
                  <span>
                    {mode === "signup"
                      ? "Create account"
                      : mode === "reset"
                      ? "Send Reset Link"
                      : mode === "recovery"
                      ? "Update Password"
                      : "Sign in"}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer Navigation */}
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-col items-center gap-2.5 text-xs">
          {mode === "reset" && (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError("");
                setNotice("");
              }}
              className="font-semibold text-muted dark:text-slate-400 hover:underline"
            >
              ← Back to Sign In
            </button>
          )}

          <p className="text-[11px] text-slate-500 text-center">
            Sign in to save your workspace to your account and access it on other devices.
          </p>
        </div>
      </section>
    </main>
  );
}
