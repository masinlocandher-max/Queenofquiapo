// The People's Choice Award: decided by voting points, separate from the judges, announced only from the final snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {available, createDb, dropDb, exec, ops, points, rpc, secret, owner, ok} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const award = (db, actor, action, data = {}) => rpc(db, 'qoq_award', {p_secret: secret, p_actor: actor?.id ?? '', p_email: actor?.email ?? '', p_organizer: Boolean(actor?.organizer), p_action: action, p_data: data});

async function election(t, purchases) {
  const db = createDb('award'); t.after(() => dropDb(db));
  const ids = [];
  for (const [i, name] of ['Alma', 'Bituin', 'Carmela'].entries()) ids.push(ok(await ops(db, owner, 'organizer.candidate', {name, number: i + 1, published: true, consentRef: 'On file'})).id);
  const pkg = Object.fromEntries(ok(await points(db, null, 'public.catalog')).packages.map(p => [p.name, p.id]));
  exec(db, "update qoq_private.settings set environment='staging', payment_provider='sandbox'");
  ok(await points(db, owner, 'organizer.approvePackages')); ok(await points(db, owner, 'organizer.setPayments', {enabled: true})); ok(await points(db, owner, 'organizer.openVoting'));
  let n = 0;
  for (const [candidate, name] of purchases) {
    const o = ok(await points(db, null, 'order.create', {candidateId: ids[candidate], packageId: pkg[name], email: 'fan@example.invalid', idempotencyKey: createHash('sha256').update(randomUUID()).digest('hex'), gate: 'open', provider: 'sandbox'}));
    ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'e' + (++n), type: 'paid', orderRef: o.orderRef, amountCentavos: o.amountCentavos, currency: 'PHP'}));
  }
  return {db, ids};
}
const finalize = async db => { ok(await points(db, owner, 'organizer.closeVoting')); ok(await points(db, owner, 'organizer.finalizeVoting')); };

test('the most points in the final snapshot wins; nothing is public until the organizer announces it', {skip}, async t => {
  const {db} = await election(t, [[0, 'Starter'], [0, 'Supporter'], [0, 'Champion'], [1, 'Diamond']]);   // Alma 16,000 · Bituin 25,000
  assert.deepEqual(await award(db, null, 'public.peoplesChoice'), {published: false});
  assert.match((await award(db, owner, 'organizer.publishPeoplesChoice')).error.message, /Finalize/);        // still open: totals can change
  ok(await points(db, owner, 'organizer.closeVoting'));
  assert.match((await award(db, owner, 'organizer.publishPeoplesChoice')).error.message, /Finalize/);        // closed but not reconciled
  ok(await points(db, owner, 'organizer.finalizeVoting'));
  const status = ok(await award(db, owner, 'organizer.awardStatus'));
  assert.equal(status.ready, true); assert.deepEqual(status.winners.map(w => [w.name, w.points]), [['Bituin', 25000]]);
  assert.deepEqual(await award(db, null, 'public.peoplesChoice'), {published: false});
  assert.equal((await award(db, {id: 'x', email: 'x@example.invalid'}, 'organizer.publishPeoplesChoice')).error.code, '42501');
  ok(await award(db, owner, 'organizer.publishPeoplesChoice'));
  const shown = ok(await award(db, null, 'public.peoplesChoice'));
  assert.equal(shown.published, true); assert.equal(shown.tied, false);
  assert.deepEqual(shown.winners, [{number: 2, name: 'Bituin'}]);                                           // points hidden unless chosen
  ok(await award(db, owner, 'organizer.publishPeoplesChoice', {showPoints: true}));
  assert.deepEqual(ok(await award(db, null, 'public.peoplesChoice')).winners, [{number: 2, name: 'Bituin', points: 25000}]);
  ok(await award(db, owner, 'organizer.unpublishPeoplesChoice'));
  assert.deepEqual(await award(db, null, 'public.peoplesChoice'), {published: false});
  assert.equal(exec(db, "select count(*) from qoq_private.audit where action like 'organizer.%PeoplesChoice'"), '3');
});

test('a tie at the top is never broken by the system', {skip}, async t => {
  const {db} = await election(t, [[0, 'Champion'], [1, 'Supporter'], [1, 'Supporter'], [2, 'Starter']]);   // Alma 10,000 = Bituin 10,000
  await finalize(db);
  assert.match((await award(db, owner, 'organizer.publishPeoplesChoice')).error.message, /tied/);
  ok(await award(db, owner, 'organizer.publishPeoplesChoice', {acknowledgeTie: true}));
  const shown = ok(await award(db, null, 'public.peoplesChoice'));
  assert.equal(shown.tied, true); assert.deepEqual(shown.winners.map(w => w.name), ['Alma', 'Bituin']);
});

test('the award does not touch the judges\' result, and a later refund does not rewrite it', {skip}, async t => {
  const {db, ids} = await election(t, [[0, 'Crown']]);
  await finalize(db);
  ok(await award(db, owner, 'organizer.publishPeoplesChoice'));
  ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'refund', type: 'refunded', orderRef: exec(db, 'select public_ref from qoq_private.orders'), amountCentavos: 1000000, currency: 'PHP'}));
  assert.equal(exec(db, 'select coalesce(sum(points),0) from qoq_private.ledger'), '0');                    // the ledger records the refund…
  assert.deepEqual(ok(await award(db, null, 'public.peoplesChoice')).winners.map(w => w.name), ['Alma']);  // …the announced award stands on the certified snapshot
  assert.deepEqual(ok(await ops(db, null, 'public.results')), {published: false});                         // and the judges' result is untouched
  assert.equal(ids.length, 3);
});

test('with no points at all there is no winner to announce', {skip}, async t => {
  const {db} = await election(t, []);
  await finalize(db);
  assert.match((await award(db, owner, 'organizer.publishPeoplesChoice')).error.message, /No candidate/);
});
