// Organizer desk: judge access codes, the organizer's own password, and the People's Choice Award.
(() => {
  'use strict';
  const {el, make, when, count, announce, api, perform, table, pill, state} = window.QOQ;
  async function post(path, payload = {}) {
    const response = await fetch('/api/access/' + path, {method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(payload)});
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) throw Error(typeof body?.error === 'string' ? body.error : 'This change could not be confirmed. Nothing was changed.');
    return body;
  }
  let me = null, access = null, award = null;
  const host = location.hostname.replace(/^org\./, 'judge.');
  el('judge-signin-address').textContent = host.startsWith('judge.') ? host : location.host + '/judge/';

  function renderAccess() {
    const button = (label, fn, cls = 'text-button') => { const b = make('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const rows = (access?.judges || []).map(j => {
      const actions = make('span');
      actions.append(button(j.hasCode ? 'Reset code' : 'Issue code', () => issue(j)));
      if (j.hasCode) actions.append(' ', button('Revoke', () => revoke(j)));
      return [j.name, j.email, j.hasCode ? (j.locked ? 'Locked for 15 min (too many attempts)' : 'Code issued ' + when(j.issuedAt)) : 'No code yet', j.lastLoginAt ? when(j.lastLoginAt) : '—', actions];
    });
    el('access-table').replaceChildren(rows.length ? table(['Judge', 'Email', 'Access code', 'Last sign-in', ''], rows) : make('p', 'Add judges first, then issue their codes here.', 'empty'));
    const has = Boolean(access?.organizer?.hasPassword);
    pill(el('pw-pill'), has ? 'Password set' : 'No password', has ? 'good' : 'warn');
    el('pw-status').textContent = has ? 'You can sign in with your email and password from any device. Password last changed ' + when(access.organizer.updatedAt) + '.'
      : 'You are signed in with ChatGPT. Set a password so you can sign in from any phone or computer without it.';
    el('pw-summary').textContent = has ? 'Change password' : 'Set a password';
    el('pw-current-label').hidden = !(me?.via === 'session');
    el('pw-form').current.required = me?.via === 'session';
  }
  function issue(judge) {
    if (!window.confirm((judge.hasCode ? 'Reset the access code for ' : 'Issue an access code to ') + judge.name + '?' + (judge.hasCode ? ' The old code stops working and the judge is signed out.' : ''))) return;
    perform(async () => {
      const {code} = await post('judge-code', {judgeId: judge.judgeId});
      el('code-for').textContent = 'Access code for ' + judge.name + ' (' + judge.email + ')';
      el('code-value').textContent = code; el('code-reveal').hidden = false; el('code-done').focus();
      await load(); announce('Access code ready for ' + judge.name + '.');
    });
  }
  function revoke(judge) {
    if (!window.confirm('Revoke the access code of ' + judge.name + '? They are signed out and cannot sign in with a code until you issue a new one.')) return;
    perform(async () => { await api('revokeJudgeCode', {judgeId: judge.judgeId}); await load(); announce('Access code revoked.'); });
  }
  el('code-done').addEventListener('click', () => { el('code-value').textContent = ''; el('code-reveal').hidden = true; });

  const pw = el('pw-form');
  pw.querySelector('[data-cancel]').addEventListener('click', () => { pw.reset(); el('pw-editor').open = false; });
  pw.addEventListener('submit', event => {
    event.preventDefault(); if (!pw.reportValidity()) return;
    if (pw.password.value !== pw.again.value) { announce('The two new passwords are different.', true); return; }
    perform(async () => { await post('password', {current: pw.current.value, password: pw.password.value}); pw.reset(); el('pw-editor').open = false; await load(); announce('Password saved. Other signed-in devices have been signed out.'); });
  });

  function renderAward() {
    const voting = state.voting?.state?.voting;
    const ready = Boolean(award?.ready);
    pill(el('award-pill'), award?.publishedAt ? 'Published ' + when(award.publishedAt) : ready ? 'Ready to announce' : 'Not yet', award?.publishedAt ? 'good' : ready ? 'warn' : '');
    const winners = award?.winners || [];
    el('award-status').textContent = !ready ? 'Available after voting closes and the points are finalized (status now: ' + (voting || '—') + ').'
      : !winners.length ? 'No candidate received points.'
      : (winners.length > 1 ? 'TIE at the top: ' : 'Winner from the final snapshot: ') + winners.map(w => (w.number != null ? 'No. ' + w.number + ' ' : '') + w.name + ' (' + count(w.points) + ' points)').join(' and ') + '.';
    el('award-publish').disabled = !ready || !winners.length;
    el('award-publish').textContent = award?.publishedAt ? 'Update the announcement' : 'Publish on the Results page';
    el('award-unpublish').hidden = !award?.publishedAt;
    el('award-form').showPoints.checked = Boolean(award?.showPoints);
  }
  el('award-form').addEventListener('submit', event => {
    event.preventDefault();
    const tie = (award?.winners || []).length > 1;
    if (!window.confirm(tie ? 'The highest total is TIED. Announce the shared People’s Choice Award? Only do this if the published rules allow it.' : 'Publish the People’s Choice Award on the Results page now?')) return;
    perform(async () => { await api('publishPeoplesChoice', {showPoints: event.target.showPoints.checked, acknowledgeTie: tie}); await load(); announce('The People’s Choice Award is now on the Results page.'); });
  });
  el('award-unpublish').addEventListener('click', () => { if (window.confirm('Remove the People’s Choice Award from the public site?')) perform(async () => { await api('unpublishPeoplesChoice'); await load(); announce('Removed from the public site.'); }); });

  async function load() {
    [me, access, award] = await Promise.all([fetch('/api/access/me', {credentials: 'same-origin', cache: 'no-store'}).then(r => r.json()), api('accessStatus'), api('awardStatus')]);
    state.access = access; renderAccess(); renderAward();
  }
  let loading = false;
  window.QOQ.onChange(() => { if (loading) return; loading = true; load().catch(error => announce(error.message, true)).finally(() => { loading = false; }); });
})();
