import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const client = new URL('./synapse/client/', import.meta.url);
await mkdir(client, { recursive: true });
for (const path of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'postcss.config.js', 'tailwind.config.js', 'tsconfig.json', 'tsconfig.node.json']) {
  await cp(new URL(path, root), new URL(path, client), { recursive: true });
}
console.log('Copied application source without environment files or user data.');
