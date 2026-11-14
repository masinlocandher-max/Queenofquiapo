// Application lifecycle and the upgrade path, against real disposable PostgreSQL databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {available, createDb, dropDb, exec, intake, ops, points, owner, ok, migrate, migrationFiles, secret} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const hex = text => createHash('sha256').update(text).digest('hex');
let serial = 0;
async function apply(db, overrides = {}) {
  const n = ++serial, reference = 'QOQ-' + hex('ref' + n + db).slice(0, 16).toUpperCase();
  const profile = {legalName: 'Legal Name ' + n, femaleName: 'Stage Name ' + n, email: 'applicant' + n + '@example.invalid', mobile: '0917000' + String(n).padStart(4, '0'),
    locality: 'Manila', heightCm: 170, bustIn: 34, waistIn: 26, hipsIn: 35, talent: 'Dance', consentVersion: 'screening-v1', ...overrides};
  ok(await intake(db, 'create', {reference, requestKey: hex('key' + n + db), fingerprint: hex('fp' + n), storageKey: randomUUID(), profile, portraitType: 'image/jpeg', swimsuitType: 'image/png'}));
  return reference;
}
const reviewer = 'owner@example.invalid';
const set = (db, reference, status, note) => intake(db, 'setStatus', {reference, status, note, actor: reviewer});

test('application status moves only along the approved lifecycle, with a recorded actor and time', {skip}, async t => {
  const db = createDb('intake'); t.after(() => dropDb(db));
  const ref = await apply(db);
  assert.equal(ok(await intake(db, 'details', {reference: ref})).status, 'submitted');
  for (const illegal of ['approved', 'qualified', 'screened', 'submitted', 'nonsense']) assert.equal((await set(db, ref, illegal)).error.code, '55000', illegal);
  assert.equal((await intake(db, 'setStatus', {reference: ref, status: 'under_review'})).error.code, '42501');   // no reviewer identity
  for (const next of ['under_review', 'correction_requested', 'under_review', 'qualified', 'screened', 'approved']) ok(await set(db, ref, next, 'Step to ' + next));
  assert.equal((await set(db, ref, 'not_selected')).error.code, '55000');                                       // approved cannot be quietly rejected
  ok(await intake(db, 'note', {reference: ref, note: 'Bring original ID to screening', actor: reviewer}));
  const detail = ok(await intake(db, 'details', {reference: ref}));
  assert.equal(detail.status, 'approved');
  assert.deepEqual(detail.history.filter(h => h.kind === 'status').map(h => [h.from, h.to, h.actor]),
    [['submitted', 'under_review'], ['under_review', 'correction_requested'], ['correction_requested', 'under_review'], ['under_review', 'qualified'], ['qualified', 'screened'], ['screened', 'approved']].map(p => [...p, reviewer]));
  assert.equal(detail.history.at(-1).note, 'Bring original ID to screening');
  ok(await set(db, ref, 'withdrawn'));
  assert.equal((await set(db, ref, 'under_review')).error.code, '55000');                                       // withdrawn is final
});

