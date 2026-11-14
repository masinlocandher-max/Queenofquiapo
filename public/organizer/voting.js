// Organizer desk: voting lifecycle, packages, payment gate, candidate points, reconciliation and transactions.
(() => {
  'use strict';
  const {el, make, when, peso, count, announce, api, perform, table, pill, checklist, print, state} = window.QOQ;
  let view;
  const manila = value => { if (!value) return ''; const d = new Date(new Date(value).getTime() + 8 * 3600000); return d.toISOString().slice(0, 16); };
  const fromManila = text => text ? text + ':00+08:00' : null;
  const votingLabel = {not_configured:'Not configured', scheduled:'Scheduled', open:'Open', closed:'Closed', finalized:'Finalized'};

  async function load(text) {
    view = state.voting = await api('voting');
    render(); if (text) announce(text);
  }
  const reload = text => state.reload(text);

  function render() {
    const {state: s, metrics: m, candidates, packages, issues, snapshot} = view;
    const dash = state.dashboard, net = Number(m.grossCentavos) - Number(m.refundedCentavos) - Number(m.reversedCentavos);
    el('v-gross').textContent = peso(m.grossCentavos); el('v-refunds').textContent = peso(m.refundedCentavos); el('v-reversals').textContent = peso(m.reversedCentavos); el('v-net').textContent = peso(net);
    el('v-points').textContent = count(m.creditedPoints); el('v-settled').textContent = count(m.settledOrders); el('v-pending').textContent = count(m.pendingOrders); el('v-failed').textContent = count(m.failedOrders);
    el('m-voting').textContent = votingLabel[s.voting]; el('m-points').textContent = count(m.creditedPoints);
    el('m-payments').textContent = s.paymentsEnabled ? 'Enabled' : 'Coming soon (off)';
    el('m-recon').textContent = issues.length ? issues.length + ' to resolve' : 'Clear';

    pill(el('voting-pill'), votingLabel[s.voting], s.voting === 'open' ? 'good' : s.voting === 'finalized' ? '' : 'warn');
    el('voting-status').textContent = ({not_configured:'Voting has not been scheduled. The public page shows the official candidates and packages with “Payment coming soon”.',
      scheduled:'Voting is scheduled' + (s.opensAt ? ' to open ' + when(s.opensAt) : '') + (s.closesAt ? ' and close ' + when(s.closesAt) : '') + '. It still needs to be opened here.',
      open:'Voting opened ' + when(s.openedAt) + (s.closesAt ? '. Purchases stop at ' + when(s.closesAt) + '.' : '.'),
      closed:'Voting closed ' + when(s.closedAt) + '. Review held or pending payments, then finalize the points.', finalized:'Points were finalized ' + when(s.finalizedAt) + '. The record is closed.'})[s.voting];
    const editable = ['not_configured','scheduled'].includes(s.voting);
    el('schedule-form').hidden = !editable; el('schedule-form').opensAt.value = manila(s.opensAt); el('schedule-form').closesAt.value = manila(s.closesAt);
    el('open-voting').hidden = !editable; el('close-voting').hidden = s.voting !== 'open'; el('finalize-voting').hidden = s.voting !== 'closed';
    el('finalize-voting').disabled = issues.length > 0 || Number(m.pendingOrders) > 0;
    el('points-public').checked = s.pointsPublic;
    el('voting-hint').textContent = s.voting === 'closed' && (issues.length || Number(m.pendingOrders)) ? 'Finalizing needs zero pending payments and a clear reconciliation list.'
      : editable ? 'Opening voting needs at least one published, numbered candidate and locks the roster. The policy for payments that settle after the deadline must be published before opening.' : '';

    pill(el('pay-pill'), s.paymentsEnabled ? 'Enabled' : 'Coming soon', s.paymentsEnabled ? 'good' : 'warn');
    el('pay-status').textContent = s.paymentsEnabled ? 'Checkout is switched on in the database. It is live only if the website deployment is also authorized.' : 'Online payment is off. Visitors see “Payment coming soon” and no order can be created.';
    checklist(el('pay-gates'), [
      [s.providerConfigured, 'Payment provider configured', s.providerConfigured ? 'A provider is registered for this edition.' : 'No provider is registered. This is set by the technical administrator once a merchant account is approved.'],
      [Boolean(s.packagesApprovedAt), 'Package catalog approved', s.packagesApprovedAt ? 'Approved ' + when(s.packagesApprovedAt) : 'Review the packages below and approve them.'],
      [s.voting === 'open', 'Voting open', votingLabel[s.voting]],
      [s.paymentsEnabled, 'Checkout switched on here', 'The website deployment has its own separate switch (QOQ_PAYMENTS_ENABLED), off by default.'],
      [false, 'Refund policy, voting rules and legal review approved', 'Tracked outside this system. Do not switch checkout on until they are signed off.']]);
    el('pay-toggle').hidden = !(s.providerConfigured && s.packagesApprovedAt) && !s.paymentsEnabled;
    el('pay-toggle').textContent = s.paymentsEnabled ? 'Switch checkout off' : 'Switch checkout on';

    pill(el('pkg-pill'), s.packagesApprovedAt ? 'Approved' : 'Proposed · awaiting approval', s.packagesApprovedAt ? 'good' : 'warn');
    const action = (label, fn) => { const b = make('button', label, 'text-button'); b.type = 'button'; b.addEventListener('click', fn); return b; };
    el('packages-list').replaceChildren(table(['Package', {text:'Points'}, {text:'Price'}, 'Shown', {text:'Settled purchases'}, ''], packages.map(p => [p.name + (p.archived ? ' (archived)' : ''),
      {text:count(p.points), num:true}, {text:peso(p.priceCentavos), num:true}, p.archived ? '—' : p.active ? 'Yes' : 'Hidden', {text:count(p.settledOrders), num:true},
      p.archived ? '' : (() => { const box = make('span'); if (editable) box.append(action('Edit', () => editPackage(p)), ' '); box.append(action('Archive', () => archive(p))); return box; })()])));
    el('package-editor').hidden = !editable; el('approve-packages').hidden = Boolean(s.packagesApprovedAt);

    el('points-table').replaceChildren(candidates.length ? table([{text:'Rank'}, {text:'No.'}, 'Candidate', {text:'Points'}, {text:'Share'}, {text:'Purchases'}, 'Packages'], candidates.map(c => [
      {text:c.points > 0 ? c.rank : '—', num:true}, {text:c.number ?? '—', num:true}, c.name + (c.tied ? ' (tied)' : ''), {text:count(c.points), num:true}, {text:c.share + '%', num:true}, {text:count(c.purchases), num:true},
      c.packages.map(p => p.count + ' × ' + p.name).join(', ')])) : make('p', 'No official candidates yet.', 'empty'));

    pill(el('recon-pill'), issues.length ? issues.length + ' open' : 'Reconciled', issues.length ? 'bad' : 'good');
    const recon = el('recon-list'); recon.replaceChildren();
    if (!issues.length) recon.append(make('p', 'Every settled payment maps to exactly one credit, and candidate totals equal the ledger.', 'empty'));
    for (const issue of issues) {
      const row = make('div', undefined, 'list-row'), info = make('div', undefined, 'row-info');
      info.append(make('strong', issue.issue), make('small', issue.orderRef)); row.append(info);
      if (/^QV-/.test(issue.orderRef)) { const box = make('div', undefined, 'row-buttons'); box.append(action('Open order', () => perform(() => openOrder(issue.orderRef)))); row.append(box); }
      recon.append(row);
    }
    if (snapshot) recon.append(make('p', 'Final snapshot ' + snapshot.digest.slice(0, 16) + ' recorded ' + when(snapshot.finalizedAt) + ' by ' + snapshot.finalizedBy + '.', 'small'));

    if (dash) checklist(el('readiness'), readiness(dash, view));
  }

  function readiness(d, v) {
    const active = d.candidates.filter(c => c.status === 'active'), weight = d.criteria.reduce((sum, c) => sum + Number(c.weight), 0);
    const t = d.tabulation, s = v.state;
    return [
      [Number(d.applications.pending) === 0, 'Applications reviewed', d.applications.total + ' received · ' + d.applications.pending + ' awaiting a decision · ' + d.applications.approved + ' approved'],
      [active.length > 0 && active.every(c => c.number), 'Official roster numbered', active.length + ' active candidate' + (active.length === 1 ? '' : 's') + (active.some(c => !c.number) ? ' · some have no number' : '')],
      [active.length > 0 && active.every(c => c.published), 'Roster published with clearance', active.filter(c => c.published).length + ' of ' + active.length + ' on the public site'],
      [Boolean(d.round.rosterLockedAt), 'Roster locked', d.round.rosterLockedAt ? when(d.round.rosterLockedAt) : 'Lock once names, numbers and portraits are final'],
      [d.judges.length > 0, 'Judges assigned', d.judges.length + ' assigned · ' + d.judges.filter(j => j.linked).length + ' have signed in'],
      [Math.abs(weight - 100) < .00001, 'Criteria total 100%', d.criteria.length + ' criteria · ' + Number(weight.toFixed(2)) + '%'],
      [d.round.phase !== 'setup', 'Judging opened', d.round.phase === 'setup' ? 'Not opened' : when(d.round.scoringOpenedAt)],
      [Number(t.total) > 0 && Number(t.pending) === 0, 'All ballots locked', (Number(t.total) - Number(t.pending)) + ' of ' + t.total],
      [t.final ? (t.verified === false ? 'blocked' : true) : false, 'Tabulation locked and verified', t.final ? (t.verified === false ? 'MISMATCH — do not announce' : 'Report ' + t.digest.slice(0, 16)) : 'Pending'],
      [Boolean(t.certifiedAt), 'Results certified', t.certifiedAt ? when(t.certifiedAt) + ' by ' + t.certifiedBy : 'Pending'],
      [Boolean(t.publishedAt), 'Results published', t.publishedAt ? when(t.publishedAt) : 'Not published'],
      [Boolean(s.packagesApprovedAt), 'Voting packages approved', s.packagesApprovedAt ? when(s.packagesApprovedAt) : 'Six proposed packages await approval'],
      [s.paymentsEnabled ? true : false, 'Online payment', s.paymentsEnabled ? 'Switched on' : 'Coming soon — no provider is live and no payment can be taken'],
      [v.issues.length ? 'blocked' : true, 'Points reconciliation', v.issues.length ? v.issues.length + ' issue(s) open' : 'Clear'],
      [Boolean(d.edition.coronationStartsAt && d.edition.coronationVenue), 'Coronation time and venue confirmed', (d.edition.coronationStartsAt && d.edition.coronationVenue) ? 'Recorded' : 'To be announced — update the edition record when confirmed']
    ];
  }

  const form = el('package-form');
  function clearPackage() { form.reset(); delete form.dataset.id; el('package-editor').open = false; el('package-editor').querySelector('summary').textContent = 'Add a package'; price(); }
  function editPackage(p) { clearPackage(); form.dataset.id = p.id; form.name.value = p.name; form.points.value = p.points; form.displayOrder.value = p.displayOrder; form.active.checked = p.active;
    el('package-editor').querySelector('summary').textContent = 'Edit package'; el('package-editor').open = true; price(); form.name.focus(); }
  function price() { const pts = Number(form.points.value); el('package-price').textContent = Number.isInteger(pts) && pts > 0 ? 'Price: ' + peso(pts * 10) + ' for ' + count(pts) + ' points (₱100 = 1,000 points).' : 'The price is calculated from the points.'; }
  form.points.addEventListener('input', price);
  form.querySelector('[data-cancel]').addEventListener('click', clearPackage);
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    perform(async () => { await api('package', {id: form.dataset.id || null, name: form.name.value.trim(), points: Number(form.points.value), displayOrder: Number(form.displayOrder.value || 0), active: form.active.checked}); clearPackage(); await reload('Package saved. The catalog needs approval again.'); });
  });
  const archive = p => { if (window.confirm('Archive “' + p.name + '”? It will no longer be offered. Past purchases keep their record.')) perform(async () => { await api('archivePackage', {id: p.id}); await reload('Package archived.'); }); };
  el('approve-packages').addEventListener('click', () => {
    const shown = view.packages.filter(p => p.active && !p.archived).map(p => p.name + ': ' + count(p.points) + ' points for ' + peso(p.priceCentavos)).join('\n');
    if (window.confirm('Approve this catalog for sale?\n\n' + shown)) perform(async () => { await api('approvePackages'); await reload('Package catalog approved.'); });
  });

  el('schedule-form').addEventListener('submit', event => { event.preventDefault(); const f = event.target;
    perform(async () => { await api('scheduleVoting', {opensAt: fromManila(f.opensAt.value), closesAt: fromManila(f.closesAt.value)}); await reload('Voting schedule saved.'); }); });
  for (const [id, action, prompt, done] of [
    ['open-voting','openVoting','Open voting now? This locks the official roster for the rest of the edition.','Voting is open.'],
    ['close-voting','closeVoting','Close voting now? No new purchases will be accepted. Payments that settle after this moment are held for your decision.','Voting is closed.'],
    ['finalize-voting','finalizeVoting','Finalize the points? This records the final totals permanently and cannot be reopened.','Points are final.']
  ]) el(id).addEventListener('click', () => { if (window.confirm(prompt)) perform(async () => { await api(action); await reload(done); }); });
  el('points-public').addEventListener('change', event => { const enabled = event.target.checked;
    if (!window.confirm(enabled ? 'Show candidate point totals on the public website?' : 'Hide candidate point totals from the public website?')) { event.target.checked = !enabled; return; }
    perform(async () => { await api('setPointsPublic', {enabled}); await reload(enabled ? 'Point totals are public.' : 'Point totals are hidden.'); }); });
  el('pay-toggle').addEventListener('click', () => { const enabled = !view.state.paymentsEnabled;
    if (!window.confirm(enabled ? 'Switch checkout on? Confirm that the refund policy, voting rules and legal review are signed off.' : 'Switch checkout off? No new purchases can start.')) return;
    perform(async () => { await api('setPayments', {enabled}); await reload(enabled ? 'Checkout switched on in the database.' : 'Checkout switched off.'); }); });
  el('print-points').addEventListener('click', () => {
    const s = view.state, snap = view.snapshot, rows = snap ? snap.report.totals : view.candidates;
    print({title:'Purchased-points voting report', subtitle:'Separate from the judges’ result', reportId: snap ? snap.digest.slice(0, 16) : 'DRAFT-' + Date.now().toString(36).toUpperCase(),
      status: snap ? 'FINAL POINTS · FINALIZED ' + when(snap.finalizedAt) : 'PROVISIONAL · VOTING ' + votingLabel[s.voting].toUpperCase() + ' · NOT OFFICIAL', signatures:['Voting and finance officer', 'Pageant organizer'], tables:[
      table([{text:'Rank'}, {text:'No.'}, 'Candidate', {text:'Valid points'}, {text:'Share'}, {text:'Settled purchases'}], rows.map(c => [{text:c.points > 0 ? c.rank : '—', num:true}, {text:c.number ?? '—', num:true}, c.name + (c.tied ? ' (tied)' : ''), {text:count(c.points), num:true}, {text:c.share + '%', num:true}, {text:count(c.purchases), num:true}])),
      table(['Reconciliation', {text:'Value'}], [['Settled payments (gross)', {text:peso(view.metrics.grossCentavos), num:true}], ['Refunds', {text:peso(view.metrics.refundedCentavos), num:true}], ['Reversals', {text:peso(view.metrics.reversedCentavos), num:true}],
        ['Points credited (ledger)', {text:count(view.metrics.creditedPoints), num:true}], ['Open reconciliation issues', {text:view.issues.length, num:true}], ['Conversion rate', {text:'₱100 = 1,000 points', num:true}]])]});
  });

  // Transactions
  const search = el('order-search');
  async function orders() {
    const {orders: rows} = await api('orders', {q: search.q.value.trim(), status: search.status.value, limit: 50});
    el('order-detail').hidden = true;
    const open = ref => { const b = make('button', ref.slice(0, 11) + '…', 'text-button'); b.type = 'button'; b.setAttribute('aria-label', 'Open order ' + ref); b.addEventListener('click', () => perform(() => openOrder(ref))); return b; };
    el('orders-table').replaceChildren(rows.length ? table(['Order', 'Created', 'Status', 'Points', 'Candidate', 'Package', {text:'Amount'}, 'Flag'], rows.map(o => [open(o.orderRef), when(o.createdAt), o.status.replaceAll('_', ' '),
      o.creditStatus + ' · ' + count(o.netPoints), (o.candidate?.number ? o.candidate.number + ' · ' : '') + (o.candidate?.name || ''), o.package, {text:peso(o.amountCentavos), num:true}, o.flag ? o.flag.replaceAll('_', ' ') : ''])) : make('p', 'No transactions match. No payment has been taken while checkout is off.', 'empty'));
  }
  async function openOrder(ref) {
    const {order: o, events, ledger} = await api('order', {orderRef: ref});
    const box = el('order-detail'); box.replaceChildren(make('h4', 'Order ' + o.orderRef));
    box.append(table(['Field', 'Value'], [['Status', o.status.replaceAll('_', ' ')], ['Points', o.creditStatus + ' · holds ' + count(o.netPoints) + ' of ' + count(o.points)], ['Candidate', (o.candidate?.number ?? '—') + ' · ' + (o.candidate?.name || '')],
      ['Package', o.package + ' · ' + peso(o.amountCentavos)], ['Refunded', peso(o.refundedCentavos)], ['Purchaser', o.email + (o.name ? ' · ' + o.name : '')], ['Provider reference', o.providerRef || '—'],
      ['Created', when(o.createdAt)], ['Paid', when(o.paidAt)], ['Flag', o.flag ? o.flag.replaceAll('_', ' ') + ' — ' + (o.flagNote || '') : (o.flagNote || '—')]]),
      table(['Provider event', 'Type', {text:'Amount'}, 'Received', 'Outcome'], events.map(e => [e.eventId, e.type, {text:e.amountCentavos == null ? '—' : peso(e.amountCentavos), num:true}, when(e.receivedAt), e.outcome.replaceAll('_', ' ')]), 'Verified provider events'),
      table(['Entry', {text:'Points'}, 'By', 'Reason', 'When'], ledger.map(l => [l.kind, {text:(l.points > 0 ? '+' : '') + count(l.points), num:true}, l.actor, l.reason || '', when(l.at)]), 'Ledger entries'));
    const reasoned = (label, run) => { const b = make('button', label, 'btn quiet'); b.type = 'button'; b.addEventListener('click', () => {
      const reason = window.prompt(label + '\n\nRecord the reason (at least 10 characters). It is stored permanently in the audit log.'); if (reason === null) return;
      perform(async () => { await run(reason.trim()); await reload('Recorded.'); await orders(); await openOrder(ref); }); }); return b; };
    const actions = make('div', undefined, 'action-row');
    if (o.creditStatus === 'held') actions.append(reasoned('Credit these points', reason => api('resolveHeld', {orderRef: ref, decision:'credit', reason})), reasoned('Decline (refund at provider)', reason => api('resolveHeld', {orderRef: ref, decision:'decline', reason})));
    if (o.creditStatus === 'credited' && view.state.voting !== 'finalized') { const b = make('button', 'Adjust points', 'btn quiet'); b.type = 'button'; b.addEventListener('click', () => {
      const pts = Number(window.prompt('Adjustment in points (negative to remove). The order can never hold less than 0 or more than ' + count(o.points) + '.')); if (!Number.isInteger(pts) || pts === 0) return;
      const reason = window.prompt('Reason for adjusting by ' + pts + ' points (at least 10 characters):'); if (reason === null) return;
      perform(async () => { await api('adjust', {orderRef: ref, points: pts, reason: reason.trim()}); await reload('Adjustment recorded.'); await orders(); await openOrder(ref); }); }); actions.append(b); }
    if (o.flag) actions.append(reasoned('Mark flag resolved', reason => api('resolveFlag', {orderRef: ref, reason})));
    box.append(actions); box.hidden = false; box.scrollIntoView({block:'nearest'});
  }
  search.addEventListener('submit', event => { event.preventDefault(); perform(orders); });

  let first = true;
  // The voting view reloads with every dashboard refresh so revenue, points and reconciliation are never stale.
  let loading = false;
  window.QOQ.onChange(() => { if (loading) return; loading = true; (async () => { try { await load(); if (first || (!el('voting').hidden && el('order-detail').hidden)) { first = false; await orders(); } } catch (error) { announce(error.message, true); } finally { loading = false; } })(); });
})();
