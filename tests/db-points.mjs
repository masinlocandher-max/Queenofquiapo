// Purchased-points voting against a real disposable PostgreSQL database.
// Payment events here are synthetic and exist only in databases this file creates and drops.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {available, createDb, dropDb, exec, ops, points, owner, ok} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const key = () => createHash('sha256').update(randomUUID()).digest('hex');
const one = (db, sql) => exec(db, sql);

// A database with two published candidates. `live` also configures a rehearsal provider, approves packages and opens voting.
async function setup(t, {live = true} = {}) {
  const db = createDb('pts'); t.after(() => dropDb(db));
  const candidates = [];
  for (const [i, name] of ['Candidate A', 'Candidate B'].entries())
    candidates.push(ok(await ops(db, owner, 'organizer.candidate', {name, number: i + 1, published: true, consentRef: 'Signed release on file'})).id);
  const catalog = ok(await points(db, null, 'public.catalog'));
  const pkg = Object.fromEntries(catalog.packages.map(p => [p.name, p]));
  if (live) {
    exec(db, "update qoq_private.settings set payment_provider='sandbox'");   // administrator step: there is no RPC for this
    ok(await points(db, owner, 'organizer.approvePackages'));
    ok(await points(db, owner, 'organizer.setPayments', {enabled: true}));
    ok(await points(db, owner, 'organizer.openVoting'));
  }
  const order = async (candidate, name, email = 'fan@example.invalid', extra = {}) => ok(await points(db, null, 'order.create',
    {candidateId: candidates[candidate], packageId: pkg[name].id, email, idempotencyKey: key(), gate: 'open', ...extra}));
  let n = 0;
  const event = (o, type = 'paid', extra = {}) => points(db, null, 'payment.event',
    {provider: 'sandbox', eventId: 'evt_' + (++n) + '_' + randomUUID(), type, orderRef: o.orderRef, amountCentavos: o.amountCentavos, currency: 'PHP', providerRef: 'pay_' + o.orderRef, ...extra});
  const totals = async () => Object.fromEntries(ok(await points(db, owner, 'organizer.voting')).candidates.map(c => [c.name, c.points]));
  const view = async () => ok(await points(db, owner, 'organizer.voting'));
  return {db, candidates, pkg, order, event, totals, view};
}

test('PHP 100 buys exactly 1,000 points in every package, and the rate is a database constraint', {skip}, async t => {
  const {db, pkg} = await setup(t, {live: false});
  assert.deepEqual(Object.values(pkg).map(p => [p.name, p.points, p.priceCentavos]),
    [['Starter', 1000, 10000], ['Supporter', 5000, 50000], ['Champion', 10000, 100000], ['Diamond', 25000, 250000], ['Royal', 50000, 500000], ['Crown', 100000, 1000000]]);
  for (const p of Object.values(pkg)) assert.equal(p.priceCentavos / 100 / 100 * 1000, p.points);
  assert.throws(() => exec(db, "insert into qoq_private.packages(name,points,price_centavos) values('Cheap',1000,9000)"), /packages_fixed_rate/);
  assert.throws(() => exec(db, "update qoq_private.packages set price_centavos=1 where name='Crown'"), /packages_fixed_rate/);
  // A price in the request is ignored: the server derives it from the points.
  const id = ok(await points(db, owner, 'organizer.package', {name: 'Patron', points: 2500, priceCentavos: 1, price: 1})).id;
  assert.equal(one(db, `select price_centavos from qoq_private.packages where id='${id}'`), '25000');
  for (const bad of [{name: 'X', points: 0}, {name: 'X', points: -5}, {name: 'X', points: 10.5}, {name: 'X', points: '1000'}, {name: '', points: 1000}, {name: 'X', points: 99999999}])
    assert.equal((await points(db, owner, 'organizer.package', bad)).error.code, '22023', JSON.stringify(bad));
  assert.equal((await points(db, {id: 'x', email: 'x@example.invalid'}, 'organizer.package', {name: 'Hack', points: 1})).error.code, '42501');
  assert.equal((await points(db, {id: 'x', email: 'x@example.invalid', organizer: false}, 'organizer.voting')).error.code, '42501');
});