test('the inbox supports counts, status filters, search, ordering, paging and duplicate indicators', {skip}, async t => {
  const db = createDb('inbox'); t.after(() => dropDb(db));
  const refs = [];
  for (let i = 0; i < 7; i++) refs.push(await apply(db, i === 3 ? {femaleName: 'Maria Clara', locality: 'Quiapo'} : {}));
  const dup = await apply(db, {email: 'APPLICANT' + (serial - 6) + '@example.invalid'});                        // same email as the first, different case
  ok(await set(db, refs[0], 'under_review')); ok(await set(db, refs[1], 'under_review')); ok(await set(db, refs[1], 'qualified'));
  let page = ok(await intake(db, 'list', {limit: 3}));
  assert.equal(page.applications.length, 3); assert.equal(page.total, 8); assert.deepEqual(page.counts, {submitted: 6, under_review: 1, qualified: 1});
  assert.equal(page.applications[0].reference, dup); assert.equal(page.applications[0].duplicate, true);
  const seen = [...page.applications];
  while (page.nextCursor) { page = ok(await intake(db, 'list', {limit: 3, cursor: page.nextCursor})); seen.push(...page.applications); }
  assert.deepEqual(seen.map(a => a.reference), [dup, ...refs.slice().reverse()]);
  assert.deepEqual(ok(await intake(db, 'list', {sort: 'oldest', limit: 2})).applications.map(a => a.reference), refs.slice(0, 2));
  assert.deepEqual(ok(await intake(db, 'list', {status: 'qualified'})).applications.map(a => a.reference), [refs[1]]);
  assert.deepEqual(ok(await intake(db, 'list', {q: 'maria cl'})).applications.map(a => a.reference), [refs[3]]);
  assert.deepEqual(ok(await intake(db, 'list', {q: refs[5].slice(0, 12).toLowerCase()})).applications.map(a => a.reference), [refs[5]]);
  assert.equal(ok(await intake(db, 'list', {q: '%'})).applications.length, 0);                                  // wildcards are literal
  for (const entry of seen) for (const field of ['email', 'legalName', 'mobile', 'heightCm']) assert.ok(!(field in entry));   // the list carries no contact detail
  assert.deepEqual(ok(await intake(db, 'details', {reference: refs[0]})).duplicates, [dup]);
  assert.equal(ok(await intake(db, 'export', {actor: reviewer})).rows.length, 8);
  assert.equal((await intake(db, 'export', {})).error.code, '42501');
  assert.match(exec(db, "select action from qoq_private.audit where action='application.export'"), /export/);
});

test('promotion to the official roster copies the pageant name only and starts unpublished', {skip}, async t => {
  const db = createDb('promote'); t.after(() => dropDb(db));
  const ref = await apply(db, {femaleName: 'Reyna Elena'});
  assert.equal((await intake(db, 'promote', {reference: ref, actor: reviewer})).error.code, '55000');           // not approved yet
  for (const next of ['under_review', 'qualified', 'screened', 'approved']) ok(await set(db, ref, next));
  const {candidateId} = ok(await intake(db, 'promote', {reference: ref, actor: reviewer}));
  assert.equal((await intake(db, 'promote', {reference: ref, actor: reviewer})).error.code, '23505');           // once only
  const row = JSON.parse(exec(db, `select to_jsonb(c) from qoq_private.candidates c where id='${candidateId}'`));
  assert.equal(row.name, 'Reyna Elena'); assert.equal(row.published, false); assert.equal(row.photo_key, null); assert.equal(row.number, null);
  // Nothing private reaches any public or judge view.
  const publicViews = JSON.stringify([await points(db, null, 'public.catalog'), await ops(db, null, 'public.announcements'), await ops(db, null, 'public.event')]);
  for (const secretText of ['Legal Name', 'applicant', '0917', ref, 'Reyna Elena']) assert.ok(!publicViews.includes(secretText), secretText);
  // Publication needs a number and a recorded clearance.
  assert.equal((await ops(db, owner, 'organizer.candidate', {id: candidateId, name: 'Reyna Elena', published: true})).error.code, '22023');
  assert.equal((await ops(db, owner, 'organizer.candidate', {id: candidateId, name: 'Reyna Elena', number: 1, published: true})).error.code, '22023');
  ok(await ops(db, owner, 'organizer.candidate', {id: candidateId, name: 'Reyna Elena', number: 1, published: true, consentRef: 'Release signed 4 Jan'}));
  const catalog = ok(await points(db, null, 'public.catalog'));
  assert.deepEqual(catalog.candidates.map(c => [c.number, c.name]), [[1, 'Reyna Elena']]);
  assert.ok(!JSON.stringify(catalog).includes(ref) && !JSON.stringify(catalog).includes('Release signed'));
  // Numbers are unique in an edition.
  assert.equal((await ops(db, owner, 'organizer.candidate', {name: 'Second', number: 1})).error.code, '23505');
  // Erasing the applicant removes the screening record and its history, and leaves the public candidate intact.
  const detail = ok(await intake(db, 'details', {reference: ref}));
  ok(await intake(db, 'remove', {reference: ref, storageKey: detail.storageKey, actor: reviewer}));
  assert.equal(exec(db, 'select count(*) from qoq_private.applications')+exec(db, 'select count(*) from qoq_private.application_events'), '00');
  assert.equal(exec(db, 'select count(*) from qoq_private.candidates'), '1');
});

