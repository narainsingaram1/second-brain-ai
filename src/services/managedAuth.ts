import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "../types";
import { clearStartupCache } from "./startupCache";

/** The macOS desktop app (Tauri). Google refuses OAuth inside embedded web views, so it signs in with email there. */
export const isDesktopApp = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
/** Where links in account emails should open: the hosted web app when running on the desktop. */
export const emailLinkOrigin = () => (isDesktopApp && import.meta.env.VITE_PUBLIC_APP_URL) || window.location.origin;
export const googleOnly = import.meta.env.VITE_GOOGLE_ONLY === "true" && !isDesktopApp;
export const managedAuthEnabled = import.meta.env.VITE_AUTH_PROVIDER === "supabase";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const managedAuthConfigured = Boolean(url && key);
type Database = {
  public: {
    Tables: {
      brains: { Row: { user_id: string; state: Record<string, unknown>; revision: number; layout: number; updated_at: string }; Insert: never; Update: never; Relationships: [] };
      brain_records: {
        Row: { user_id: string; collection: string; id: string; data: Record<string, unknown> | null; revision: number; seq: number; ord: number; deleted: boolean; updated_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      study_documents: {
        Row: { user_id: string; id: string; hash: string; content: string; updated_at: string };
        Insert: { user_id: string; id: string; hash: string; content: string; updated_at?: string };
        Update: { hash?: string; content?: string; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_brain: { Args: { p_state: unknown; p_revision: number; p_owner_id: string }; Returns: number };
      migrate_brain_to_records: { Args: Record<string, never>; Returns: { layout: number; moved: number } };
      save_brain_prefs: { Args: { p_state: unknown; p_revision: number }; Returns: number };
      save_brain_prefs_patch: { Args: { p_changes: unknown; p_removed: string[]; p_revision: number }; Returns: number };
      save_records: { Args: { p_changes: unknown }; Returns: unknown };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
let client: SupabaseClient<Database> | undefined;
export function getSupabase() {
  if (!managedAuthConfigured) throw new Error("Account service is not configured. Contact the app owner.");
  if (!client) client = createClient<Database>(url, key, { auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });
  return client;
}
export function authSession(user: User): AuthSession {
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim().slice(0, 100) : "";
  const avatar = typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url.startsWith("https://") ? user.user_metadata.avatar_url : undefined;
  return { isGuest: false, currentUser: {
    id: user.id, email: user.email || "", name: displayName || user.email?.split("@")[0] || "Account",
    avatar, provider: user.app_metadata?.provider === "google" ? "google" : "email",
    createdAt: user.created_at, lastLoginAt: user.last_sign_in_at || user.created_at,
  } };
}
// The account is checked with the server once per page load and signed-in user, and every caller (the sign-in
// gate, the app, cloud sync) shares that check, instead of each making its own round trip at startup.
let verified: { userId: string; promise: Promise<User> } | undefined;
/** The signed-in user from the session saved on this device, without a network request; null when signed out. */
export async function localManagedUser(): Promise<User | null> {
  const { data, error } = await getSupabase().auth.getSession();
  return error ? null : data.session?.user ?? null;
}
/** The signed-in user, confirmed by the account server (shared by all callers for the same user). */
export async function verifiedManagedUser(): Promise<User> {
  const local = await localManagedUser();
  if (!local) throw new Error("Sign in to access your records.");
  if (verified?.userId !== local.id) {
    const promise = getSupabase().auth.getUser().then(({ data, error }) => {
      if (error || !data.user || data.user.id !== local.id) throw new Error("Sign in to access your records.");
      return data.user;
    });
    const entry = { userId: local.id, promise };
    // A failed check (offline, expired session) is retried by the next caller.
    promise.catch(() => { if (verified === entry) verified = undefined; });
    verified = entry;
  }
  return verified.promise;
}
/** Drops the shared check, e.g. after sign-out or when the account's details changed. */
export function forgetVerifiedUser() { verified = undefined; }
export async function getManagedSession(): Promise<AuthSession> {
  return authSession(await verifiedManagedUser());
}
export async function signOutManaged() {
  const { error } = await getSupabase().auth.signOut({ scope: "local" });
  if (error) throw error;
  forgetVerifiedUser();
  await clearStartupCache();
}
export async function signInManagedGoogle() {
  try {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/",
      },
    });
    if (error) throw error;
  } catch (err: any) {
    if (err?.message?.includes("provider is not enabled") || err?.code === "validation_failed") {
      throw new Error(
        `Google provider is not toggled on in Supabase yet. Enable it in Supabase Dashboard (Auth > Providers > Google) using Redirect URI: ${url.replace(/\/$/, "")}/auth/v1/callback. Or use Email & Password below!`
      );
    }
    throw err;
  }
}

export async function signInWithGoogleIdToken(token: string) {
  const { data, error } = await getSupabase().auth.signInWithIdToken({
    provider: "google",
    token,
  });
  if (error) throw error;
  return data;
}

export async function googleSignInAvailable(): Promise<boolean> {
  if (!managedAuthConfigured) return false;
  try {
    const response = await fetch(url.replace(/\/$/, "") + "/auth/v1/settings", {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return true; // optimistic fallback
    const settings = await response.json();
    return settings.external?.google === true;
  } catch {
    return true; // allow clicking if check fails
  }
}
