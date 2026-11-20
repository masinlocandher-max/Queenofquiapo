// The applicant's own journey after submitting: status lookup, a friendly answer to a changed retry, the application window,
// and withdrawal later with the private key. Real HTTP into the built Worker, real SQL in a disposable database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {available, createDb, dropDb, exec, fakeSupabase, secret, intake, rpc, owner} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const main = 'https://queenofquiapo.com';
const jpeg = seed => Uint8Array.from([255, 216, 255, 224, ...Array.from({length: 40}, (_, i) => (seed * 31 + i) % 251), 255, 217]);

function platform(t) {
  const db = createDb('applicant'), media = new Map(), throttle = new DatabaseSync(':memory:');
  throttle.exec(readFileSync(new URL('../drizzle/0001_throttle.sql', import.meta.url), 'utf8'));
  t.after(() => { dropDb(db); throttle.close(); });
  t.mock.method(globalThis, 'fetch', fakeSupabase(db, media));
  const env = {REVIEWER_EMAIL: 'owner@example.invalid', QOQ_SUPABASE_URL: 'https://synthetic.supabase.co', QOQ_PUBLISHABLE_KEY: 'k', QOQ_SERVER_SECRET: secret, QOQ_RATE_SALT: 'salt',
    DB: {prepare: sql => ({bind: (...a) => ({first: async () => throttle.prepare(sql).get(...a), run: async () => throttle.prepare(sql).run(...a)})})}};
  const send = (path, {method = 'GET', headers = {}, json, body, ip = '198.51.100.20'} = {}) => worker.fetch(new Request(main + path, {method,
    headers: {origin: main, 'cf-connecting-ip': ip, ...(json !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: json !== undefined ? JSON.stringify(json) : body}), env);
  const apply = async (fields = {}) => {
    const form = new FormData(), id = fields.submissionId || randomUUID();
    for (const [name, value] of Object.entries({submissionId: id, legalName: 'Juana Dela Cruz', femaleName: 'Reyna Juana', email: 'Juana@Example.invalid', mobile: '', locality: 'Quiapo',
      heightCm: '170', bustIn: '34', waistIn: '26', hipsIn: '35', consent: 'yes', ...fields})) form.set(name, value);
    form.set('portrait', new Blob([jpeg(fields.seed ?? 1)], {type: 'image/jpeg'}), 'portrait.jpg');
    form.set('swimsuit', new Blob([jpeg(2)], {type: 'image/jpeg'}), 'swimsuit.jpg');
    form.delete('seed');
    const r = await send('/api/applications', {method: 'POST', body: form});
    return {status: r.status, body: await r.json(), id};
  };
  const status = async (reference, email, ip) => { const r = await send('/api/applications/status', {method: 'POST', json: {reference, email}, ip}); return {status: r.status, body: await r.json()}; };
  return {db, send, apply, status};
}

test('an applicant can check that her application arrived, and learns nothing she should not', {skip}, async t => {
  const {db, apply, status} = platform(t);
  const {body: receipt} = await apply();
  const ok = await status(receipt.reference.toLowerCase(), '  JUANA@example.invalid ');           // typed loosely on a phone
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ['reference', 'stage', 'submittedAt']);           // nothing else: no name, no photos, no notes
  assert.equal(ok.body.stage, 'received');
  for (const [reference, email] of [[receipt.reference, 'someone@example.invalid'], ['QOQ-0000000000000000', 'juana@example.invalid'], ['nonsense', 'juana@example.invalid'], [receipt.reference, '']]) {
    const r = await status(reference, email);
    assert.equal(r.status, 404); assert.equal(r.body.error, 'No application matches that reference number and email address. Check both and try again.');   // one message for every miss
  }
  const stageAfter = async (...moves) => { for (const move of moves) await intake(db, 'setStatus', {reference: receipt.reference, status: move, actor: 'owner@example.invalid'}); return (await status(receipt.reference, 'juana@example.invalid')).body.stage; };
  assert.equal(await stageAfter('under_review'), 'review');
  assert.equal(await stageAfter('correction_requested'), 'correction');
  assert.equal(await stageAfter('under_review', 'qualified'), 'reviewed');                         // decisions are not disclosed here
  assert.equal(await stageAfter('screened', 'approved'), 'reviewed');
  const declined = await apply({email: 'other@example.invalid'});
  for (const move of ['under_review', 'not_selected']) await intake(db, 'setStatus', {reference: declined.body.reference, status: move, actor: 'owner@example.invalid'});
  assert.equal((await status(declined.body.reference, 'other@example.invalid')).body.stage, 'reviewed');   // "not selected" looks the same as "approved"
});

test('status checks are rate limited per address', {skip}, async t => {
  const {status} = platform(t);
  for (let i = 0; i < 60; i++) assert.equal((await status('QOQ-0000000000000000', 'x@example.invalid', '203.0.113.77')).status, 404);
  assert.equal((await status('QOQ-0000000000000000', 'x@example.invalid', '203.0.113.77')).status, 429);
});

test('a retry with changed content after the first attempt arrived shows that receipt, not a dead end', {skip}, async t => {
  const {db, apply} = platform(t);
  const first = await apply();
  const changed = await apply({submissionId: first.id, legalName: 'Juana M. Dela Cruz'});
  assert.equal(changed.status, 409);
  assert.equal(changed.body.alreadyReceived, true); assert.equal(changed.body.reference, first.body.reference);
  assert.match(changed.body.error, /already arrived/);
  assert.equal(exec(db, 'select count(*) from qoq_private.applications'), '1');
  assert.equal(exec(db, "select profile->>'legalName' from qoq_private.applications"), 'Juana Dela Cruz');         // the first version stands
});

test('the application window is visible before anyone fills the form, and enforced on submission', {skip}, async t => {
  const {db, send, apply} = platform(t);
  const read = async () => (await send('/api/competition/public.applications', {method: 'POST', json: {}})).json();
  assert.equal((await read()).open, true);
  await rpc(db, 'qoq_edition', {p_secret: secret, p_actor: owner.id, p_email: owner.email, p_organizer: true, p_action: 'organizer.edition',
    p_data: {applicationsCloseAt: '2026-12-31T23:59:00+08:00', screeningVenue: 'Barangay 306 Hall'}});
  const open = await read();
  assert.equal(open.open, true); assert.equal(new Date(open.closesAt).toISOString(), '2026-12-31T15:59:00.000Z'); assert.equal(open.screeningVenue, 'Barangay 306 Hall');
  exec(db, "update qoq_private.editions set applications_close_at=now()-interval '1 minute'");
  assert.equal((await read()).open, false);
  const late = await apply();
  assert.equal(late.status, 409); assert.match(late.body.error, /not open/);
  for (const field of ['legalName', 'email', 'heightCm']) assert.ok(!JSON.stringify(await read()).includes(field));   // nothing private in the public read
});

test('withdrawal works later, from any device, with the private key and only with it', {skip}, async t => {
  const {db, send, apply, status} = platform(t);
  const {body: receipt, id: key} = await apply();
  const withdraw = token => send('/api/applications/' + receipt.reference, {method: 'DELETE', headers: {'x-application-token': token}});
  assert.equal((await withdraw(randomUUID())).status, 404);
  assert.equal((await status(receipt.reference, 'juana@example.invalid')).status, 200);
  assert.equal((await withdraw(key)).status, 200);
  assert.equal(exec(db, 'select count(*) from qoq_private.applications'), '0');
  assert.equal((await status(receipt.reference, 'juana@example.invalid')).status, 404);
  assert.match(exec(db, "select actor||' '||action from qoq_private.audit where action='application.removed'"), /^applicant application\.removed$/);
});
