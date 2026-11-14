// End to end: real HTTP requests into the built Worker, real SQL in a disposable PostgreSQL database,
// an in-memory stand-in for private photo storage. No production system is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {available, createDb, dropDb, exec, fakeSupabase, secret} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const main = 'https://queenofquiapo.com', org = 'https://org.queenofquiapo.com', judgeHost = 'https://judge.queenofquiapo.com', vote = 'https://vote.queenofquiapo.com';
const preview = 'https://queen-of-quiapo.fbautisat23.chatgpt.site';
const owner = {'oai-authenticated-user-id': 'owner-id', 'oai-authenticated-user-email': 'owner@example.invalid'};
const stranger = {'oai-authenticated-user-id': 'someone', 'oai-authenticated-user-email': 'someone@example.invalid'};
const jpeg = seed => Uint8Array.from([255, 216, 255, 224, ...Array.from({length: 40}, (_, i) => (seed * 31 + i) % 251), 255, 217]);
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82, 0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222, 0,0,0,0,73,69,78,68,174,66,96,130]);

function platform(t, extraEnv = {}) {
  const db = createDb('e2e'), media = new Map(), throttle = new DatabaseSync(':memory:');
  throttle.exec(readFileSync(new URL('../drizzle/0001_throttle.sql', import.meta.url), 'utf8'));
  t.after(() => { dropDb(db); throttle.close(); });
  const upstream = fakeSupabase(db, media);
  const control = {failRpc: null, loseAck: null};
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (control.failRpc && String(url).includes('/rpc/') && control.failRpc(JSON.parse(init.body))) return Response.json({message: 'upstream down'}, {status: 500});
    if (control.loseAck && String(url).includes('/rpc/') && control.loseAck(JSON.parse(init.body))) { await upstream(url, init); return Response.json({message: 'connection reset'}, {status: 502}); }
    return upstream(url, init);
  });
  const env = {REVIEWER_EMAIL: 'owner@example.invalid', QOQ_SUPABASE_URL: 'https://synthetic.supabase.co', QOQ_PUBLISHABLE_KEY: 'public-test-key', QOQ_SERVER_SECRET: secret,
    QOQ_RATE_SALT: 'salt', DB: {prepare: sql => ({bind: (...a) => ({first: async () => throttle.prepare(sql).get(...a), run: async () => throttle.prepare(sql).run(...a)})})}, ...extraEnv};
  const send = (host, path, {method = 'GET', headers = {}, json, body} = {}) => worker.fetch(new Request(host + path, {method,
    headers: {origin: host, ...(json !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: json !== undefined ? JSON.stringify(json) : body}), env);
  const act = async (host, name, headers, data = {}) => { const r = await send(host, '/api/competition/' + name, {method: 'POST', headers, json: data}); return {status: r.status, body: await r.json()}; };
  return {db, media, env, send, act, control};
}
function applicationForm(overrides = {}) {
  const form = new FormData();
  const fields = {submissionId: randomUUID(), legalName: 'Juana Dela Cruz', femaleName: 'Reyna Juana', email: 'juana@example.invalid', mobile: '09170000001', locality: 'Quiapo, Manila',
    heightCm: '171.5', bustIn: '34', waistIn: '26', hipsIn: '35', talent: 'Folk dance', experience: '', motivation: 'Panata', consent: 'yes', ...overrides};
  for (const [name, value] of Object.entries(fields)) if (value !== undefined && !(value instanceof Blob)) form.set(name, value);
  form.set('portrait', overrides.portrait ?? new Blob([jpeg(1)], {type: 'image/jpeg'}), 'face.jpg');
  form.set('swimsuit', overrides.swimsuit ?? new Blob([png], {type: 'image/png'}), 'full.png');
  return form;
}

test('an application is confirmed only after it is stored, and retries never duplicate it', {skip}, async t => {
  const {db, media, send, control} = platform(t);
  const submit = form => send(main, '/api/applications', {method: 'POST', body: form});
  const count = () => exec(db, 'select count(*) from qoq_private.applications');

  // Rejected inputs store nothing.
  for (const [bad, status] of [[{email: 'not-an-email'}, 422], [{heightCm: '-4'}, 422], [{heightCm: 'tall'}, 422], [{heightCm: '5.6'}, 422], [{waistIn: '260'}, 422], [{legalName: ''}, 422], [{consent: undefined}, 422], [{submissionId: 'x'}, 422],
    [{portrait: new Blob(['GIF89a not a photo'], {type: 'image/jpeg'})}, 415], [{swimsuit: new Blob([new Uint8Array(5 * 1024 * 1024 + 10)], {type: 'image/jpeg'})}, 413], [{unexpected: 'field'}, 422]]) {
    assert.equal((await submit(applicationForm(bad))).status, status, JSON.stringify(Object.keys(bad)));
  }
  assert.equal((await send(main, '/api/applications', {method: 'POST', body: applicationForm(), headers: {origin: 'https://evil.invalid'}})).status, 403);   // cross-site form post
  assert.equal(count(), '0'); assert.equal(media.size, 0);

  // Storage succeeds but the database is down: the applicant is not told it was received, and the uploads are cleaned up.
  control.failRpc = body => body.p_action === 'create';
  const id = randomUUID();
  assert.equal((await submit(applicationForm({submissionId: id}))).status, 503);
  assert.equal(count(), '0'); assert.equal(media.size, 0);
  control.failRpc = null;

  // The same submission retried, double-clicked and re-sent concurrently yields one record and one receipt.
  const answers = await Promise.all(Array.from({length: 6}, () => submit(applicationForm({submissionId: id}))));
  const receipts = await Promise.all(answers.map(r => r.json()));
  assert.ok(answers.every(r => [200, 201].includes(r.status)), answers.map(r => r.status).join());
  assert.equal(new Set(receipts.map(r => r.reference)).size, 1);
  assert.match(receipts[0].reference, /^QOQ-[A-F0-9]{16}$/);
  assert.ok(!Number.isNaN(Date.parse(receipts.find(r => r.submittedAt).submittedAt)));
  assert.equal(count(), '1'); assert.equal(media.size, 2);                                   // exactly one pair of photographs kept
  // The same submission id with different content is refused rather than overwritten.
  assert.equal((await submit(applicationForm({submissionId: id, legalName: 'Someone Else'}))).status, 409);

  // Lost acknowledgement: the record commits but the response is lost. The receipt is still issued, with nothing deleted.
  const lost = randomUUID();
  control.loseAck = body => body.p_action === 'create';
  assert.equal((await submit(applicationForm({submissionId: lost, email: 'second@example.invalid'}))).status, 200);
  control.loseAck = null;
  assert.equal(count(), '2'); assert.equal(media.size, 4);

  // The applicant can withdraw with the token only their browser holds; a guess cannot.
  const ref = receipts[0].reference;
  const withdraw = token => send(main, '/api/applications/' + ref, {method: 'DELETE', headers: {'x-application-token': token}});
  assert.equal((await withdraw(randomUUID())).status, 404);
  assert.equal((await withdraw(id)).status, 200);
  assert.equal(count(), '1'); assert.equal(media.size, 2);
});

test('only the organizer can read applications; review, status and promotion work through the private host', {skip}, async t => {
  const {send, act} = platform(t);
  const receipt = await (await send(main, '/api/applications', {method: 'POST', body: applicationForm()})).json();
  const base = '/api/reviewer/applications', one = base + '/' + receipt.reference;
  // No route to private records from the public host, a signed-out visitor, another account, or a reference number alone.
  for (const [host, headers, status] of [[main, owner, 404], [vote, owner, 404], [judgeHost, owner, 404], [org, {}, 401], [org, stranger, 403]])
    for (const path of [base, one, one + '/portrait', '/api/reviewer/export.csv']) assert.equal((await send(host, path, {headers})).status, status, host + path);
  assert.equal((await send(org, one + '/status', {method: 'POST', headers: stranger, json: {status: 'approved'}})).status, 403);
  assert.equal((await send(org, one + '/status', {method: 'POST', headers: {...owner, origin: 'https://evil.invalid'}, json: {status: 'under_review'}})).status, 403);

  const list = await (await send(org, base + '?status=submitted&q=reyna', {headers: owner})).json();
  assert.deepEqual(list.applications.map(a => [a.reference, a.status]), [[receipt.reference, 'submitted']]);
  const detail = (await (await send(org, one, {headers: owner})).json()).application;
  assert.equal(detail.legalName, 'Juana Dela Cruz'); assert.equal(detail.heightCm, 171.5); assert.ok(!('storageKey' in detail));
  const photo = await send(org, one + '/portrait', {headers: owner});
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/jpeg'); assert.match(photo.headers.get('cache-control'), /no-store/);
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), jpeg(1));

  const move = async status => (await send(org, one + '/status', {method: 'POST', headers: owner, json: {status, note: 'ok'}})).status;
  assert.equal(await move('approved'), 409);                                                // cannot skip screening
  for (const s of ['under_review', 'qualified', 'screened', 'approved']) assert.equal(await move(s), 200);
  assert.equal((await send(org, one + '/note', {method: 'POST', headers: owner, json: {note: 'Confirmed attendance'}})).status, 200);
  const promoted = await (await send(org, one + '/promote', {method: 'POST', headers: owner, json: {}})).json();
  const after = (await (await send(org, one, {headers: owner})).json()).application;
  assert.equal(after.candidateId, promoted.candidateId); assert.equal(after.history.at(-1).actor, 'owner@example.invalid');
  // A client-supplied reviewer name is ignored.
  await send(org, one + '/note', {method: 'POST', headers: owner, json: {note: 'second note', actor: 'forged@example.invalid'}});
  assert.equal((await (await send(org, one, {headers: owner})).json()).application.history.at(-1).actor, 'owner@example.invalid');

  const csv = await send(org, '/api/reviewer/export.csv', {headers: owner});
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(await csv.text(), /"Reference","Received","Status"[^\n]*\r\n"QOQ-[A-F0-9]{16}","[^"]+","approved","Juana Dela Cruz","Reyna Juana"/);

  // The candidate is not public until numbered, cleared and published; the screening photos never are.
  assert.deepEqual((await act(main, 'public.catalog')).body.candidates, []);
  const upload = new FormData(); upload.set('photo', new Blob([jpeg(9)], {type: 'image/jpeg'}), 'official.jpg');
  const photoKey = (await (await send(org, '/api/competition/candidate-photo', {method: 'POST', headers: owner, body: upload})).json()).photoKey;
  assert.equal((await send(main, '/api/competition/photo/' + photoKey)).status, 403);
  assert.equal((await act(org, 'organizer.candidate', owner, {id: promoted.candidateId, name: 'Reyna Juana', number: 3, photoKey, published: true, consentRef: 'Signed release'})).status, 200);
  const shown = (await act(vote, 'public.catalog')).body;
  assert.deepEqual(shown.candidates.map(c => [c.number, c.name, c.photoKey]), [[3, 'Reyna Juana', photoKey]]);
  assert.equal((await send(vote, '/api/competition/photo/' + photoKey)).status, 200);
  assert.ok(!JSON.stringify(shown).includes('juana@') && !JSON.stringify(shown).includes(receipt.reference));
});

