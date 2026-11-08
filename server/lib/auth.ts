import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";
import { HttpError } from "./http";

export interface Caller { userId: string; email: string; token: string; client: SupabaseClient }

/**
 * Verifies the caller's Supabase access token and returns a database client that acts as that user,
 * so row-level security applies to every query the server makes on their behalf.
 */
export async function authenticate(request: Request): Promise<Caller> {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sign in to continue.");
  const env = serverEnv();
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session expired. Sign in again.");
  return { userId: data.user.id, email: data.user.email || "", token, client };
}
