import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Vite exposes VITE_* values publicly. Only public Supabase configuration belongs here.
const config = JSON.parse(readFileSync(new URL('../hosting/independent.json', import.meta.url), 'utf8'));
const url = process.env.VITE_SUPABASE_URL || config.supabaseUrl;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || config.supabasePublishableKey;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) throw new Error('Use your HTTPS Supabase project URL.');
if (key.startsWith('sb_secret_')) throw new Error('A Supabase secret key must never be put in a browser build.');
if (key.startsWith('eyJ')) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon') throw new Error('Only the public anon key may be used in a browser build.');
} else if (!key.startsWith('sb_publishable_')) throw new Error('Expected a Supabase publishable key.');
const env = { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_AUTH_PROVIDER: 'supabase', VITE_GOOGLE_ONLY: config.authMode === 'google' ? 'true' : 'false', VITE_CLOUD_SYNC: 'false', VITE_OPENROUTER_API_KEY: '', VITE_GOOGLE_CLIENT_ID: '' };
for (const command of [['node_modules/typescript/bin/tsc'], ['node_modules/vite/bin/vite.js', 'build', '--mode', 'independent', '--outDir', 'dist-independent']]) {
  const result = spawnSync(process.execPath, command, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const files = readFileSync(resolve('dist-independent/index.html'), 'utf8');
if (!files.includes('/assets/')) throw new Error('Missing built application assets');
console.log('Independent build ready in dist-independent/; no AI or service-role key was supplied.');