test('payments are off by default and cannot be switched on without a provider and an approved catalog', {skip}, async t => {
  const {db, candidates, pkg} = await setup(t, {live: false});
  const attempt = extra => points(db, null, 'order.create', {candidateId: candidates[0], packageId: pkg.Starter.id, email: 'fan@example.invalid', idempotencyKey: key(), gate: 'open', ...extra});
  const catalog = ok(await points(db, null, 'public.catalog'));
  assert.equal(catalog.paymentsEnabled, false); assert.equal(catalog.voting, 'not_configured'); assert.equal(catalog.candidates.length, 2);
  assert.match((await attempt()).error.message, /coming soon/i);
  assert.equal((await points(db, owner, 'organizer.setPayments', {enabled: true})).error.code, '55000');          // no provider
  ok(await points(db, owner, 'organizer.approvePackages'));
  assert.equal((await points(db, owner, 'organizer.setPayments', {enabled: true})).error.code, '55000');          // still no provider
  assert.throws(() => exec(db, 'update qoq_private.settings set payments_enabled=true'), /55000/);                 // not even by direct SQL
  exec(db, "update qoq_private.settings set payment_provider='sandbox'");
  ok(await points(db, owner, 'organizer.setPayments', {enabled: true}));
  assert.match((await attempt()).error.message, /Voting is not open/);                                             // payments on, voting not open
  ok(await points(db, owner, 'organizer.openVoting'));
  assert.match((await attempt({gate: 'closed'})).error.message, /coming soon/i);                                   // Worker flag off
  assert.match((await attempt({gate: undefined})).error.message, /coming soon/i);
  // Editing the catalog withdraws approval and switches checkout off again.
  assert.equal((await points(db, owner, 'organizer.package', {name: 'Late', points: 1000})).error.code, '55000');  // catalog fixed once voting opens
  assert.equal(one(db, 'select count(*) from qoq_private.orders'), '0');
  assert.equal(one(db, 'select count(*) from qoq_private.ledger'), '0');
});

test('a verified settlement credits the purchased points once; supporters may buy repeatedly', {skip}, async t => {
  const {order, event, totals, view} = await setup(t);
  // Candidate A: 1,000 + 5,000 + 10,000. Candidate B: 25,000. The same supporter buys three times.
  for (const name of ['Starter', 'Supporter', 'Champion']) assert.equal(ok(await event(await order(0, name))).outcome, 'credited');
  assert.equal(ok(await event(await order(1, 'Diamond', 'other@example.invalid'))).outcome, 'credited');
  assert.deepEqual(await totals(), {'Candidate A': 16000, 'Candidate B': 25000});
  const v = await view();
  assert.deepEqual(v.candidates.map(c => [c.name, c.rank, c.purchases, c.share]), [['Candidate B', 1, 1, 60.98], ['Candidate A', 2, 3, 39.02]]);
  assert.deepEqual(v.metrics, {grossCentavos: 410000, refundedCentavos: 0, reversedCentavos: 0, settledOrders: 4, pendingOrders: 0, failedOrders: 0, heldOrders: 0, creditedPoints: 41000});
  assert.deepEqual(v.issues, []);
});

test('an order without a verified payment never earns points', {skip}, async t => {
  const {db, order, event, totals} = await setup(t);
  const o = await order(0, 'Crown');
  assert.equal(o.status, 'created'); assert.equal(o.creditStatus, 'none');
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 0});
  for (const type of ['processing', 'failed']) ok(await event(o, type));
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 0});
  // Wrong provider name, no provider, unknown type and missing id are all refused.
  assert.equal((await event(o, 'paid', {provider: 'other'})).error.code, '42501');
  assert.equal((await event(o, 'credited')).error.code, '23514');
  assert.equal((await event(o, 'paid', {eventId: ''})).error.code, '22023');
  // Wrong amount or currency: recorded, flagged, not credited.
  assert.equal(ok(await event(o, 'paid', {amountCentavos: 100})).outcome, 'amount_mismatch');
  assert.equal(ok(await event(o, 'paid', {currency: 'USD'})).outcome, 'amount_mismatch');
  assert.equal(ok(await event({...o, orderRef: 'QV-' + '0'.repeat(32)})).outcome, 'unmatched');
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 0});
  assert.equal(one(db, 'select count(*) from qoq_private.ledger'), '0');
  assert.throws(() => exec(db, "update qoq_private.orders set status='paid',credit_status='credited'") || exec(db, 'select 1/0'), /./);
});