test('roster lock, publication and edition windows', {skip}, async t => {
  const db = createDb('roster'); t.after(() => dropDb(db));
  assert.equal((await ops(db, owner, 'organizer.lockRoster')).error.code, '55000');                             // empty roster
  const a = ok(await ops(db, owner, 'organizer.candidate', {name: 'A', number: 7})).id;
  assert.equal((await points(db, owner, 'organizer.openVoting')).error.code, '55000');                          // nobody published
  ok(await ops(db, owner, 'organizer.lockRoster'));
  for (const [action, data] of [['organizer.candidate', {name: 'B'}], ['organizer.candidate', {id: a, name: 'Renamed', number: 7}], ['organizer.remove', {kind: 'candidate', id: a}]])
    assert.equal((await ops(db, owner, action, data)).error.code, '55000', action);
  ok(await ops(db, owner, 'organizer.unlockRoster'));
  ok(await ops(db, owner, 'organizer.candidate', {id: a, name: 'A', number: 7, published: true, consentRef: 'On file'}));
  ok(await points(db, owner, 'organizer.scheduleVoting', {opensAt: '2027-01-04T21:00:00+08:00', closesAt: '2027-01-06T18:00:00+08:00'}));
  assert.equal(ok(await points(db, null, 'public.catalog')).voting, 'scheduled');
  assert.equal((await points(db, owner, 'organizer.scheduleVoting', {opensAt: '2027-01-06T18:00:00+08:00', closesAt: '2027-01-04T21:00:00+08:00'})).error.code, '22023');
  ok(await points(db, owner, 'organizer.openVoting'));
  assert.equal((await ops(db, owner, 'organizer.unlockRoster')).error.code, '55000');                           // voting froze the roster for good
  assert.equal((await ops(db, owner, 'organizer.candidate', {name: 'Late'})).error.code, '55000');
  // Applications respect the edition window when one is set.
  exec(db, "update qoq_private.editions set applications_close_at=now()-interval '1 hour'");
  await assert.rejects(apply(db), /Applications are not open/);
  assert.equal(ok(await ops(db, null, 'public.event')).applicationsOpen, false);
  const event = ok(await ops(db, null, 'public.event'));
  assert.equal(event.name, 'Queen of Quiapo 2027'); assert.equal(event.coronationDate, '2027-01-06'); assert.equal(event.coronationVenue, null);
  assert.equal(new Date(event.screeningStartsAt).toISOString(), '2027-01-04T07:00:00.000Z');                    // 3:00 PM Philippine time
});

