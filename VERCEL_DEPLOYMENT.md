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

Tasks > Appearance offers eight coordinated accent palettes, with separate light and dark colors. Click any section or subsection icon to search 119 icons across eight categories. Each subsection has its own palette button for an independent accent and a choice of eight header artwork styles. These preferences are stored inside `taskAppearance` in the workspace snapshot, included in backups, and follow subsection renames. Cards use opaque surfaces in both themes. The production save function was updated and verified to allow `taskAppearance` on November 1, 2026.

## Agent memory

Apply `supabase/migrations/202611010002_agent_memory.sql` before publishing a frontend that saves `agentMemory`. It extends the existing revision-checked save function and validates the versioned memory collection (500 entries and 256 KiB, within the existing 2 MiB workspace limit). Existing workspaces without the field remain valid. The migration is additive and does not rewrite stored workspaces.

Memory is available in Workspace settings > Memory and through Remembered indicators in chat. Saved context and automatic learning have separate controls. Ordinary durable user statements may be learned through the existing agent tool loop; sensitive information needs an explicit remember request, and common credential formats are rejected. Memory is fallible context, not a replacement for current record retrieval. Users can inspect source quotes, correct/pin/expire/forget memories, and preview selected past-chat suggestions before approving them. Forgetting retains suppression markers, not the removed memory's content; the original conversation remains in history.

Normal recall uses bounded local keyword indexing and no extra extraction call. Optional semantic search uses the existing OpenRouter embedding model and caches by account and memory text. History import is an explicit paid-provider action, limited to four batches per run, and reports incomplete coverage. Temporary chats neither use saved memory nor save their transcript; explicitly requested task/note changes can still persist. A closed or reloaded temporary conversation cannot be recovered.

Disabling memory stops retrieval and automatic learning without deleting data. To roll back the UI, keep the additive database migration and retain the `agentMemory` field in backups; old clients cannot manage this field, and the save RPC preserves existing memory when an older client omits it. Validate the current frontend before asking a model to remember private context.

Validation on November 1, 2026: the production build and 65 automated tests pass. Browser integration checks cover memory persistence/reload/new-chat recall, source controls, pin/edit/forget, approved history import, temporary transcript privacy, account changes during pending work, and desktop/mobile light/dark layouts. The compiled production app was also exercised against the actual Supabase project with a disposable confirmed account: remember, start a new chat, recall, sign out/in, and reload all retained the saved memory. These checks use deterministic intercepted AI responses and a fake device-local provider key, so they verify tool orchestration and real cloud persistence without making paid AI calls. Real-provider model judgment remains dependent on the user's selected model.

## Phase 0: records, server agent and approvals

Three additive changes, each of which the app detects and falls back from until it is live, so they can be rolled out in this order without breaking running clients.

### What changes

- **Per-record storage.** Tasks, notes, events, course items, conversations and agent memory move from the single `brains` snapshot into `brain_records`, one row per record with its own revision. Saves send only what changed. Two devices conflict only when they edit the same record; the version already saved wins and the other device picks it up on refresh (Settings › Workspace & Sync says how many records were updated). Preferences and the open conversation stay in `brains` and merge per field.
- **Encrypted provider keys.** Settings stores the OpenRouter key on the server, encrypted with AES-256-GCM and bound to the account. Browsers only see its last four characters. Browser-side AI features (journal, notes, study tools, search) go through the authenticated `/api/ai` proxy.
- **Server-side assistant.** With a server-held key, each turn runs in `/api/agent` as the signed-in user (row-level security applies; no service-role key is used). Turns over 4.3 MB (large images), desktop, and accounts without a server key keep running in the browser.
- **Approvals and account history.** Deletions, more than five changes in one request, and edits made after reading uploaded documents or past conversations wait for approval in the chat. Settings › "Ask before every change" gates all changes. Proposals, decisions and results are written to `audit_events`, which nobody can edit or delete (Activity log › Account history).

### Rollout

1. **Back up.** In the app, Settings › Workspace & Sync › Export data.
2. **Apply the migrations** in the Supabase SQL editor, in order:
   - `supabase/migrations/202611080001_records.sql`
   - `supabase/migrations/202611080002_secrets_audit_actions.sql`

   Both are additive. Each account moves to records the first time an updated client loads it (`migrate_brain_to_records()`, atomic and idempotent). After that, `save_brain` refuses whole-collection writes from tabs opened before the upgrade, and those tabs are asked to reload.
