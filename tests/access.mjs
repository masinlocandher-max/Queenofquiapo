// Staff sign-in without a ChatGPT account, end to end: real HTTP into the built Worker, real SQL in a disposable database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {available, createDb, dropDb, exec, fakeSupabase, secret} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const main = 'https://queenofquiapo.com', org = 'https://org.queenofquiapo.com', judgeHost = 'https://judge.queenofquiapo.com', preview = 'https://queen-of-quiapo.fbautisat23.chatgpt.site';
const ownerEmail = 'owner@example.invalid', ownerPassword = 'Panata sa Poong Nazareno 2027';
const chatgptOwner = {'oai-authenticated-user-id': 'owner-id', 'oai-authenticated-user-email': ownerEmail};

function platform(t, extraEnv = {}) {
  const db = createDb('access'), throttle = new DatabaseSync(':memory:');
  throttle.exec(readFileSync(new URL('../drizzle/0001_throttle.sql', import.meta.url), 'utf8'));
  t.after(() => { dropDb(db); throttle.close(); });
  const upstream = fakeSupabase(db), control = {down: false};
  t.mock.method(globalThis, 'fetch', async (url, init) => control.down ? Response.json({message: 'down'}, {status: 500}) : upstream(url, init));
  const env = {REVIEWER_EMAIL: ownerEmail, QOQ_SUPABASE_URL: 'https://synthetic.supabase.co', QOQ_PUBLISHABLE_KEY: 'k', QOQ_SERVER_SECRET: secret, QOQ_RATE_SALT: 'salt',
    DB: {prepare: sql => ({bind: (...a) => ({first: async () => throttle.prepare(sql).get(...a), run: async () => throttle.prepare(sql).run(...a)})})}, ...extraEnv};
  const send = (host, path, {method = 'GET', headers = {}, json, cookie, ip = '198.51.100.7'} = {}) => worker.fetch(new Request(host + path, {method,
    headers: {origin: host, 'cf-connecting-ip': ip, ...(json !== undefined ? {'content-type': 'application/json'} : {}), ...(cookie ? {cookie} : {}), ...headers},
    body: json !== undefined ? JSON.stringify(json) : undefined}), env);
  const login = async (host, email, secretValue, extra = {}) => {
    const r = await send(host, '/api/access/login', {method: 'POST', json: {email, secret: secretValue, ...extra}, ip: extra.ip});
    const setCookie = r.headers.get('set-cookie') || '';
    return {status: r.status, body: await r.json().catch(() => ({})), setCookie, cookie: setCookie.split(';')[0]};
  };
  const act = async (host, name, cookie, data = {}, headers = {}) => { const r = await send(host, '/api/competition/' + name, {method: 'POST', json: data, cookie, headers}); return {status: r.status, body: await r.json()}; };
  return {db, env, send, login, act, control};
}
// The bootstrap script is the documented way to set the first organizer password without ChatGPT.
function setOrganizerPassword(db, email, password) {
  const sql = execFileSync('node', [new URL('../scripts/organizer-password.mjs', import.meta.url).pathname, email], {input: password + '\n'}).toString();
  assert.doesNotMatch(sql, new RegExp(password.split(' ')[0]));          // the plain password is never printed
  exec(db, sql);
}

