// Judging and tabulation against a real disposable PostgreSQL database.
// Expected values come from an independent integer implementation in this file, never from the database itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {available, createDb, dropDb, exec, ops, owner, ok} from './helpers/db.mjs';

const skip = !available() && 'PostgreSQL test server is not available';
const judgeOf = i => ({id: 'judge-' + i, email: 'j' + i + '@example.invalid'});

// Independent reference: exact integer arithmetic on hundredths. Returns candidates ranked with ties.
function reference(weights, ballots) {
  // weights: [percent], ballots: [judge][candidate][criterion] score
  const candidates = ballots[0].length;
  const sums = Array.from({length: candidates}, (_, c) =>
    ballots.reduce((total, ballot) => total + ballot[c].reduce((t, score, k) => t + BigInt(Math.round(score * 100)) * BigInt(Math.round(weights[k] * 100)), 0n), 0n));
  // weighted score = sum / (100*100 hundredths) / 100 percent / judges
  const exact = sums.map(sum => Number(sum) / 1e6 / ballots.length);
  return sums.map((sum, c) => ({c, sum, exact: exact[c], rank: 1 + sums.filter(other => other > sum).length, tied: sums.filter(other => other === sum).length > 1}));
}

async function round(t, weights, ballots, {lock = ballots.map(() => true)} = {}) {
  const db = createDb('tab'); t.after(() => dropDb(db));
  const candidates = [], criteria = [];
  for (let c = 0; c < ballots[0].length; c++) candidates.push(ok(await ops(db, owner, 'organizer.candidate', {name: 'Candidate ' + (c + 1), number: c + 1})).id);
  for (let k = 0; k < weights.length; k++) criteria.push(ok(await ops(db, owner, 'organizer.criterion', {name: 'Criterion ' + (k + 1), weight: weights[k], displayOrder: k})).id);
  for (let j = 0; j < ballots.length; j++) ok(await ops(db, owner, 'organizer.judge', {name: 'Judge ' + (j + 1), email: judgeOf(j).email}));
  ok(await ops(db, owner, 'organizer.openScoring'));
  for (let j = 0; j < ballots.length; j++) {
    const scores = ballots[j].flatMap((row, c) => row.map((score, k) => score == null ? null : {candidateId: candidates[c], criterionId: criteria[k], score})).filter(Boolean);
    if (scores.length) ok(await ops(db, judgeOf(j), 'judge.save', {scores}));
    if (lock[j]) ok(await ops(db, judgeOf(j), 'judge.lock'));
  }
  return {db, candidates, criteria};
}
const results = async db => ok(await ops(db, owner, 'organizer.dashboard')).tabulation;
function compare(tab, expected, candidates) {
  assert.equal(tab.results.length, expected.length);
  for (const want of expected) {
    const got = tab.results.find(r => r.candidateId === candidates[want.c]);
    assert.ok(Math.abs(got.exact - want.exact) < 6e-7, `candidate ${want.c}: ${got.exact} vs ${want.exact}`);
    assert.equal(got.score, Math.round(want.exact * 100 + 1e-9) / 100);
    assert.equal(got.rank, want.rank); assert.equal(got.tied, want.tied);
  }
}

test('hand-computed example: two judges, 60/40 weights', {skip}, async t => {
  const {db, candidates} = await round(t, [60, 40], [[[90, 60], [80, 80]], [[100, 60], [80, 80]]]);
  const tab = await results(db);
  // A: judge1 90*.6+60*.4=78, judge2 100*.6+60*.4=84 -> 81. B: 80 and 80 -> 80.
  assert.deepEqual(tab.results.map(r => [r.candidateId, r.score, r.rank, r.tied]), [[candidates[0], 81, 1, false], [candidates[1], 80, 2, false]]);
  assert.deepEqual(tab.results[0].criteria.map(k => [k.average, k.weighted]), [[95, 57], [60, 24]]);
});

test('one judge and one candidate; perfect and zero scores', {skip}, async t => {
  let {db, candidates} = await round(t, [100], [[[100]]]);
  compare(await results(db), reference([100], [[[100]]]), candidates);
  ({db, candidates} = await round(t, [50, 50], [[[0, 0], [100, 100], [0, 100]]]));
  const tab = await results(db);
  assert.deepEqual(tab.results.map(r => r.score), [100, 50, 0]);
});

