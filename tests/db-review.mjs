// Regression tests for the issues found in the 20 November design review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {available, createDb, dropDb, exec, ops, points, rpc, secret, owner, ok} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const key = () => createHash('sha256').update(randomUUID()).digest('hex');
const edition = (db, actor, data) => rpc(db, 'qoq_edition', {p_secret: secret, p_actor: actor?.id ?? '', p_email: actor?.email ?? '', p_organizer: Boolean(actor?.organizer), p_action: 'organizer.edition', p_data: data});

async function live(t, environment = 'staging') {
  const db = createDb('review'); t.after(() => dropDb(db));
  const candidate = ok(await ops(db, owner, 'organizer.candidate', {name: 'Alma', number: 1, published: true, consentRef: 'On file'})).id;
  const pkg = ok(await points(db, null, 'public.catalog')).packages[0];
  exec(db, `update qoq_private.settings set environment='${environment}', payment_provider='sandbox'`);
  ok(await points(db, owner, 'organizer.approvePackages')); ok(await points(db, owner, 'organizer.setPayments', {enabled: true})); ok(await points(db, owner, 'organizer.openVoting'));
  const order = extra => points(db, null, 'order.create', {candidateId: candidate, packageId: pkg.id, email: 'fan@example.invalid', idempotencyKey: key(), gate: 'open', provider: 'sandbox', ...extra});
  return {db, candidate, pkg, order};
}

test('a production database refuses the rehearsal payment provider', {skip}, async t => {
  const db = createDb('env'); t.after(() => dropDb(db));
  assert.equal(exec(db, 'select environment from qoq_private.settings'), 'production');
  assert.throws(() => exec(db, "update qoq_private.settings set payment_provider='sandbox'"), /settings_sandbox_staging_only/);
  exec(db, "update qoq_private.settings set payment_provider='paymongo'");      // a real provider name is fine
  assert.equal(ok(await points(db, owner, 'organizer.voting')).state.environment, 'production');
});

test('the environment of a database that holds orders cannot be switched', {skip}, async t => {
  const {db, order} = await live(t);
  ok(await order());
  assert.throws(() => exec(db, "update qoq_private.settings set payment_provider=null, environment='production'"), /55000/);
});

test('the Worker and the database must name the same provider before an order exists', {skip}, async t => {
  const {db, order} = await live(t);
  for (const provider of ['paymongo', undefined, '']) assert.match((await order({provider})).error.message, /temporarily unavailable/);
  assert.equal(exec(db, 'select count(*) from qoq_private.orders'), '0');
  ok(await order());
});

test('an order keeps its checkout address, so a refresh or retry can still pay', {skip}, async t => {
  const {db, order} = await live(t);
  const idempotencyKey = key(), first = ok(await order({idempotencyKey}));
  assert.equal(first.checkoutUrl, null);
  assert.equal((await points(db, null, 'order.attach', {orderRef: first.orderRef, providerRef: 'p1', checkoutUrl: 'javascript:alert(1)'})).error.code, '22023');
  ok(await points(db, null, 'order.attach', {orderRef: first.orderRef, providerRef: 'p1', checkoutUrl: 'https://pay.example.invalid/c/1'}));
  assert.equal(ok(await order({idempotencyKey})).checkoutUrl, 'https://pay.example.invalid/c/1');                       // same request again
  assert.equal(ok(await points(db, null, 'order.status', {orderRef: first.orderRef})).checkoutUrl, 'https://pay.example.invalid/c/1');
  ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'e1', type: 'paid', orderRef: first.orderRef, amountCentavos: first.amountCentavos, currency: 'PHP'}));
  assert.equal(ok(await points(db, null, 'order.status', {orderRef: first.orderRef})).checkoutUrl, null);               // nothing to pay once paid
});

test('the public sees voting as closed once the scheduled closing time passes', {skip}, async t => {
  const {db, order} = await live(t);
  assert.equal(ok(await points(db, null, 'public.catalog')).voting, 'open');
  exec(db, "update qoq_private.settings set voting_closes_at=now()-interval '1 minute'");
  const catalog = ok(await points(db, null, 'public.catalog'));
  assert.equal(catalog.voting, 'closed'); assert.equal(catalog.paymentsEnabled, false);
  assert.match((await order()).error.message, /Voting is not open/);
  const desk = ok(await points(db, owner, 'organizer.voting')).state;
  assert.equal(desk.voting, 'open'); assert.equal(desk.effectiveVoting, 'closed');                                   // the desk is told to record the close
});

