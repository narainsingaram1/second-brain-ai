import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const owner = '11111111-1111-4111-8111-111111111111';
export const other = '22222222-2222-4222-8222-222222222222';
const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);

/** A PGlite database with Supabase's roles, auth.uid() and every migration applied in order. */
export async function supabaseLikeDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
  for (const file of (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, migrationsDir), 'utf8'));
  const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated'); };
  return { db, asUser };
}
