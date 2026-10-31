import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "../types";

export const googleOnly = import.meta.env.VITE_GOOGLE_ONLY === "true";
export const managedAuthEnabled = import.meta.env.VITE_AUTH_PROVIDER === "supabase";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const managedAuthConfigured = Boolean(url && key);
type Database = {
  public: {
    Tables: { brains: { Row: { user_id: string; state: Record<string, unknown>; revision: number; updated_at: string }; Insert: never; Update: never; Relationships: [] } };
    Views: Record<string, never>;
    Functions: { save_brain: { Args: { p_state: unknown; p_revision: number; p_owner_id: string }; Returns: number } };
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
export async function getManagedSession(): Promise<AuthSession> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) throw new Error("Sign in to access your records.");
  return authSession(data.user);
}
export async function signOutManaged() {
  const { error } = await getSupabase().auth.signOut({ scope: "local" });
  if (error) throw error;
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