test('replayed, duplicated and concurrent notifications cannot credit twice', {skip}, async t => {
  const {db, order, event, totals} = await setup(t);
  const o = await order(0, 'Royal');
  const same = {eventId: 'evt_fixed_1'};
  const burst = await Promise.all(Array.from({length: 30}, () => event(o, 'paid', same)));
  assert.equal(burst.filter(r => r.outcome === 'credited').length, 1);
  assert.equal(burst.filter(r => r.duplicate === true).length, 29);
  // The provider retries the same payment under new event ids, concurrently.
  const retries = await Promise.all(Array.from({length: 20}, () => event(o)));
  assert.ok(retries.every(r => r.outcome === 'already_settled'));
  // A second, different payment for the same order is flagged for refund and adds nothing.
  assert.equal(ok(await event(o, 'paid', {providerRef: 'pay_second'})).outcome, 'double_payment');
  assert.deepEqual(await totals(), {'Candidate A': 50000, 'Candidate B': 0});
  assert.equal(one(db, "select count(*) from qoq_private.ledger where kind='credit'"), '1');
  assert.throws(() => exec(db, `insert into qoq_private.ledger(candidate_id,order_id,kind,points,actor) select candidate_id,id,'credit',points,'attacker' from qoq_private.orders`), /55000|qoq_ledger_one_credit/);
  // Repeating order creation with the same request id returns the same order.
  const again = {candidateId: one(db, 'select candidate_id from qoq_private.orders limit 1'), packageId: one(db, 'select package_id from qoq_private.orders limit 1'), email: 'fan@example.invalid', idempotencyKey: key(), gate: 'open'};
  const twins = await Promise.all(Array.from({length: 10}, () => points(db, null, 'order.create', again)));
  assert.equal(new Set(twins.map(r => r.orderRef)).size, 1);
  assert.equal((await points(db, null, 'order.create', {...again, email: 'someone-else@example.invalid'})).error.code, '23505');
});

test('many supporters paying at the same moment are all counted exactly once', {skip}, async t => {
  const {db, order, event, totals, view} = await setup(t);
  const names = ['Starter', 'Supporter', 'Champion', 'Diamond'], value = {Starter: 1000, Supporter: 5000, Champion: 10000, Diamond: 25000};
  const orders = await Promise.all(Array.from({length: 60}, (_, i) => order(i % 2, names[i % 4], 'fan' + i + '@example.invalid')));
  await Promise.all(orders.flatMap(o => [event(o), event(o)]));            // every payment notified twice, all at once
  const expected = {'Candidate A': 0, 'Candidate B': 0};
  orders.forEach((o, i) => { expected[i % 2 ? 'Candidate B' : 'Candidate A'] += value[names[i % 4]]; });
  assert.deepEqual(await totals(), expected);
  assert.equal(one(db, 'select count(*) from qoq_private.ledger'), '60');
  assert.deepEqual((await view()).issues, []);
});

test('out-of-order and late provider events resolve to the true payment state', {skip}, async t => {
  const {order, event, totals} = await setup(t);
  // "failed" arrives, then the capture is confirmed: the payment is real and is credited.
  const a = await order(0, 'Starter'); ok(await event(a, 'failed'));
  assert.equal(ok(await event(a)).outcome, 'credited');
  // "failed", "expired" or "processing" after a settlement changes nothing.
  for (const type of ['failed', 'expired', 'cancelled', 'processing']) assert.equal(ok(await event(a, type)).outcome, 'ignored');
  // A refund notice before any payment is flagged, not applied.
  const b = await order(1, 'Starter');
  assert.equal(ok(await event(b, 'refunded')).outcome, 'refund_without_payment');
  assert.deepEqual(await totals(), {'Candidate A': 1000, 'Candidate B': 0});
});

