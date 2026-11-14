// Disposable-database helpers. Every suite builds its own database from the migrations and drops nothing in production.
// Requires a local PostgreSQL reachable through QOQ_TEST_PG (default postgres://postgres@127.0.0.1:54329); suites skip when it is absent.
import {execFile, execFileSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {promisify} from 'node:util';

const run = promisify(execFile);
const base = new URL(process.env.QOQ_TEST_PG || 'postgres://postgres@127.0.0.1:54329');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('QOQ_TEST_PG must point to a disposable local database');
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const args = db => ['-h', base.hostname, '-p', base.port || '5432', '-U', base.username || 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
export const secret = 'test-only-' + 'x'.repeat(40);

export function available() {
  try { execFileSync('psql', [...args('postgres'), '-c', 'select 1'], {stdio: 'pipe'}); return true; } catch (error) { if (process.env.QOQ_REQUIRE_TEST_DB === '1') throw new Error('Required PostgreSQL test server is unavailable', {cause:error}); return false; }
}
export function exec(db, sql) { return execFileSync('psql', [...args(db), '-c', sql], {stdio: 'pipe'}).toString().trim(); }
export const migrationFiles = () => readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();

// Creates a clean database with Supabase-like roles and applies migrations (all, or the first `count`).
export function createDb(label, {count, settings = true} = {}) {
  const db = 'qoq_' + label + '_' + randomBytes(4).toString('hex');
  exec('postgres', 'create database ' + db);
  for (const role of ['anon', 'authenticated', 'service_role']) exec('postgres', `do $$ begin create role ${role}; exception when duplicate_object or unique_violation then null; end $$`);
  exec(db, 'create schema storage; create table storage.objects(id uuid, bucket_id text); create table storage.buckets(id text); alter table storage.objects enable row level security; alter table storage.buckets enable row level security');
  migrate(db, migrationFiles().slice(0, count));
  if (settings) exec(db, `insert into qoq_private.settings(secret_hash) values ('${createHash('sha256').update(secret).digest('hex')}')`);
  return db;
}
export function migrate(db, files) {
  for (const file of files) execFileSync('psql', [...args(db), '-f', new URL(file, migrations).pathname], {stdio: 'pipe'});
}
export function dropDb(db) { try { exec('postgres', 'drop database if exists ' + db + ' with (force)'); } catch {} }

function statement(fn, params) {
  const tag = '$q' + randomBytes(6).toString('hex') + '$';
  const literal = value => value === null || value === undefined ? 'null' : typeof value === 'boolean' ? String(value)
    : typeof value === 'object' ? tag + JSON.stringify(value) + tag + '::jsonb' : tag + String(value) + tag;
  return 'select public.' + fn + '(' + Object.entries(params).map(([key, value]) => key + '=>' + literal(value)).join(',') + ')';
}
function failure(error) {
  const match = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(String(error.stderr || error.message));
  return {error: match ? {code: match[1], message: match[2].trim()} : {code: 'XX000', message: String(error.stderr || error.message)}};
}
// Returns the function result, or {error:{code,message}} with the SQLSTATE, exactly as PostgREST would report it.
export async function rpc(db, fn, params) {
  try { return JSON.parse((await run('psql', [...args(db), '-c', statement(fn, params)])).stdout.trim()); }
  catch (error) { return failure(error); }
}
const call = fn => (db, actor, action, data = {}) => rpc(db, fn, {p_secret: secret, p_actor: actor?.id ?? '', p_email: actor?.email ?? '', p_organizer: Boolean(actor?.organizer), p_action: action, p_data: data});
export const ops = call('qoq_operations');
export const points = call('qoq_points');
export const intake = (db, action, data = {}) => rpc(db, 'qoq_intake', {p_secret: secret, p_action: action, p_data: data});
export const owner = {id: 'owner-id', email: 'owner@example.invalid', organizer: true};
export const ok = result => { if (result?.error) throw Error(result.error.code + ' ' + result.error.message); return result; };

// A stand-in for the Supabase REST and media endpoints, backed by the disposable database and an in-memory object store.
export function fakeSupabase(db, media = new Map()) {
  return async (url, init = {}) => {
    const {pathname} = new URL(url);
    if (pathname.startsWith('/rest/v1/rpc/')) {
      const result = await rpc(db, pathname.slice('/rest/v1/rpc/'.length), JSON.parse(init.body));
      return result?.error ? Response.json(result.error, {status: 400}) : Response.json(result);
    }
    const path = pathname.split('/qoq-media').pop();
    if (path === '/remove') { for (const key of JSON.parse(init.body).keys) media.delete(key); return Response.json({ok: true}); }
    const key = path.slice('/object/'.length);
    if (init.method === 'POST') { media.set(key, {bytes: new Uint8Array(init.body), type: init.headers['Content-Type']}); return Response.json({ok: true}, {status: 201}); }
    const found = media.get(key);
    return found ? new Response(found.bytes, {headers: {'Content-Type': found.type}}) : Response.json({error: 'Not found'}, {status: 404});
  };
}