test('the organizer signs in with email and password, no ChatGPT account involved', {skip}, async t => {
  const {db, send, login, act} = platform(t);
  assert.equal((await login(org, ownerEmail, ownerPassword)).status, 401);   // no password set yet
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  assert.doesNotMatch(exec(db, 'select secret_hash from qoq_private.credentials'), /Panata/);

  for (const [email, password] of [[ownerEmail, 'wrong password here'], ['someone@example.invalid', ownerPassword], [ownerEmail.toUpperCase(), 'nope nope nope']]) {
    const r = await login(org, email, password); assert.equal(r.status, 401); assert.equal(r.body.error, 'That email and password are not correct.'); assert.equal(r.setCookie, '');
  }
  assert.equal((await login(main, ownerEmail, ownerPassword)).status, 404);           // no staff sign-in on the public site
  assert.equal((await send(org, '/api/access/login', {method: 'POST', json: {email: ownerEmail, secret: ownerPassword}, headers: {origin: 'https://evil.invalid'}})).status, 403);

  const ok = await login(org, '  Owner@Example.invalid ', ownerPassword);
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /^__Host-qoq_session=[^;]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal((await send(org, '/', {cookie: ok.cookie})).status, 200);                 // the desk, with no ChatGPT headers at all
  assert.equal((await send(org, '/')).status, 401);
  const gate = await (await send(org, '/')).text();
  assert.match(gate, /\/access\/\?return_to=/); assert.match(gate, /optional/);
  const dash = await act(org, 'organizer.dashboard', ok.cookie);
  assert.equal(dash.status, 200); assert.ok(Array.isArray(dash.body.candidates));
  assert.equal((await act(org, 'organizer.candidate', ok.cookie, {name: 'Alma'})).status, 200);
  assert.match(exec(db, "select actor from qoq_private.audit where action='organizer.candidate'"), /^qoq:organizer:owner@example\.invalid$/);
  assert.deepEqual(await (await send(org, '/api/access/me', {cookie: ok.cookie})).json(), {signedIn: true, email: ownerEmail, via: 'session', role: 'organizer', organizer: true});
  assert.equal((await send(org, '/api/reviewer/applications', {cookie: ok.cookie})).status, 200);   // the application inbox too
  const out = await send(org, '/api/access/logout', {method: 'POST', json: {}, cookie: ok.cookie});
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('ten wrong attempts lock the account for fifteen minutes, even against the right password', {skip}, async t => {
  const {db, login} = platform(t);
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  for (let i = 0; i < 9; i++) assert.equal((await login(org, ownerEmail, 'guess number ' + i, {ip: '203.0.113.' + i})).status, 401);
  assert.equal((await login(org, ownerEmail, 'guess number 10', {ip: '203.0.113.50'})).status, 429);
  assert.equal((await login(org, ownerEmail, ownerPassword, {ip: '203.0.113.51'})).status, 429);
  assert.match(exec(db, "select count(*) from qoq_private.audit where action='access.locked'"), /^1$/);
  exec(db, "update qoq_private.credentials set locked_until=now()-interval '1 second'");
  assert.equal((await login(org, ownerEmail, ownerPassword, {ip: '203.0.113.52'})).status, 200);
});

test('judges sign in with an access code the organizer issues, resets and revokes', {skip}, async t => {
  const {db, send, login, act} = platform(t);
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  const owner = (await login(org, ownerEmail, ownerPassword)).cookie;
  const judgeId = (await act(org, 'organizer.judge', owner, {name: 'Judge Uno', email: 'judge1@example.invalid'})).body.id;
  const k = (await act(org, 'organizer.criterion', owner, {name: 'Overall', weight: 100})).body.id;
  const a = (await act(org, 'organizer.candidate', owner, {name: 'Alma', number: 1})).body.id;
  assert.equal((await login(judgeHost, 'judge1@example.invalid', 'AAAA-BBBB-CCCC')).status, 401);   // no code yet

  const issue = async () => { const r = await send(org, '/api/access/judge-code', {method: 'POST', json: {judgeId}, cookie: owner}); assert.equal(r.status, 200); return (await r.json()).code; };
  assert.equal((await send(org, '/api/access/judge-code', {method: 'POST', json: {judgeId}})).status, 401);   // signed out
  const code = await issue();
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(exec(db, `select count(*) from qoq_private.credentials where secret_hash like '%${code.slice(0, 4)}%'`), '0');
  const status = (await act(org, 'organizer.accessStatus', owner)).body;
  assert.deepEqual(status.judges.map(j => [j.email, j.hasCode]), [['judge1@example.invalid', true]]);

  // Typed on a phone: lower case, spaces instead of dashes.
  const judge = await login(judgeHost, 'judge1@example.invalid', ' ' + code.toLowerCase().replaceAll('-', ' ') + ' ');
  assert.equal(judge.status, 200); assert.match(judge.setCookie, /Max-Age=57600/);
  assert.equal((await send(judgeHost, '/', {cookie: judge.cookie})).status, 200);
  assert.equal((await act(judgeHost, 'judge.ballot', judge.cookie)).body.phase, 'setup');
  assert.equal((await login(org, 'judge1@example.invalid', code)).status, 401);          // a judge code is not an organizer password

  // Role separation on the shared preview hostname, where one cookie covers every path.
  const judgeOnPreview = (await login(preview, 'judge1@example.invalid', code, {role: 'judge'})).cookie;
  assert.equal((await send(preview, '/organizer/', {cookie: judgeOnPreview})).status, 403);
  assert.equal((await act(preview, 'organizer.dashboard', judgeOnPreview)).status, 403);
  const ownerOnPreview = (await login(preview, ownerEmail, ownerPassword, {role: 'organizer'})).cookie;
  assert.equal((await act(preview, 'judge.ballot', ownerOnPreview)).status, 403);

  assert.equal((await act(org, 'organizer.openScoring', owner)).status, 200);
  assert.equal((await act(judgeHost, 'judge.save', judge.cookie, {scores: [{candidateId: a, criterionId: k, score: 90}]})).status, 200);

  // Reset: the old code and every session made with it stop working at once.
  const next = await issue();
  assert.notEqual(next, code);
  assert.equal((await act(judgeHost, 'judge.ballot', judge.cookie)).status, 401);
  assert.equal((await login(judgeHost, 'judge1@example.invalid', code)).status, 401);
  const again = await login(judgeHost, 'judge1@example.invalid', next);
  assert.equal(again.status, 200);
  assert.equal((await act(judgeHost, 'judge.ballot', again.cookie)).body.scores.length, 1);   // the draft is still there
  assert.equal((await act(judgeHost, 'judge.lock', again.cookie)).status, 200);
  assert.equal((await send(org, '/api/access/judge-code', {method: 'POST', json: {judgeId}, cookie: owner})).status, 409);   // no new code after the ballot is locked

  assert.equal((await act(org, 'organizer.revokeJudgeCode', owner, {judgeId})).status, 200);
  assert.equal((await act(judgeHost, 'judge.ballot', again.cookie)).status, 401);
  assert.equal((await login(judgeHost, 'judge1@example.invalid', next)).status, 401);
  for (const action of ['access.signin', 'organizer.setJudgeCode', 'organizer.revokeJudgeCode']) assert.notEqual(exec(db, `select count(*) from qoq_private.audit where action='${action}'`), '0', action);
});

test('forged, altered, expired or foreign session cookies are ignored', {skip}, async t => {
  const {db, send, login, env} = platform(t);
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  const real = (await login(org, ownerEmail, ownerPassword)).cookie;
  const [name, value] = real.split('=');
  const [payload, signature] = value.split('.');
  const decode = p => JSON.parse(Buffer.from(p, 'base64url').toString());
  const encodePayload = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const forged = [
    `${name}=${encodePayload({...decode(payload), r: 'organizer', e: 'attacker@example.invalid'})}.${signature}`,
    `${name}=${encodePayload({...decode(payload), exp: decode(payload).exp + 999999})}.${signature}`,
    `${name}=${payload}.${'A'.repeat(43)}`,
    `${name}=${payload}`,
    `qoq_session=${value}`,
  ];
  for (const cookie of forged) assert.equal((await send(org, '/', {cookie})).status, 401, cookie.slice(0, 40));
  // The same cookie signed under another deployment's secret is worthless here.
  const otherSecret = await worker.fetch(new Request(org + '/', {headers: {cookie: real}}), {...env, QOQ_SERVER_SECRET: 'another-secret-' + 'y'.repeat(40)});
  assert.equal(otherSecret.status, 401);
  // Expiry is enforced even with a valid signature.
  const realNow = Date.now; t.mock.method(Date, 'now', () => realNow() + 13 * 3600 * 1000);
  assert.equal((await send(org, '/', {cookie: real})).status, 401);
});

test('changing the password needs the current one for a password session, and signs other devices out', {skip}, async t => {
  const {db, send, login} = platform(t);
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  const laptop = (await login(org, ownerEmail, ownerPassword)).cookie, phone = (await login(org, ownerEmail, ownerPassword)).cookie;
  const change = (cookie, body, headers = {}) => send(org, '/api/access/password', {method: 'POST', json: body, cookie, headers});
  assert.equal((await change(laptop, {password: 'A completely new phrase'})).status, 401);                  // no current password
  assert.equal((await change(laptop, {current: 'wrong', password: 'A completely new phrase'})).status, 401);
  assert.equal((await change(laptop, {current: ownerPassword, password: 'short'})).status, 422);
  assert.equal((await change(laptop, {current: ownerPassword, password: 'owner-is-my-password'})).status, 422);   // contains the email name
  const r = await change(laptop, {current: ownerPassword, password: 'A completely new phrase'});
  assert.equal(r.status, 200);
  const fresh = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await send(org, '/', {cookie: phone})).status, 401);                                         // other device signed out
  assert.equal((await send(org, '/', {cookie: laptop})).status, 401);
  assert.equal((await send(org, '/', {cookie: fresh})).status, 200);                                         // this device carries on
  assert.equal((await login(org, ownerEmail, ownerPassword)).status, 401);
  assert.equal((await login(org, ownerEmail, 'A completely new phrase')).status, 200);
  // A ChatGPT-signed-in organizer may set the first password without a current one (the in-desk bootstrap).
  exec(db, 'delete from qoq_private.credentials');
  assert.equal((await change(undefined, {password: 'Set from the desk by ChatGPT'}, chatgptOwner)).status, 200);
  assert.equal((await login(org, ownerEmail, 'Set from the desk by ChatGPT')).status, 200);
  assert.equal((await change(undefined, {password: 'Somebody else trying'}, {'oai-authenticated-user-id': 'x', 'oai-authenticated-user-email': 'x@example.invalid'})).status, 403);
});

