import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
if (!process.env.SKIP_CLIENT_INSTALL) {
  const install = spawnSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: new URL('../client/', import.meta.url), stdio: 'inherit', shell: process.platform === 'win32' });
  if (install.status !== 0) process.exit(install.status || 1);
}
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: new URL('../client/', import.meta.url), stdio: 'inherit',
  env: { ...process.env, VITE_CLOUD_SYNC: 'true', VITE_OPENROUTER_API_KEY: '' },
});
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await cp(new URL('../client/dist/', import.meta.url), new URL('../public/', import.meta.url), { recursive: true });
await rename(new URL('../public/index.html', import.meta.url), new URL('../public/synapse.html', import.meta.url));
await rm(new URL('../client/dist/', import.meta.url), { recursive: true });