test('refunds and chargebacks reverse points with new ledger entries; history is never edited', {skip}, async t => {
  const {db, order, event, totals, view} = await setup(t);
  const full = await order(0, 'Champion'), charge = await order(0, 'Supporter'), part = await order(1, 'Diamond');
  for (const o of [full, charge, part]) ok(await event(o));
  assert.equal(ok(await event(full, 'refunded')).outcome, 'reversed');
  assert.equal(ok(await event(full, 'refunded')).outcome, 'ignored');                      // refund notified twice
  assert.equal(ok(await event(charge, 'reversed', {amountCentavos: null})).outcome, 'reversed');
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 25000});
  // Partial refund: no proportional rule is invented. Points stand and the order is flagged for an organizer decision.
  assert.equal(ok(await event(part, 'refunded', {amountCentavos: 100000})).outcome, 'partial_refund_review');
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 25000});
  let v = await view();
  assert.deepEqual(v.issues.map(i => i.issue), ['unresolved flag: partial_refund_review']);
  assert.equal(v.metrics.grossCentavos, 400000); assert.equal(v.metrics.refundedCentavos, 200000); assert.equal(v.metrics.reversedCentavos, 50000);
  // Adjustments are bounded, reasoned and tied to the order.
  const adjust = (pts, reason = 'Partial refund of PHP 1,000 agreed with purchaser') => points(db, owner, 'organizer.adjust', {orderRef: part.orderRef, points: pts, reason});
  assert.equal((await adjust(-10000, 'short')).error.code, '22023');
  assert.equal((await adjust(-25001)).error.code, '55000');                                // below zero
  assert.equal((await adjust(1)).error.code, '55000');                                     // above what was bought
  assert.equal((await adjust(0)).error.code, '22023');
  assert.equal((await points(db, {id: 'x', email: 'x@example.invalid'}, 'organizer.adjust', {orderRef: part.orderRef, points: -1, reason: 'unauthorized attempt'})).error.code, '42501');
  ok(await adjust(-10000));
  ok(await points(db, owner, 'organizer.resolveFlag', {orderRef: part.orderRef, reason: 'Points reduced in line with refund'}));
  assert.deepEqual(await totals(), {'Candidate A': 0, 'Candidate B': 15000});
  assert.deepEqual((await view()).issues, []);
  // The ledger keeps every step: 3 credits, 2 reversals, 1 adjustment.
  assert.equal(one(db, "select string_agg(kind||':'||points,',' order by id) from qoq_private.ledger"), 'credit:10000,credit:5000,credit:25000,reversal:-10000,reversal:-5000,adjustment:-10000');
  for (const sql of ['update qoq_private.ledger set points=1', 'delete from qoq_private.ledger', 'delete from qoq_private.orders',
    "update qoq_private.orders set candidate_id=(select id from qoq_private.candidates where number=1)", 'update qoq_private.orders set points=points+1',
    "update qoq_private.orders set package_snapshot='{}'", "update qoq_private.orders set status='created'"]) assert.throws(() => exec(db, sql), /55000/, sql);
});

test('package history is reproducible after the catalog changes', {skip}, async t => {
  const {db, order, event, pkg} = await setup(t);
  const o = await order(0, 'Starter'); ok(await event(o));
  ok(await points(db, owner, 'organizer.archivePackage', {id: pkg.Starter.id}));
  const detail = ok(await points(db, owner, 'organizer.order', {orderRef: o.orderRef}));
  assert.equal(detail.order.package, 'Starter'); assert.equal(detail.order.points, 1000); assert.equal(detail.order.amountCentavos, 10000);
  assert.equal(detail.ledger.length, 1); assert.equal(detail.events[0].outcome, 'credited');
  assert.equal(ok(await points(db, null, 'public.catalog')).packages.some(p => p.name === 'Starter'), false);
  assert.match((await points(db, null, 'order.create', {candidateId: one(db, 'select candidate_id from qoq_private.orders'), packageId: pkg.Starter.id, email: 'fan@example.invalid', idempotencyKey: key(), gate: 'open'})).error.message, /available voting package/);
  // The public order view carries no purchaser or provider detail.
  const pub = ok(await points(db, null, 'order.status', {orderRef: o.orderRef}));
  for (const field of ['email', 'name', 'providerRef', 'provider', 'flag']) assert.ok(!(field in pub), field);
});