test('removing a judge ends their session; an outage reads as an outage, not as "please sign in"', {skip}, async t => {
  const {db, send, login, act, control} = platform(t);
  setOrganizerPassword(db, ownerEmail, ownerPassword);
  const owner = (await login(org, ownerEmail, ownerPassword)).cookie;
  const judgeId = (await act(org, 'organizer.judge', owner, {name: 'Judge Dos', email: 'judge2@example.invalid'})).body.id;
  const code = (await (await send(org, '/api/access/judge-code', {method: 'POST', json: {judgeId}, cookie: owner})).json()).code;
  const judge = (await login(judgeHost, 'judge2@example.invalid', code)).cookie;
  control.down = true;
  assert.equal((await act(judgeHost, 'judge.ballot', judge)).status, 503);
  assert.equal((await send(judgeHost, '/', {cookie: judge})).status, 503);
  assert.equal((await send(main, '/api/applications', {method: 'POST', json: {}})).status, 415);              // public intake is not held up by staff checks
  control.down = false;
  assert.equal((await act(org, 'organizer.remove', owner, {kind: 'judge', id: judgeId})).status, 200);
  assert.equal((await act(judgeHost, 'judge.ballot', judge)).status, 401);
  assert.equal((await login(judgeHost, 'judge2@example.invalid', code)).status, 401);
});

test('the sign-in page exists only on staff hostnames, and the old ChatGPT link can be hidden', {skip}, async t => {
  const {send} = platform(t, {QOQ_CHATGPT_SIGNIN: 'off'});
  for (const host of [org, judgeHost, preview]) assert.equal((await send(host, '/access/')).status, 200, host);
  for (const host of [main, 'https://vote.queenofquiapo.com']) assert.equal((await send(host, '/access/')).status, 404, host);
  assert.equal((await send(org, '/organizer/workspace.css')).status, 200);                                    // the sign-in page can be styled before sign-in
  assert.doesNotMatch(await (await send(org, '/')).text(), /ChatGPT/);
});
