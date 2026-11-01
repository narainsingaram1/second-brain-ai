# Vercel deployment

Vercel hosts the Vite frontend. Supabase provides accounts and persistent PostgreSQL storage.

## Build settings

Use the repository root (leave Root Directory empty), Framework Preset **Vite**, Node.js **22.x**, Install Command `npm ci --include=dev`, Build Command `npm run build`, and Output Directory `dist`. These commands are also in `vercel.json`. Remove conflicting dashboard overrides, especially an empty/skip Install Command.

The failed log was for commit `713c076`. It ran `tsc && vite build` with no TypeScript executable available. The log contains no dependency-install step; the live Vercel dashboard was subsequently verified to have Root Directory set to `src-tauri`, which points at the desktop Rust package rather than the frontend. Clear Root Directory and use the Vite preset. Redeploy the latest pushed commit, not the failed commit. Clearing cache does not change which commit is deployed.

The lockfile matches the package manifest. Build tools are installed even if npm is configured to omit dev dependencies, and the build runs TypeScript checks before bundling.

## Public configuration

The default public Supabase URL and publishable key come from `hosting/independent.json`. To use another project, set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel and rebuild. `VITE_AUTH_PROVIDER=supabase` enables hosted authentication and is the default.

Never put a Supabase secret/service-role key, SMTP password, Google client secret, or private AI key in a `VITE_*` variable: these variables are public browser code. Users should enter their own OpenRouter key in the app; it stays scoped to the account on that device.

## Required Supabase setup

1. Apply `supabase/migrations/202610300001_brain_accounts.sql` once to the selected Supabase project. It creates the private `brains` table and revision-checked `save_brain` RPC. Do not rerun it on an already initialized database.
2. Apply `supabase/migrations/202611010001_task_appearance.sql` to retain task accent and icon preferences in cloud saves. This extends the existing save function without changing account isolation or revision checks.
3. In Authentication > URL Configuration, set Site URL to the exact production Vercel origin. Add that origin followed by `/` and by `/?recovery=1` to Redirect URLs. Keep existing Cloudflare entries if that deployment is still used.
4. Enable Email signups and keep email confirmation on. Configure custom SMTP in Authentication > Emails > SMTP Settings for public signup and password resets. Supabase's default sender only delivers to project-team addresses and has restrictive limits: https://supabase.com/docs/guides/auth/auth-smtp.
5. If offering Google login, enable Google in Authentication > Sign In / Providers and enter its credentials directly there. Use `https://<project-ref>.supabase.co/auth/v1/callback` as the Google OAuth client's authorized callback. Google login is disabled in the UI when Supabase reports the provider is off.

## Storage behavior

Tasks, goals and milestones, habits/history, journal entries, notes and folders, chat history and archived conversations, sections, preferences, daily brief, and audit log are stored in the signed-in user's cloud snapshot. Account access is enforced by database row-level security and the save RPC. There is no hosted guest mode.

Settings > Workspace & Sync shows Saving, Synced, or a failure, alongside export, import, and sign-out controls. Failed saves offer Retry save; export data before closing or reloading after a failure. Conflicts require export and reload; Retry does not overwrite another device's newer version. Snapshots have a 2 MiB limit, so storage is not unlimited. API keys are device-local and excluded from cloud snapshots and exports.

## Verification

Run `npm ci --include=dev`, `npm test`, and `npm run build`. Tests cover PostgreSQL account isolation, full workspace round trips, stale-write rejection, API-key exclusion, deleted-folder/section restoration, and agent persistence failures.

After deployment, create a disposable account, follow the confirmation email back to Vercel, sign out/in, create records across the app, wait for Synced, reload, and sign into the same account in another browser to verify records. Check a second account cannot see them. Exercise password reset and Google separately. Local tests and a successful build do not establish live email delivery or OAuth redirects.

## Verification on October 31, 2026

A fresh install in a temporary copy built successfully. The final workspace passed all 48 tests and the production build. Using the production bundle locally against the actual Supabase project, a temporary dashboard-confirmed account signed in, created a task and note, signed out, and signed back in. Exported workspace contents before and after sign-in matched exactly after normalizing JSON object-key order. This verifies real cloud writes and reads for those records; it does not verify confirmation emails or Vercel redirects.

The live project currently has Google and custom SMTP disabled. Custom SMTP remains required for public email delivery. The Site URL and exact root/recovery redirect URLs are now configured for the verified Vercel production origin, with existing Cloudflare redirects retained. The temporary test account and its synthetic cloud records were deleted after user approval.

The supplied Vercel deployment is https://vercel.com/ur-mommmm-s-projects/second-brain-ai-src-tauri/Hf7pZKLDA7RWuUstCZGa9j7gtk8R. Its project Root Directory was verified as `src-tauri`. After user approval, Root Directory was cleared and the Vite framework preset was saved.

The verified production domain is `https://second-brain-ai-src-tauri.vercel.app`; a production redeploy of main commit `638008b` is now Ready at that domain.

Production deployment verified Ready: https://vercel.com/ur-mommmm-s-projects/second-brain-ai-src-tauri/5rvuDB9cWzGrabUUQnxNEz1Aq9Pt. This deploy uses the existing GitHub commit `638008b`, not the uncommitted local fixes from this session.

The public production origin was opened in the browser and displayed the iris account portal. Live signup confirmation/reset delivery remains unverified because custom SMTP is off.

## Task appearance

Tasks > Appearance offers eight coordinated accent palettes, with separate light and dark colors. Click any section or subsection icon to search 119 icons across eight categories. Preferences are stored in the workspace snapshot, included in backups, and subsection icons follow renames. The production save function was updated and verified to allow `taskAppearance` on November 1, 2026.
