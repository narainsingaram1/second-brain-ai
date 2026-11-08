import defaults from "../../hosting/independent.json";

declare const process: { env: Record<string, string | undefined> };

/** Server configuration. Public Supabase settings fall back to the same defaults the web build uses. */
export function serverEnv() {
  const env = typeof process !== "undefined" ? process.env : {};
  return {
    supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL || defaults.supabaseUrl,
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || defaults.supabasePublishableKey,
    /** `base64` or `version:base64[,version:base64…]`; the first entry encrypts, all entries decrypt (for rotation). */
    secretsKey: env.SYNAPSE_SECRETS_KEY || "",
    /** OAuth web client for Google Calendar and Gmail; both required to offer the connection. */
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    /** Optional fixed redirect URI; otherwise `<request origin>/connect/google`. */
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || "",
  };
}