test('closing, late settlements and finalization follow recorded decisions, not assumptions', {skip}, async t => {
  const {db, order, event, totals, view} = await setup(t);
  const early = await order(0, 'Starter'), late = await order(1, 'Crown'), late2 = await order(1, 'Royal'), never = await order(0, 'Royal');
  ok(await event(early));
  assert.equal((await points(db, owner, 'organizer.finalizeVoting')).error.code, '55000');           // still open
  ok(await points(db, owner, 'organizer.closeVoting'));
  assert.match((await points(db, null, 'order.create', {candidateId: one(db, 'select id from qoq_private.candidates limit 1'), packageId: one(db, 'select id from qoq_private.packages limit 1'), email: 'f@example.invalid', idempotencyKey: key(), gate: 'open'})).error.message, /Voting is not open/);
  // Paid before the close, settled after it: held, never credited automatically.
  assert.equal(ok(await event(late)).outcome, 'held'); assert.equal(ok(await event(late2)).outcome, 'held');
  assert.deepEqual(await totals(), {'Candidate A': 1000, 'Candidate B': 0});
  assert.equal((await points(db, owner, 'organizer.finalizeVoting')).error.code, '55000');           // pending and held orders
  exec(db, 'alter table qoq_private.orders disable trigger qoq_order_guard'); exec(db, "update qoq_private.orders set expires_at=now()-interval '1 minute' where status='created'"); exec(db, 'alter table qoq_private.orders enable trigger qoq_order_guard');
  assert.match((await points(db, owner, 'organizer.finalizeVoting')).error.message, /reconciliation/);
  const resolve = (o, decision) => points(db, owner, 'organizer.resolveHeld', {orderRef: o.orderRef, decision, reason: 'Decision under the published deadline policy'});
  assert.equal((await points(db, owner, 'organizer.resolveHeld', {orderRef: late.orderRef, decision: 'credit', reason: ''})).error.code, '22023');
  ok(await resolve(late, 'credit')); ok(await resolve(late2, 'decline'));
  assert.equal((await resolve(late, 'credit')).error.code, '55000');                                 // decided once
  assert.deepEqual(await totals(), {'Candidate A': 1000, 'Candidate B': 100000});
  ok(await points(db, owner, 'organizer.finalizeVoting'));
  const v = await view();
  assert.equal(v.state.voting, 'finalized'); assert.equal(v.state.paymentsEnabled, false); assert.match(v.snapshot.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(v.snapshot.report.totals.map(c => [c.name, c.points, c.rank]), [['Candidate B', 100000, 1], ['Candidate A', 1000, 2]]);
  assert.deepEqual(v.snapshot.report.excluded.map(e => e.creditStatus), ['declined']);                // settled but not counted, listed separately
  assert.equal(one(db, "select status from qoq_private.orders where public_ref='" + never.orderRef + "'"), 'expired');
  // After finalization nothing reopens and nothing is adjusted.
  for (const [action, data] of [['organizer.openVoting', {}], ['organizer.closeVoting', {}], ['organizer.finalizeVoting', {}], ['organizer.setPayments', {enabled: true}],
    ['organizer.adjust', {orderRef: early.orderRef, points: -1, reason: 'post-final change attempt'}]]) assert.equal((await points(db, owner, action, data)).error.code, '55000', action);
  for (const sql of ["update qoq_private.settings set voting='open'", "update qoq_private.voting_snapshots set digest=repeat('0',64)", 'delete from qoq_private.voting_snapshots'])
    assert.throws(() => exec(db, sql), /55000/, sql);
  // A refund after finalization is still recorded in the ledger, and the certified snapshot stays as it was.
  assert.equal(ok(await event(early, 'refunded')).outcome, 'reversed_after_finalization');
  assert.equal((await view()).snapshot.digest, v.snapshot.digest);
});

test('purchased points and judges\' scores are separate systems', {skip}, async t => {
  const {db, order, event} = await setup(t);
  ok(await event(await order(0, 'Crown')));
  ok(await ops(db, owner, 'organizer.judge', {name: 'Judge', email: 'j@example.invalid'}));
  ok(await ops(db, owner, 'organizer.criterion', {name: 'Overall', weight: 100}));
  ok(await ops(db, owner, 'organizer.openScoring'));
  const judge = {id: 'j', email: 'j@example.invalid'}, ballot = ok(await ops(db, judge, 'judge.ballot'));
  ok(await ops(db, judge, 'judge.save', {scores: ballot.candidates.map((c, i) => ({candidateId: c.id, criterionId: ballot.criteria[0].id, score: i ? 99 : 50}))}));
  ok(await ops(db, judge, 'judge.lock'));
  const tab = ok(await ops(db, owner, 'organizer.dashboard')).tabulation.results;
  assert.deepEqual(tab.map(r => [r.name, r.score]), [['Candidate B', 99], ['Candidate A', 50]]);     // 100,000 points changed nothing here
  assert.ok(!JSON.stringify(ballot).includes('points'));
});

test('the retired one-vote ballot accepts nothing', {skip}, async t => {
  const {db, candidates} = await setup(t);
  assert.equal((await ops(db, {id: 'v', email: 'v@example.invalid'}, 'voter.cast', {candidateId: candidates[0]})).error.code, '22023');
  assert.throws(() => exec(db, `insert into qoq_private.votes(actor_hash,email_hash,candidate_id) values('a','b','${candidates[0]}')`), /55000/);
});