test('upgrading a database that already holds a live edition keeps every record', {skip}, async t => {
  const db = createDb('upgrade', {count: 3, settings: false}); t.after(() => dropDb(db));
  const old = (actor, action, data = {}) => `select public.qoq_operations('${secret}','${actor.id}','${actor.email}',${Boolean(actor.organizer)},'${action}','${JSON.stringify(data)}'::jsonb)`;
  exec(db, `insert into qoq_private.settings(secret_hash) values ('${hex(secret)}')`);
  const id = sql => JSON.parse(exec(db, sql)).id;
  const a = id(old(owner, 'organizer.candidate', {name: 'Candidate A'})), b = id(old(owner, 'organizer.candidate', {name: 'Candidate B'}));
  const k = id(old(owner, 'organizer.criterion', {name: 'Overall', weight: 100}));
  exec(db, old(owner, 'organizer.judge', {name: 'Judge', email: 'j@example.invalid'}));
  exec(db, old(owner, 'organizer.openVoting')); exec(db, old({id: 'v1', email: 'v1@example.invalid'}, 'voter.cast', {candidateId: a})); exec(db, old(owner, 'organizer.closeVoting'));
  exec(db, old(owner, 'organizer.openScoring'));
  const judge = {id: 'j', email: 'j@example.invalid'};
  exec(db, old(judge, 'judge.save', {scores: [{candidateId: a, criterionId: k, score: 91.5}, {candidateId: b, criterionId: k, score: 88}]})); exec(db, old(judge, 'judge.lock'));
  const ref = await (async () => { const r = 'QOQ-0123456789ABCDEF'; exec(db, `select public.qoq_intake('${secret}','create','${JSON.stringify({reference: r, requestKey: hex('k'), fingerprint: hex('f'), storageKey: randomUUID(),
    profile: {legalName: 'L', femaleName: 'F', email: 'e@example.invalid', locality: 'Manila', heightCm: 170, bustIn: 34, waistIn: 26, hipsIn: 35, consentVersion: 'screening-v1'}, portraitType: 'image/jpeg', swimsuitType: 'image/png'})}'::jsonb)`); return r; })();
  const before = exec(db, 'select (select count(*) from qoq_private.candidates),(select count(*) from qoq_private.scores),(select count(*) from qoq_private.votes),(select count(*) from qoq_private.audit),(select count(*) from qoq_private.applications)');

  migrate(db, migrationFiles().slice(3));

  assert.equal(exec(db, 'select (select count(*) from qoq_private.candidates),(select count(*) from qoq_private.scores),(select count(*) from qoq_private.votes),(select count(*) from qoq_private.audit),(select count(*) from qoq_private.applications)'), before);
  assert.equal(exec(db, 'select voting,phase from qoq_private.settings'), 'closed|scoring');                    // 'ended' became 'closed'; scoring continues
  assert.equal(exec(db, "select count(*) from qoq_private.scores where edition_id='qoq-2027'"), '2');
  const dash = ok(await ops(db, owner, 'organizer.dashboard'));
  assert.equal(dash.legacyVotes, 1); assert.equal(dash.edition.name, 'Queen of Quiapo 2027');
  assert.deepEqual(dash.tabulation.results.map(r => [r.name, r.score, r.rank]), [['Candidate A', 91.5, 1], ['Candidate B', 88, 2]]);
  assert.equal(ok(await intake(db, 'details', {reference: ref})).status, 'submitted');
  ok(await ops(db, owner, 'organizer.lockTabulation'));                                                         // the in-flight round can still be finalized
  assert.equal(ok(await ops(db, owner, 'organizer.dashboard')).tabulation.verified, true);
  for (const role of ['anon', 'authenticated']) for (const table of ['orders', 'ledger', 'packages', 'payment_events', 'editions', 'application_events', 'tabulation_snapshots', 'voting_snapshots'])
    assert.equal(exec(db, `select has_table_privilege('${role}','qoq_private.${table}','select')`), 'f', role + ' ' + table);
  assert.equal(exec(db, "select has_function_privilege('authenticated','public.qoq_points(text,text,text,boolean,text,jsonb)','execute')"), 'f');
  assert.equal((await points(db, {...owner}, 'organizer.voting', {})).error, undefined);
  assert.equal((await ops(db, owner, 'organizer.dashboard', {})).error, undefined);
  // The shared secret is still the only way in.
  const bad = await import('./helpers/db.mjs').then(m => m.rpc(db, 'qoq_points', {p_secret: 'x'.repeat(40), p_actor: 'a', p_email: 'a@b.c', p_organizer: true, p_action: 'organizer.voting', p_data: {}}));
  assert.equal(bad.error.code, '42501');
});
