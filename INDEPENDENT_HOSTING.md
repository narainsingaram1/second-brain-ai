# Independent hosting: Cloudflare + Supabase

The independent build uses Supabase Google/email authentication and per-account PostgreSQL storage. It does not use ChatGPT visitor authentication or the older browser-local account system. The previous Sites deployment is preserved separately.

## Provider configuration

- Supabase project: `second-brain` (`dpmrkkupazorhhmchtxt`), Free plan, North Virginia.
- Public configuration: `hosting/independent.json`. Its publishable key is deliberately public; it cannot bypass database permissions. Never replace it with a secret or service-role key.
- Schema: `supabase/migrations/202610300001_brain_accounts.sql`. Apply once to this project's SQL Editor. Later changes require a new migration.
- Cloudflare deployment configuration: `wrangler.jsonc`. The direct-upload dashboard also accepts a ZIP containing the contents of `dist-independent/`.

## Build and checks

```sh
npm ci
npm test
npm run build:independent
```

The independent build clears build-time OpenRouter/legacy Google keys and fails if given a Supabase secret/service-role key. It writes to `dist-independent/`, separately from desktop/localhost builds. Deploy only this directory. Do not upload source, `.env`, `node_modules`, backups, or the original `dist/`.

The tests exercise the migration in embedded PostgreSQL, including anonymous denial, two-account isolation, RPC-only writes, stale revisions, size validation and exclusion of credentials. They also check safe links, provider identity handling, and semantic cache separation. These tests do not establish provider delivery or a complete live OAuth flow.

## Google provider

Create a Web OAuth client in a Google Cloud project, with only `openid`, email and profile scopes. Configure the exact hosted origin as an authorized JavaScript origin and this callback as the authorized redirect URI:

```
https://dpmrkkupazorhhmchtxt.supabase.co/auth/v1/callback
```

Enter the client ID and secret directly in this Supabase project's Google provider settings. Keep the secret out of browser code, source and terminal output. Google consent audience/production status must permit the intended users; a Testing audience only admits configured test users.

In Supabase Auth URL Configuration, set the exact deployed origin as Site URL, and allow its root URL and `/?recovery=1`. Do not add wildcard production redirects. Keep email confirmations enabled and set the server's minimum password length to 12.

## Email signup and reset

Supabase's built-in sender is for testing and is not suitable for public signup. Configure custom SMTP for production confirmation/reset mail before calling email signup production-ready. Do not disable email confirmation to work around delivery limits. SMTP and Google client secrets belong only in provider settings.

## Security and sync behavior

- The database grants signed-in users only a read policy for their own UUID. No anonymous access or direct client writes are granted.
- The save RPC derives the owner from the verified JWT and checks the expected owner, validates the snapshot, strips non-workspace fields, and rejects stale revisions atomically.
- Cloud snapshots preserve IDs. Apply `supabase/migrations/202611130001_remove_snapshot_limit.sql` to remove the old aggregate 2 MiB cap; provider quotas and per-record limits still apply. Simultaneous edits from different devices can conflict; they are not automatically merged.
- Idle sync checks a revision before retrieving records. Cloud errors preserve visible work and show a status message. Export before reloading after a conflict.
- Hosted workspace records are not copied to the legacy global localStorage/IndexedDB snapshot. AI keys remain account-scoped on each device; enter one separately per account/device.
- The older semantic vault uses per-account memory in this mode, clears on sign-out, and discards old in-flight indexing after an account switch.
- `public/_headers` supplies CSP, anti-framing and content-type protections. Verify that the selected Cloudflare deployment flow applies these headers in production.
- Supabase handles password hashing, tokens and verification. Never use the local app's typed-email Google fallback as hosted authentication.

For migration, Export data from the old app and Import data after signing in to the independent app. Import replaces the current cloud snapshot and excludes API keys. Existing local/Sites records are not automatically migrated or deleted.

Free-tier tradeoffs: Supabase currently includes 50,000 MAU, a 500 MB database and 5 GB egress; inactive free projects may pause after a week. Cloudflare static asset requests are free/unlimited. AI usage and any custom email service have separate limits/costs. Check the provider dashboards before enabling paid plans; no paid plan is required by this setup.

References: https://supabase.com/pricing, https://supabase.com/docs/guides/auth/passwords, https://supabase.com/docs/guides/auth/social-sign-in/auth-google, https://developers.cloudflare.com/workers/platform/pricing/.
