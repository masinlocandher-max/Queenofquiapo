// Rehearse the already-applied gemstone migration in a disposable local database.
// Real production records and payment settings are never changed by this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {available, createDb, dropDb, exec, intake, ops, points, owner, ok, migrate, migrationFiles} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const hash = value => createHash('sha256').update(value).digest('hex');
const expected = [
  ['Quartz', 1000, 10000], ['Amethyst', 5000, 50000], ['Sapphire', 10000, 100000],
  ['Emerald', 25000, 250000], ['Ruby', 50000, 500000], ['Diamond', 100000, 1000000]
];

test('gemstone upgrade preserves applications, package IDs, historical purchases and credited points', {skip}, async t => {
  const files = migrationFiles(), stoneIndex = files.findIndex(name => name.endsWith('_qoq_stone_packages.sql'));
  assert.equal(stoneIndex, 6);
  const db = createDb('stones', {count: stoneIndex}); t.after(() => dropDb(db));
  const reference = 'QOQ-0123456789ABCDEF';
  ok(await intake(db, 'create', {
    reference, requestKey: hash('stone-upgrade-request'), fingerprint: hash('stone-upgrade-fingerprint'), storageKey: randomUUID(),
    profile: {legalName: 'Local Test Applicant', femaleName: 'Test Queen', email: 'queen@example.invalid', mobile: '09170000000',
      locality: 'Manila', heightCm: 170, bustIn: 34, waistIn: 26, hipsIn: 35, talent: 'Dance', consentVersion: 'screening-v1'},
    portraitType: 'image/jpeg', swimsuitType: 'image/png'
  }));
  const candidateId = ok(await ops(db, owner, 'organizer.candidate', {name: 'Test Queen', number: 1, published: true, consentRef: 'Local fixture'})).id;
  const beforeCatalog = ok(await points(db, null, 'public.catalog')).packages;
  const oldDiamond = beforeCatalog.find(p => p.name === 'Diamond');
  assert.equal(oldDiamond.points, 25000);
  exec(db, "update qoq_private.settings set payment_provider='sandbox'");
  ok(await points(db, owner, 'organizer.approvePackages'));
  ok(await points(db, owner, 'organizer.setPayments', {enabled: true}));
  ok(await points(db, owner, 'organizer.openVoting'));
  const order = ok(await points(db, null, 'order.create', {candidateId, packageId: oldDiamond.id,
    email: 'supporter@example.invalid', idempotencyKey: hash('stone-upgrade-order'), gate: 'open'}));
  ok(await points(db, null, 'payment.event', {provider: 'sandbox', eventId: 'stone-upgrade-payment', type: 'paid',
    orderRef: order.orderRef, amountCentavos: 250000, currency: 'PHP', providerRef: 'local-stone-payment'}));

  const tables = ['applications', 'application_events', 'candidates', 'orders', 'payment_events', 'ledger'];
  const snapshot = table => exec(db, `select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from qoq_private.${table} r`);
  const before = Object.fromEntries(tables.map(table => [table, snapshot(table)]));
  const packageValues = () => exec(db, "select jsonb_agg(to_jsonb(p)-'name'-'updated_at' order by display_order) from qoq_private.packages p");
  const beforePackages = packageValues();
  const beforeAudit = exec(db, 'select jsonb_agg(to_jsonb(a) order by id) from qoq_private.audit a');

  migrate(db, [files[stoneIndex]]);

  for (const table of tables) assert.equal(snapshot(table), before[table], table + ' changed during rename');
  assert.equal(packageValues(), beforePackages, 'package IDs, price, points and metadata must be preserved');
  assert.equal(exec(db, "select jsonb_agg(to_jsonb(a) order by id) from qoq_private.audit a where action <> 'package.rename'"), beforeAudit);
  assert.equal(exec(db, "select count(*) from qoq_private.audit where action='package.rename'"), '6');
  const afterCatalog = ok(await points(db, null, 'public.catalog'));
  assert.deepEqual(afterCatalog.packages.map(p => [p.name, p.points, p.priceCentavos]), expected);
  assert.deepEqual(afterCatalog.packages.map(p => p.id), beforeCatalog.map(p => p.id));
  assert.equal(afterCatalog.paymentsEnabled, false);
  assert.equal(exec(db, 'select payments_enabled,packages_approved_at is null from qoq_private.settings'), 'f|t');
  assert.equal((await points(db, owner, 'organizer.setPayments', {enabled: true})).error.code, '55000');
  const historicalOrder = ok(await points(db, null, 'order.status', {orderRef: order.orderRef}));
  assert.equal(historicalOrder.package, 'Diamond');
  assert.equal(historicalOrder.points, 25000);
  assert.equal(historicalOrder.creditStatus, 'credited');
  assert.equal(afterCatalog.packages.find(p => p.id === oldDiamond.id).name, 'Emerald');
});