test('a full judging night over HTTP: assignment, drafts, locks, tabulation, certification and publication', {skip}, async t => {
  const {act} = platform(t);
  const judges = [1, 2, 3].map(i => ({'oai-authenticated-user-id': 'judge-' + i, 'oai-authenticated-user-email': 'judge' + i + '@example.invalid'}));
  const ids = {};
  for (const [i, name] of ['Alma', 'Bituin', 'Carmela'].entries()) ids[name] = (await act(org, 'organizer.candidate', owner, {name, number: i + 1})).body.id;
  const criteria = {};
  for (const [name, weight] of [['Beauty of Face', 40], ['Evening Gown', 35], ['Question and Answer', 25]]) criteria[name] = (await act(org, 'organizer.criterion', owner, {name, weight})).body.id;
  for (const [i, j] of judges.entries()) await act(org, 'organizer.judge', owner, {name: 'Judge ' + (i + 1), email: j['oai-authenticated-user-email'].toUpperCase()});
  assert.equal((await act(judgeHost, 'judge.ballot', stranger)).status, 403);
  assert.equal((await act(judgeHost, 'judge.ballot', {})).status, 401);
  assert.equal((await act(main, 'judge.ballot', judges[0])).status, 404);                    // judging exists only on its own host
  assert.equal((await act(judgeHost, 'organizer.dashboard', owner)).status, 404);
  assert.equal((await act(judgeHost, 'judge.ballot', judges[0])).body.phase, 'setup');
  assert.equal((await act(org, 'organizer.openScoring', owner)).status, 200);

  // Scores per judge: [face, gown, q&a] for Alma, Bituin, Carmela.
  const sheet = [[[92, 88, 90], [85, 95, 80], [90, 90, 90]], [[90, 91, 89], [88, 92, 84], [91, 89, 90.5]], [[94, 87, 92], [86, 94, 82], [89, 91, 89.5]]];
  const cells = j => Object.keys(ids).flatMap((name, c) => Object.keys(criteria).map((k, x) => ({candidateId: ids[name], criterionId: criteria[k], score: sheet[j][c][x]})));
  assert.equal((await act(judgeHost, 'judge.save', judges[0], {scores: cells(0).slice(0, 4)})).status, 200);    // partial draft
  assert.equal((await act(judgeHost, 'judge.ballot', judges[0])).body.scores.length, 4);                        // persists
  assert.equal((await act(judgeHost, 'judge.lock', judges[0])).status, 409);                                    // incomplete
  assert.equal((await act(judgeHost, 'judge.ballot', judges[1])).body.scores.length, 0);                        // isolated from other judges
  for (const [j, headers] of judges.entries()) { await act(judgeHost, 'judge.save', headers, {scores: cells(j)}); assert.equal((await act(judgeHost, 'judge.lock', headers)).status, 200); }
  assert.equal((await act(judgeHost, 'judge.save', judges[0], {scores: cells(0)})).status, 409);                // locked
  assert.equal((await act(judgeHost, 'judge.ballot', judges[0])).body.locked, true);

  assert.equal((await act(org, 'organizer.lockTabulation', owner)).status, 200);
  const tab = (await act(org, 'organizer.dashboard', owner)).body.tabulation;
  // Independent arithmetic: average of each judge's weighted total.
  const weights = [0.40, 0.35, 0.25];
  const expected = Object.keys(ids).map((name, c) => [name, Math.round(sheet.reduce((sum, judge) => sum + judge[c].reduce((s, v, k) => s + v * weights[k], 0), 0) / 3 * 100) / 100]).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(tab.results.map(r => [r.name, r.score]), expected);
  assert.deepEqual(expected, [['Alma', 90.42], ['Carmela', 90], ['Bituin', 87.82]]);   // worked by hand: (90.1+90.1+91.05)/3, (90+90.175+89.825)/3, (87.25+88.4+87.8)/3
  assert.equal(tab.final, true); assert.equal(tab.verified, true);

  assert.deepEqual((await act(main, 'public.results')).body, {published: false});
  assert.equal((await act(org, 'organizer.certifyResults', owner)).status, 200);
  assert.equal((await act(org, 'organizer.publishResults', owner, {top: 3})).status, 200);
  const shown = (await act(main, 'public.results')).body;
  assert.deepEqual(shown.placements.map(p => [p.rank, p.name]), [[1, 'Alma'], [2, 'Carmela'], [3, 'Bituin']]);
  const audit = (await act(org, 'organizer.audit', owner)).body.entries.map(e => e.action);
  for (const action of ['organizer.openScoring', 'judge.lock', 'organizer.lockTabulation', 'organizer.certifyResults', 'organizer.publishResults']) assert.ok(audit.includes(action), action);
});