test('a payment the provider never resolves can be set aside, carefully, so finalization is possible', {skip}, async t => {
  const {db, order} = await live(t);
  const stuck = ok(await order());
  ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'p', type: 'processing', orderRef: stuck.orderRef}));
  const setAside = reason => points(db, owner, 'organizer.abandonOrder', {orderRef: stuck.orderRef, reason});
  assert.equal((await setAside('Provider never resolved this payment')).error.code, '55000');                      // voting still open
  ok(await points(db, owner, 'organizer.closeVoting'));
  assert.match((await points(db, owner, 'organizer.finalizeVoting')).error.message, /pending/);
  assert.match((await setAside('Provider never resolved this payment')).error.message, /an hour/);
  exec(db, 'alter table qoq_private.orders disable trigger qoq_order_guard');
  exec(db, "update qoq_private.orders set created_at=now()-interval '2 hours'");
  exec(db, 'alter table qoq_private.orders enable trigger qoq_order_guard');
  assert.equal((await setAside('short')).error.code, '22023');
  assert.equal((await points(db, {id: 'x', email: 'x@example.invalid'}, 'organizer.abandonOrder', {orderRef: stuck.orderRef, reason: 'Provider never resolved this'})).error.code, '42501');
  ok(await setAside('Provider support confirmed no capture (ticket 123)'));
  ok(await points(db, owner, 'organizer.finalizeVoting'));
  // If the provider confirms it after all, the money is recorded and held, never silently counted.
  assert.equal(ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'late', type: 'paid', orderRef: stuck.orderRef, amountCentavos: stuck.amountCentavos, currency: 'PHP'})).outcome, 'held');
  assert.match(exec(db, "select string_agg(action,',') from qoq_private.audit where action='organizer.abandonOrder'"), /abandonOrder/);
});

test('one edition per database, and confirmed details can be recorded by the organizer only', {skip}, async t => {
  const db = createDb('edition'); t.after(() => dropDb(db));
  assert.throws(() => exec(db, "insert into qoq_private.editions(id,name) values('qoq-2028','Queen of Quiapo 2028')"), /one edition/);
  assert.throws(() => exec(db, "update qoq_private.editions set is_current=false"), /55000/);
  assert.throws(() => exec(db, "delete from qoq_private.editions"), /55000/);
  assert.equal((await edition(db, {id: 'x', email: 'x@example.invalid'}, {coronationVenue: 'Somewhere'})).error.code, '42501');
  assert.equal((await edition(db, owner, {})).error.code, '22023');
  assert.match((await edition(db, owner, {coronationStartsAt: '2027-01-07T19:00:00+08:00'})).error.message, /coronation date/);
  assert.match((await edition(db, owner, {coronationStartsAt: 'tomorrow-ish'})).error.message, /valid date/);
  assert.match((await edition(db, owner, {applicationsOpenAt: '2026-12-20T00:00:00+08:00', applicationsCloseAt: '2026-12-01T00:00:00+08:00'})).error.message, /close after/);
  ok(await edition(db, owner, {coronationVenue: 'Plaza Miranda', coronationStartsAt: '2027-01-06T19:00:00+08:00', screeningVenue: ''}));
  const event = ok(await ops(db, null, 'public.event'));
  assert.equal(event.coronationVenue, 'Plaza Miranda'); assert.equal(new Date(event.coronationStartsAt).toISOString(), '2027-01-06T11:00:00.000Z'); assert.equal(event.screeningVenue, null);
  assert.equal(event.coronationDate, '2027-01-06'); assert.equal(event.name, 'Queen of Quiapo 2027');                   // the event dates themselves did not move
  ok(await edition(db, owner, {coronationVenue: ''}));
  assert.equal(ok(await ops(db, null, 'public.event')).coronationVenue, null);
  assert.equal(exec(db, "select count(*) from qoq_private.audit where action='organizer.edition'"), '2');
});