3. **Set Vercel environment variables** (Production and Preview), then redeploy:
   - `SYNAPSE_SECRETS_KEY`: the output of `openssl rand -base64 32`. Keep a copy somewhere safe. Losing it means everyone re-enters their key. To rotate, set `2:<new>,1:<old>`: new writes use version 2 and old ciphertexts still open.
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (optional; default to the public values in `hosting/independent.json`).

   Never put `SYNAPSE_SECRETS_KEY` in a `VITE_*` variable.
4. **Verify.** `GET /api/health` returns `{"secrets":true,"agent":true,"approvals":true}`. Then, in the app: Settings › move the key to secure storage, ask the assistant to change a task, ask it to delete one and approve the card, and check Activity log › Account history.

### Server code

Routes live in `server/routes/*.ts` as Web `Request`/`Response` handlers. `npm run build:api` bundles each into a self-contained `api/*.js`, which Vercel deploys. Commit the output; `npm run build` and `npm test` fail if it is stale. `npm run dev` serves the same handlers from source (`scripts/vite-api-plugin.ts`). For local server features, put `SYNAPSE_SECRETS_KEY` in `.env.local`. The agent and AI proxy run for up to 300 seconds (`vercel.json`), which needs a Vercel plan that allows that duration.

### Not covered by automated tests

The SQL runs in PGlite with Supabase's roles and `auth.uid()`, and the routes run against it with a mocked AI provider. The live Supabase project, Vercel's function runtime and streaming, and real model behavior are not exercised by the tests. Check them with the verification steps above after deploying.

## Phase 1: Google Calendar and Gmail

The assistant can read your Google Calendar, search and read Gmail, save reply drafts, and add calendar events. It cannot send email: no send permission is requested, and drafts wait in Gmail › Drafts for you.

### What it may do on its own

| Action | Approval |
|---|---|
| Read your calendar; search and read email | Runs on its own |
| Save an email draft | Runs on its own (nothing is sent) |
| Add an event with no guests | Runs on its own |
| Add an event with guests | Always asks (Google emails the invitations) |
| Edit or delete anything after reading an email | Always asks. Email is untrusted: it may contain instructions that are not yours. Adding tasks and drafts after reading email still runs. |

Every connection, disconnection, draft and created event is written to the account history.

### Setup (Google Cloud project `skilled-array-513300-e9`)

1. **APIs & Services › Library:** enable the Gmail API and the Google Calendar API.
2. **OAuth consent screen:**
   - User type External, app name "Synapse", your email as support contact.
   - Add the scopes `openid`, `email`, `.../auth/calendar.events`, `.../auth/calendar.readonly`, `.../auth/gmail.readonly` and `.../auth/gmail.compose`.
   - Under Test users, add every Google account that will connect.
3. **Credentials › Create credentials › OAuth client ID:**
   - Type: Web application.
   - Authorized redirect URIs: `https://second-brain-ai-src-tauri.vercel.app/connect/google` (your production origin) and `http://localhost:1420/connect/google`.
4. **Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`** in Vercel (Production and Preview), and in `.env.local` for `npm run dev`. If your redirect URI differs from `<origin>/connect/google` (custom domain behind a proxy), set `GOOGLE_REDIRECT_URI` to it exactly.
5. **Apply the migration** `supabase/migrations/202611090001_google_connections.sql`, then redeploy.
6. **Verify:**
   - `GET /api/health` reports `"google": true`.
   - In the app, go to Settings › Connections › Connect Calendar + Gmail and approve.
   - Ask "What's on my calendar this week?" and "Triage my unread email."

### Google's review rules: read before relying on it

- **Testing mode:** the consent screen is set to Testing for personal use. Only listed test users can connect, and Google shows an "unverified app" notice. **Google expires refresh tokens issued in Testing after 7 days.** When that happens, Settings › Connections shows *Reconnect*, and the assistant stops using Google until you reconnect.
- **Production for other people:** publishing for other people requires Google's verification. The Gmail scopes are restricted, which also requires an annual third-party security assessment (CASA). Calendar-only connections need verification but no assessment.
- **Revoking access:** disconnecting in Settings revokes the grant at Google and deletes the stored token. You can also remove Synapse at myaccount.google.com/permissions; the app then marks the connection for reconnecting.

### Privacy

Mail and calendar content is fetched live for each request and is not stored by Synapse. The refresh token is encrypted with `SYNAPSE_SECRETS_KEY`, and access tokens live only in memory for one request. A conversation keeps what the assistant wrote about your email in its replies, like any other chat.

### Browser fixture

`npm exec vite -- --config tests/fixtures/vite.config.ts` and open `http://127.0.0.1:1423/tests/fixtures/connections.html` to see the Connections panel, Google events in the calendar, and an approval card for an event with guests. It uses synthetic data and intercepted `/api` responses.