test('paid voting stays closed in production; in a rehearsal only a correctly signed webhook credits points', {skip}, async t => {
  const hook = 'w'.repeat(48);
  const rehearsal = {QOQ_PAYMENTS_ENABLED: 'yes', QOQ_PAYMENT_PROVIDER: 'sandbox', QOQ_PAYMENT_WEBHOOK_SECRET: hook, QOQ_ALLOW_SANDBOX_PAYMENTS: 'yes'};
  const {db, act, send} = platform(t, rehearsal);
  const candidate = (await act(org, 'organizer.candidate', owner, {name: 'Alma', number: 1, published: true, consentRef: 'On file'})).body.id;
  let catalog = (await act(vote, 'public.catalog')).body;
  const pack = catalog.packages.find(p => p.name === 'Supporter');
  assert.equal(catalog.paymentsEnabled, false); assert.equal(catalog.packages.length, 6);
  const purchase = () => ({candidateId: candidate, packageId: pack.id, requestId: randomUUID(), email: 'Fan@Example.invalid'});
  assert.equal((await act(preview, 'order.create', {}, purchase())).status, 409);            // database gate still closed

  exec(db, "update qoq_private.settings set payment_provider='sandbox'");
  await act(org, 'organizer.approvePackages', owner); await act(org, 'organizer.setPayments', owner, {enabled: true}); await act(org, 'organizer.openVoting', owner);
  // Even fully configured, the rehearsal provider is refused on every production hostname.
  for (const host of [main, vote]) { assert.equal((await act(host, 'order.create', {}, purchase())).status, 409); assert.equal((await act(host, 'public.catalog')).body.paymentsEnabled, false); }
  assert.equal(exec(db, 'select count(*) from qoq_private.orders'), '0');
  assert.equal((await act(preview, 'public.catalog')).body.paymentsEnabled, true);

  const first = purchase();
  const created = await act(preview, 'order.create', {}, first);
  assert.equal(created.status, 201);
  const order = created.body.order;
  assert.equal(order.status, 'awaiting_payment'); assert.equal(order.points, 5000); assert.equal(order.amountCentavos, 50000); assert.deepEqual(order.candidate, {number: 1, name: 'Alma'});
  assert.equal((await act(preview, 'order.create', {}, first)).body.order.orderRef, order.orderRef);              // refresh or double-click: same order
  // A browser cannot mark an order paid, set a price, or reach the settlement action.
  assert.equal((await act(preview, 'payment.event', owner, {type: 'paid', orderRef: order.orderRef})).status, 404);
  assert.equal((await act(preview, 'order.attach', owner, {orderRef: order.orderRef})).status, 404);
  assert.equal((await act(preview, 'order.create', {}, {...purchase(), amountCentavos: 1, points: 999999, status: 'paid', gate: 'open'})).body.order.amountCentavos, 50000);

  const deliver = (payload, {secretKey = hook, at = Math.floor(Date.now() / 1000), host = preview} = {}) => {
    const raw = JSON.stringify(payload);
    return send(host, '/api/payments/webhook/sandbox', {method: 'POST', body: raw,
      headers: {origin: 'https://provider.invalid', 'content-type': 'application/json', 'x-qoq-signature': 't=' + at + ',v1=' + createHmac('sha256', secretKey).update(at + '.' + raw).digest('hex')}});
  };
  const paid = {id: 'evt_1', type: 'paid', orderRef: order.orderRef, amountCentavos: 50000, currency: 'PHP', providerRef: 'pay_1'};
  const total = () => exec(db, 'select coalesce(sum(points),0) from qoq_private.ledger');
  assert.equal((await deliver(paid, {secretKey: 'x'.repeat(48)})).status, 401);              // forged signature
  assert.equal((await deliver(paid, {at: Math.floor(Date.now() / 1000) - 3600})).status, 401);   // captured and replayed later
  assert.equal((await send(preview, '/api/payments/webhook/sandbox', {method: 'POST', body: JSON.stringify(paid), headers: {'content-type': 'application/json'}})).status, 401);   // unsigned
  assert.equal((await deliver({...paid, type: 'credited'})).status, 401);                   // not a payment event
  assert.equal((await deliver(paid, {host: main})).status, 404);                            // no webhook on production hosts for the rehearsal provider
  assert.equal((await send(preview, '/api/payments/webhook/other', {method: 'POST', body: '{}'})).status, 404);
  assert.equal(total(), '0');
  assert.equal((await act(preview, 'order.status', {}, {orderRef: order.orderRef})).body.creditStatus, 'none');   // a "success" redirect proves nothing

  const answers = await Promise.all(Array.from({length: 8}, () => deliver(paid)));
  assert.ok(answers.every(r => r.status === 200));
  assert.equal(total(), '5000');
  const receipt = (await act(preview, 'order.status', {}, {orderRef: order.orderRef})).body;
  assert.equal(receipt.status, 'paid'); assert.equal(receipt.creditStatus, 'credited'); assert.ok(!('email' in receipt));
  assert.equal((await act(preview, 'order.status', {}, {orderRef: 'QV-' + 'A'.repeat(32)})).status, 422);
  assert.equal((await act(preview, 'order.status', {}, {orderRef: "x' or 1=1--"})).status, 404);

  // Organizer views: totals, transactions and export exist only on the private host.
  assert.equal((await act(main, 'organizer.voting', owner)).status, 404);
  assert.equal((await act(org, 'organizer.voting', stranger)).status, 403);
  const view = (await act(org, 'organizer.voting', owner)).body;
  assert.equal(view.metrics.grossCentavos, 50000); assert.equal(view.candidates[0].points, 5000); assert.deepEqual(view.issues, []);
  const found = (await act(org, 'organizer.orders', owner, {q: 'pay_1'})).body.orders;
  assert.equal(found.length, 1); assert.equal(found[0].email, 'fan@example.invalid');
  assert.equal((await send(main, '/api/competition/export/orders.csv', {headers: owner})).status, 404);
  assert.match(await (await send(org, '/api/competition/export/orders.csv', {headers: owner})).text(), /"QV-[A-F0-9]{32}","[^"]+","paid","credited","1","Alma","Supporter","5000","5000","500.00"/);

  // Switching the deployment flag off closes checkout at once; refunds for past orders still arrive.
  assert.equal((await deliver({id: 'evt_2', type: 'refunded', orderRef: order.orderRef, amountCentavos: 50000, currency: 'PHP'})).status, 200);
  assert.equal(total(), '0');
});

test('public pages carry security headers and never expose private shells', {skip}, async t => {
  const {send} = platform(t);
  for (const path of ['/', '/vote/', '/candidates/', '/voting-rules/', '/privacy/', '/terms/', '/results/', '/apply/', '/schedule/', '/about/']) {
    const r = await send(main, path); assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-security-policy-report-only') || '', /script-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('strict-transport-security'), /max-age/);
    assert.doesNotMatch(await r.text(), /<script>|onclick=|javascript:/i);
  }
  for (const path of ['/organizer/', '/judge/', '/organizer/operations.js', '/organizer/voting.js', '/.env', '/server/api.mjs', '/supabase/migrations/', '/config/edition.json']) assert.equal((await send(main, path)).status, 404, path);
  assert.equal((await send(main, '/vote/', {method: 'POST'})).status, 405);
});