test('decimal weights and decimal scores match the reference exactly', {skip}, async t => {
  const weights = [33.33, 33.33, 33.34], ballots = [
    [[88.25, 91.5, 79.75], [90.01, 85.99, 84.4], [70, 99.99, 65.5]],
    [[92.5, 87.25, 81], [89.9, 86.1, 85.55], [75.25, 95, 70.75]],
    [[85, 90, 80.05], [91, 84.5, 83.95], [72.5, 97.5, 68]]];
  const {db, candidates} = await round(t, weights, ballots);
  compare(await results(db), reference(weights, ballots), candidates);
});

test('exact ties stay ties and are flagged; near ties are separated even when they display the same', {skip}, async t => {
  // Three judges. A and B total exactly the same; C differs by 0.01 on one ballot (0.0033 after averaging).
  const ballots = [[[90], [85], [90]], [[80], [85], [80]], [[85], [85], [85.01]]];
  const {db, candidates} = await round(t, [100], ballots);
  const tab = await results(db), by = id => tab.results.find(r => r.candidateId === id);
  assert.equal(by(candidates[2]).rank, 1); assert.equal(by(candidates[2]).tied, false);
  assert.equal(by(candidates[0]).rank, 2); assert.equal(by(candidates[1]).rank, 2);
  assert.equal(by(candidates[0]).tied, true); assert.equal(by(candidates[1]).tied, true);
  assert.equal(by(candidates[2]).score, 85); assert.equal(by(candidates[0]).score, 85); // same to two decimals
  assert.ok(by(candidates[2]).exact > by(candidates[0]).exact);                           // but not the same result
  compare(tab, reference([100], ballots), candidates);
});

test('drafts and unlocked ballots never reach the ranking; results are provisional until every ballot is locked', {skip}, async t => {
  const ballots = [[[90, 90], [70, 70]], [[10, 10], [100, 100]], [[50, null], [50, 50]]];
  const {db, candidates} = await round(t, [50, 50], ballots, {lock: [true, false, false]});
  let tab = await results(db);
  assert.equal(tab.final, false); assert.equal(tab.pending, 2); assert.equal(tab.ballots.length, 1);
  compare(tab, reference([50, 50], [ballots[0]]), candidates);           // only the locked ballot counts
  assert.equal((await ops(db, judgeOf(2), 'judge.lock')).error.code, '55000');   // incomplete ballot
  assert.equal((await ops(db, owner, 'organizer.lockTabulation')).error.code, '55000');
  const other = await ops(db, judgeOf(1), 'judge.ballot');
  assert.equal(other.scores.length, 4);                                  // a judge sees only their own draft
  assert.ok(!('tabulation' in other) && !('judges' in other));
});

test('score validation is enforced by the database', {skip}, async t => {
  const {db, candidates, criteria} = await round(t, [100], [[[null], [null]]], {lock: [false]});
  const save = scores => ops(db, judgeOf(0), 'judge.save', {scores});
  const cell = (score, c = candidates[0], k = criteria[0]) => ({candidateId: c, criterionId: k, score});
  for (const bad of [[cell(100.01)], [cell(-1)], [cell(50.555)], [cell('90')], [cell(90), cell(91)], [cell(90, '9800a230-90d4-4fb0-82b5-83b855757eae')], [cell(90, candidates[0], candidates[0])], []])
    assert.ok(['22023', '22P02'].includes((await save(bad)).error?.code), JSON.stringify(bad));
  assert.equal((await ops(db, {id: 'stranger', email: 'x@example.invalid'}, 'judge.save', {scores: [cell(90)]})).error.code, '42501');
  ok(await ops(db, judgeOf(0), 'judge.ballot'));                         // first sign-in binds the account
  assert.equal((await ops(db, {id: 'thief', email: judgeOf(0).email}, 'judge.ballot')).error.code, '42501'); // account already bound
  ok(await save([cell(90), cell(80, candidates[1])]));
  ok(await save([cell(95)]));                                            // drafts can be revised
  assert.equal(ok(await ops(db, judgeOf(0), 'judge.ballot')).scores.find(s => s.candidateId === candidates[0]).score, 95);
});

