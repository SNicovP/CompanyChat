import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = join(__dirname, '../../supabase/migrations')

// Minimal stand-in for the pieces of Supabase the migrations rely on.
const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

let counter = 0
/** Insert an auth user (the signup trigger creates the profile). Returns the user id. */
export async function addUser(db: PGlite, name: string): Promise<string> {
  counter += 1
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name}@example.com`])
  return id
}

/** Run `fn` as the given signed-in user, with RLS enforced. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