test('locked ballots, frozen configuration and the final snapshot cannot be changed, even with direct SQL', {skip}, async t => {
  const ballots = [[[90, 60], [80, 80]], [[100, 60], [80, 80]]];
  const {db, candidates, criteria} = await round(t, [60, 40], ballots);
  const denied = sql => assert.throws(() => exec(db, sql), /55000/, sql);
  assert.equal((await ops(db, judgeOf(0), 'judge.save', {scores: [{candidateId: candidates[0], criterionId: criteria[0], score: 1}]})).error.code, '55000');
  for (const [action, data] of [['organizer.candidate', {name: 'Late'}], ['organizer.criterion', {name: 'Late', weight: 5}], ['organizer.judge', {name: 'Late', email: 'late@example.invalid'}],
    ['organizer.remove', {kind: 'candidate', id: candidates[0]}], ['organizer.unlockRoster', {}]]) assert.equal((await ops(db, owner, action, data)).error.code, '55000', action);
  denied('update qoq_private.scores set score=0'); denied('delete from qoq_private.scores'); denied('update qoq_private.judges set locked_at=null');
  denied("update qoq_private.criteria set weight=50 where name='Criterion 1'");
  ok(await ops(db, owner, 'organizer.lockTabulation'));
  assert.equal((await ops(db, owner, 'organizer.lockTabulation')).error.code, '55000');   // repeated finalization
  denied("update qoq_private.settings set phase='scoring'"); denied('update qoq_private.tabulation_snapshots set digest=repeat(\'0\',64)');
  denied('delete from qoq_private.tabulation_snapshots'); denied('delete from qoq_private.audit');
  const tab = await results(db);
  assert.equal(tab.final, true); assert.equal(tab.verified, true); assert.match(tab.digest, /^[a-f0-9]{64}$/);
  compare(tab, reference([60, 40], ballots), candidates);
  const stored = JSON.parse(exec(db, 'select report from qoq_private.tabulation_snapshots'));
  assert.equal(stored.ballots.length, 2); assert.equal(stored.ballots[0].scores.length, 4); assert.equal(stored.criteria.length, 2);
});

test('results stay private until certified and published; ties must be acknowledged', {skip}, async t => {
  const {db} = await round(t, [100], [[[90], [90], [70]]]);
  const hidden = async () => assert.deepEqual(await ops(db, null, 'public.results'), {published: false});
  await hidden();
  assert.equal((await ops(db, owner, 'organizer.certifyResults')).error.code, '55000');       // not locked yet
  ok(await ops(db, owner, 'organizer.lockTabulation')); await hidden();
  assert.equal((await ops(db, owner, 'organizer.publishResults')).error.code, '55000');       // not certified
  assert.match((await ops(db, owner, 'organizer.certifyResults')).error.message, /tie/i);
  ok(await ops(db, owner, 'organizer.certifyResults', {acknowledgeTies: true})); await hidden();
  assert.equal((await ops(db, {id: 'x', email: 'x@example.invalid'}, 'organizer.publishResults')).error.code, '42501');
  ok(await ops(db, owner, 'organizer.publishResults', {top: 1}));
  const shown = await ops(db, null, 'public.results');
  assert.equal(shown.published, true);
  assert.deepEqual(shown.placements.map(p => [p.rank, p.tied, p.number]), [[1, true, 1], [1, true, 2]]);   // both tied leaders, no third place
  assert.ok(!('score' in shown.placements[0]));
  ok(await ops(db, owner, 'organizer.publishResults', {showScores: true}));
  assert.deepEqual((await ops(db, null, 'public.results')).placements.map(p => p.score), [90, 90, 70]);
  ok(await ops(db, owner, 'organizer.unpublishResults')); await hidden();
  assert.throws(() => exec(db, 'update qoq_private.settings set results_certified_at=now()'), /55000/);
});

test('concurrent saves and locks from several judges produce the reference result', {skip}, async t => {
  const judges = 8, cands = 6, weights = [40, 35, 25];
  const rand = (() => { let s = 20270106; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  const ballots = Array.from({length: judges}, () => Array.from({length: cands}, () => weights.map(() => Math.round(rand() * 10000) / 100)));
  const {db, candidates, criteria} = await round(t, weights, ballots.map(b => b.map(r => r.map(() => null))), {lock: ballots.map(() => false)});
  await Promise.all(ballots.map(async (ballot, j) => {
    const scores = ballot.flatMap((row, c) => row.map((score, k) => ({candidateId: candidates[c], criterionId: criteria[k], score})));
    // Each judge sends the same full save twice at once, then races two lock requests.
    await Promise.all([ops(db, judgeOf(j), 'judge.save', {scores}), ops(db, judgeOf(j), 'judge.save', {scores})]);
    const locks = await Promise.all([ops(db, judgeOf(j), 'judge.lock'), ops(db, judgeOf(j), 'judge.lock')]);
    assert.equal(locks.filter(r => r.ok).length, 1);
  }));
  assert.equal(exec(db, 'select count(*) from qoq_private.scores'), String(judges * cands * weights.length));
  ok(await ops(db, owner, 'organizer.lockTabulation'));
  compare(await results(db), reference(weights, ballots), candidates);
});
