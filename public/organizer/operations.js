// Organizer desk: overview, candidates, judges, criteria, tabulation, results, announcements and audit log.
(() => {
  'use strict';
  const {el, make, when, count, announce, api, perform, table, pill, checklist, print, state} = window.QOQ;
  let data;
  const forms = {candidate: el('candidate-form'), judge: el('judge-form'), criterion: el('criterion-form'), announcement: el('announcement-form')};
  const labels = {candidate:'candidate', judge:'judge', criterion:'criterion', announcement:'announcement'};
  const sections = ['overview','applications','roster','judging','voting','results','news','audit'];

  function tab() {
    const current = sections.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    for (const id of sections) el(id).hidden = id !== current;
    for (const link of document.querySelectorAll('.desk-tabs a')) {
      const active = link.hash === '#' + current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    if (current === 'audit' && data) perform(() => audit(true));
  }
  async function dashboard(text) {
    const fresh = await api('dashboard');
    if (!fresh.round || !Array.isArray(fresh.candidates) || !fresh.tabulation || !Array.isArray(fresh.criteria) || !Array.isArray(fresh.judges) || !Array.isArray(fresh.announcements)) {
      throw Error('The event desk could not load the current round. Please try again.');
    }
    data = state.dashboard = fresh; render(); el('dashboard').hidden = false; el('ops-recovery').hidden = true;
    announce(text || 'Private organizer controls.');
    window.QOQ.changed();
  }
  state.reload = dashboard;

  function rowButton(label, action, name) {
    const button = make('button', label, 'text-button'); button.type = 'button';
    button.setAttribute('aria-label', label + ' ' + name); button.addEventListener('click', action);
    return button;
  }
  function clearForm(kind) {
    const form = forms[kind]; form.reset(); delete form.dataset.id; delete form.dataset.photo;
    const editor = el(kind + '-editor'); editor.open = false;
    editor.querySelector('summary').textContent = kind === 'announcement' ? 'Write an announcement' : 'Add a ' + labels[kind];
    const note = form.querySelector('[data-edit-note]'); if (note) note.hidden = true;
  }
  function edit(kind, record) {
    const form = forms[kind]; clearForm(kind); form.dataset.id = record.id;
    if (record.photoKey) form.dataset.photo = record.photoKey;
    for (const name of ['name','email','weight','title','body','published','number','bio','consentRef','status','description','displayOrder']) {
      const control = form.elements.namedItem(name);
      if (control && record[name] !== undefined && record[name] !== null) { if (control.type === 'checkbox') control.checked = record[name]; else control.value = record[name]; }
    }
    const note = form.querySelector('[data-edit-note]');
    if (note && record.photoKey) { note.textContent = 'Leave the photo field empty to keep the current portrait.'; note.hidden = false; }
    const editor = el(kind + '-editor'); editor.querySelector('summary').textContent = 'Edit ' + labels[kind]; editor.open = true; form.querySelector('input, textarea').focus();
  }
  function remove(kind, record) {
    if (!window.confirm('Remove ' + record.name + ' from this round?')) return;
    perform(async () => { await api('remove', {kind, id: record.id}); clearForm(kind); await dashboard('Removed ' + record.name + '.'); });
  }
  function list(kind, target, records, editable, subtitle) {
    const host = el(target); host.replaceChildren();
    if (!records.length) { host.append(make('p', kind === 'announcement' ? 'No announcements yet.' : 'No entries yet.', 'empty')); return; }
    for (const record of records) {
      const row = make('div', undefined, 'list-row');
      if (kind === 'candidate' && record.photoKey) { const img = make('img'); img.alt = ''; img.loading = 'lazy'; img.src = '/api/competition/photo/' + encodeURIComponent(record.photoKey); row.append(img); }
      const info = make('div', undefined, 'row-info');
      info.append(make('strong', (kind === 'candidate' && record.number ? 'No. ' + record.number + ' · ' : '') + (record.name || record.title)), make('small', subtitle(record)));
      row.append(info);
      if (editable) {
        const actions = make('div', undefined, 'row-buttons');
        actions.append(rowButton('Edit', () => edit(kind, record), record.name || record.title));
        if (kind !== 'announcement') actions.append(rowButton('Remove', () => remove(kind, record), record.name));
        row.append(actions);
      }
      host.append(row);
    }
  }
  const dateOnly = value => value ? new Intl.DateTimeFormat('en-PH', {dateStyle:'long', timeZone:'UTC'}).format(new Date(value + 'T00:00:00Z')) : 'To be announced';

  function render() {
    const {round, candidates, judges, criteria, announcements, tabulation, edition, applications} = data;
    const isSetup = round.phase === 'setup', rosterLocked = Boolean(round.rosterLockedAt), rosterEditable = isSetup && !rosterLocked;
    const active = candidates.filter(c => c.status === 'active'), published = active.filter(c => c.published);
    const weight = criteria.reduce((sum, c) => sum + Number(c.weight), 0), weightsOk = Math.abs(weight - 100) < .00001;
    const total = Number(tabulation.total), pending = Number(tabulation.pending), locked = total - pending;
    const results = Array.isArray(tabulation.results) ? tabulation.results : [];
    const ties = results.filter(r => r.tied);

    // Overview
    el('edition-line').textContent = (edition?.name || 'Queen of Quiapo') + (edition?.theme ? ' · ' + edition.theme : '');
    el('m-pending').textContent = count(applications?.pending);
    el('candidate-count').textContent = active.length + (published.length !== active.length ? ' (' + published.length + ' public)' : '');
    el('phase').textContent = ({setup:'Set-up', scoring:'In progress', locked:'Final'})[round.phase] || 'Unavailable';
    el('locked-count').textContent = locked + ' / ' + total;
    const facts = el('edition-facts'); facts.replaceChildren();
    for (const [label, value] of [['Screening Day', edition?.screeningStartsAt ? when(edition.screeningStartsAt) + ' – ' + new Intl.DateTimeFormat('en-PH', {timeStyle:'short', timeZone:'Asia/Manila'}).format(new Date(edition.screeningEndsAt)) : 'To be announced'],
      ['Screening venue', edition?.screeningVenue || 'To be announced'], ['Coronation Night', dateOnly(edition?.coronationDate)],
      ['Coronation time', edition?.coronationStartsAt ? when(edition.coronationStartsAt) : 'To be announced'], ['Coronation venue', edition?.coronationVenue || 'To be announced'],
      ['Applications', edition?.applicationsCloseAt ? 'Close ' + when(edition.applicationsCloseAt) : 'No closing time set'], ['Time zone', edition?.timezone || 'Asia/Manila']]) {
      const row = make('div'); row.append(make('dt', label), make('dd', value)); facts.append(row);
    }

    // Candidates
    el('roster-state').textContent = rosterLocked ? 'The roster was locked on ' + when(round.rosterLockedAt) + '. Names, numbers and portraits are fixed.' : 'The roster is open for changes.';
    el('candidate-editor').hidden = !rosterEditable; el('judge-editor').hidden = el('criterion-editor').hidden = !isSetup;
    el('lock-roster').hidden = !rosterEditable || !active.length;
    el('unlock-roster').hidden = !(rosterLocked && isSetup && ['not_configured','scheduled'].includes(round.voting));
    list('candidate', 'candidates-list', candidates, rosterEditable, r => [r.status === 'withdrawn' ? 'Withdrawn' : r.published ? 'Published' : 'Not published',
      r.photoKey ? 'portrait attached' : 'no portrait', r.consentRef ? 'clearance: ' + r.consentRef : 'no publicity clearance recorded', r.fromApplication ? 'from an approved application' : ''].filter(Boolean).join(' · '));
    list('judge', 'judges-list', judges, isSetup, r => r.email + ' · ' + (r.locked ? 'Ballot locked' : r.linked ? 'Signed in' : 'Not yet signed in'));
    list('criterion', 'criteria-list', criteria, isSetup, r => r.weight + '%' + (r.description ? ' · ' + r.description : ''));
    list('announcement', 'announcements-list', announcements, true, r => (r.published ? 'Published' : 'Draft') + ' · updated ' + when(r.updatedAt));
    el('weight-total').textContent = 'Total weight: ' + Number(weight.toFixed(2)) + '%. Weights must add up to exactly 100% to open judging.';

    // Judging progress
    const cells = Number(tabulation.cells);
    el('judge-progress').replaceChildren(judges.length ? table(['Judge', 'Status', {text:'Scores entered'}, 'Last active', 'Locked at'], judges.map(j => [j.name,
      j.locked ? 'Ballot locked' : j.linked ? 'Scoring' : 'Not yet signed in', {text: isSetup ? '—' : j.scored + ' / ' + cells, num:true}, when(j.lastSeenAt), when(j.lockedAt)])) : make('p', 'No judges assigned yet.', 'empty'));
    const ready = active.length > 0 && judges.length > 0 && criteria.length > 0 && weightsOk;
    el('open-scoring').hidden = !isSetup; el('open-scoring').disabled = !ready;
    el('scoring-hint').textContent = isSetup ? (ready ? 'Opening judging freezes the roster, judges and criteria for this edition.' : 'Add the roster, at least one judge, and criteria totaling 100% before opening.')
      : round.phase === 'scoring' ? 'Judging opened ' + when(round.scoringOpenedAt) + '. Draft scores are not shown or counted until a judge locks the ballot.' : 'Judging is complete.';

    // Tabulation and results
    pill(el('tab-state'), tabulation.final ? (tabulation.certifiedAt ? 'Certified' : 'Final · not certified') : locked ? 'Provisional' : 'No results yet', tabulation.final ? (tabulation.certifiedAt ? 'good' : 'warn') : '');
    el('tabulation-summary').textContent = tabulation.final ? 'Final tabulation locked ' + when(tabulation.finalizedAt) + '.' + (tabulation.verified === false ? ' WARNING: the stored result no longer matches the locked ballots. Do not announce; contact technical support.' : ' Re-verified against the locked ballots just now.')
      : locked > 0 ? 'PROVISIONAL: ' + locked + ' of ' + total + ' ballots locked. ' + pending + ' still outstanding. These figures will change.' : 'Combined scores appear here after judges lock their ballots.';
    const host = el('tally-results'); host.replaceChildren();
    if (results.length && locked > 0) {
      host.append(table([{text:'Rank'}, {text:'No.'}, 'Candidate', {text:'Score'}, {text:'Exact'}, 'Note'], results.map(r => [{text:r.rank, num:true}, {text:r.number ?? '—', num:true}, r.name,
        {text:Number(r.score).toFixed(2), num:true}, {text:Number(r.exact).toFixed(6), num:true}, r.tied ? {text:'TIE at rank ' + r.rank, className:'rank-tie'} : ''])));
      const breakdown = make('details', undefined, 'ballot-audit'); breakdown.append(make('summary', 'Criteria breakdown'));
      const names = (results[0].criteria || []).map(k => k.name + ' (' + k.weight + '%)');
      breakdown.append(table(['Candidate', ...names.map(text => ({text}))], results.map(r => [r.name, ...(r.criteria || []).map(k => ({text: Number(k.average).toFixed(2) + ' → ' + Number(k.weighted).toFixed(2), num:true}))]), 'Average score → weighted contribution'));
      host.append(breakdown);
    }
    if (ties.length) host.append(make('p', 'A tie exists. The system does not break ties: apply the official tie rule, or certify the shared placement.', 'status error'));
    const audit = el('ballot-details'); audit.replaceChildren();
    const cMap = new Map(candidates.map(c => [c.id, c.name])), kMap = new Map(criteria.map(c => [c.id, c.name]));
    for (const ballot of (tabulation.ballots || [])) {
      const d = make('details', undefined, 'ballot-audit');
      d.append(make('summary', ballot.judgeName + ' · locked ' + when(ballot.lockedAt)), table(['Candidate', 'Criterion', {text:'Score'}], (ballot.scores || []).map(s => [cMap.get(s.candidateId) || 'Candidate', kMap.get(s.criterionId) || 'Criterion', {text:s.score, num:true}])));
      audit.append(d);
    }
    el('lock-tally').hidden = round.phase !== 'scoring'; el('lock-tally').disabled = pending !== 0 || total < 1;
    el('certify').hidden = !tabulation.final || Boolean(tabulation.certifiedAt); el('certify').disabled = tabulation.verified === false;
    el('print-results').disabled = el('print-audit').disabled = !(results.length && locked > 0);
    el('tab-identity').textContent = tabulation.digest ? 'Report ID ' + tabulation.digest.slice(0, 16) + ' · locked by ' + (tabulation.finalizedBy || '—') + (tabulation.certifiedAt ? ' · certified by ' + tabulation.certifiedBy + ' on ' + when(tabulation.certifiedAt) : '') : '';
    pill(el('publish-state'), tabulation.publishedAt ? 'Published ' + when(tabulation.publishedAt) : 'Not published', tabulation.publishedAt ? 'good' : '');
    el('publish').disabled = !tabulation.certifiedAt; el('unpublish').hidden = !tabulation.publishedAt;
    el('publish').textContent = tabulation.publishedAt ? 'Update published results' : 'Publish results';
  }

  function sheetStatus() {
    const t = data.tabulation, locked = Number(t.total) - Number(t.pending);
    return t.certifiedAt ? 'CERTIFIED ' + when(t.certifiedAt) + ' BY ' + t.certifiedBy : t.final ? 'FINAL · NOT YET CERTIFIED' : 'PROVISIONAL · ' + locked + ' OF ' + t.total + ' BALLOTS · NOT OFFICIAL';
  }
  const reportId = () => data.tabulation.digest ? data.tabulation.digest.slice(0, 16) : 'DRAFT-' + Date.now().toString(36).toUpperCase();
  el('print-results').addEventListener('click', () => {
    const t = data.tabulation;
    print({title:'Official judging results', subtitle:'Judges’ scores', status:sheetStatus(), reportId:reportId(), signatures:['Tabulation officer', 'Chair of the board of judges', 'Pageant organizer'], tables:[
      table([{text:'Rank'}, {text:'No.'}, 'Candidate', {text:'Weighted score'}, 'Note'], t.results.map(r => [{text:r.rank, num:true}, {text:r.number ?? '—', num:true}, r.name, {text:Number(r.exact).toFixed(4), num:true}, r.tied ? 'TIE' : ''])),
      table(['Candidate', ...(t.results[0]?.criteria || []).map(k => ({text:k.name + ' ' + k.weight + '%'}))], t.results.map(r => [r.name, ...(r.criteria || []).map(k => ({text:Number(k.weighted).toFixed(4), num:true}))]), 'Weighted contribution by criterion'),
      table(['Judge', 'Ballot'], data.judges.map(j => [j.name, j.locked ? 'Locked ' + when(j.lockedAt) : 'NOT SUBMITTED']), 'Ballot completion')]});
  });
  el('print-audit').addEventListener('click', () => {
    const cMap = new Map(data.candidates.map(c => [c.id, (c.number ? c.number + ' · ' : '') + c.name])), kMap = new Map(data.criteria.map(c => [c.id, c.name]));
    print({title:'Judge-by-judge scoring audit', subtitle:'Confidential', status:sheetStatus(), reportId:reportId(), tables:(data.tabulation.ballots || []).map(b =>
      table(['Candidate', 'Criterion', {text:'Score'}], b.scores.map(s => [cMap.get(s.candidateId), kMap.get(s.criterionId), {text:s.score, num:true}]), b.judgeName + ' · locked ' + when(b.lockedAt)))});
  });

  async function upload(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw Error('Choose a JPG, PNG or WebP portrait up to 5 MB.');
    const body = new FormData(); body.set('photo', file);
    const response = await fetch('/api/competition/candidate-photo', {method:'POST', credentials:'same-origin', headers:{Accept:'application/json'}, body});
    const res = await response.json().catch(() => null);
    if (!response.ok || !res?.photoKey) throw Error(typeof res?.error === 'string' ? res.error : 'The portrait upload was not confirmed.');
    return res.photoKey;
  }
  for (const [kind, form] of Object.entries(forms)) {
    form.querySelector('[data-cancel]').addEventListener('click', () => clearForm(kind));
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const btn = form.querySelector('button[type=submit]');
      perform(async () => {
        btn.disabled = true; const previous = btn.textContent; btn.textContent = 'Saving…';
        try {
          const values = new FormData(form), payload = {};
          if (form.dataset.id) payload.id = form.dataset.id;
          if (kind === 'announcement') {
            payload.title = values.get('title').trim(); payload.body = values.get('body').trim(); payload.published = values.has('published');
            if (payload.published && !window.confirm('Publish this announcement on the event website?')) return;
          } else {
            payload.name = values.get('name').trim();
            if (kind === 'judge') payload.email = values.get('email').trim();
            if (kind === 'criterion') { payload.weight = Number(values.get('weight')); payload.description = values.get('description').trim(); payload.displayOrder = Number(values.get('displayOrder') || 0); }
            if (kind === 'candidate') {
              payload.number = values.get('number') || null; payload.bio = values.get('bio').trim(); payload.consentRef = values.get('consentRef').trim();
              payload.status = values.get('status'); payload.published = values.has('published');
              if (payload.published && !window.confirm('Show ' + payload.name + ' on the public website? Confirm that her publicity clearance is on file.')) return;
              const file = values.get('photo');
              if (file?.size) payload.photoKey = await upload(file);
              else if (form.dataset.photo) payload.photoKey = form.dataset.photo;
            }
          }
          await api(kind, payload); clearForm(kind); await dashboard('Saved ' + labels[kind] + '.');
        } finally { btn.disabled = false; btn.textContent = previous; }
      });
    });
  }
  for (const [id, action, prompt, done] of [
    ['open-scoring','openScoring','Open judging now? The roster, judges and criteria will be locked for this edition.','Judging is open.'],
    ['lock-tally','lockTabulation','Permanently lock the final tabulation using the submitted judge ballots? This cannot be undone.','Final tabulation is locked.'],
    ['lock-roster','lockRoster','Lock the official roster? Names, numbers and portraits can no longer be changed.','The roster is locked.'],
    ['unlock-roster','unlockRoster','Unlock the roster for corrections?','The roster is open for changes.'],
    ['unpublish','unpublishResults','Remove the results from the public website?','Results are no longer public.']
  ]) el(id).addEventListener('click', () => { if (window.confirm(prompt)) perform(async () => { await api(action); await dashboard(done); }); });
  el('certify').addEventListener('click', () => {
    const ties = data.tabulation.results.some(r => r.tied);
    if (!window.confirm(ties ? 'There is a TIE in these results. Certify the shared placement as it stands? Only do this if the official rules allow it.' : 'Certify these results as official? Certification is recorded with your account and cannot be changed.')) return;
    perform(async () => { await api('certifyResults', {acknowledgeTies: ties}); await dashboard('Results certified.'); });
  });
  el('publish-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.target);
    if (!window.confirm('Publish these results on the public website now?')) return;
    perform(async () => { await api('publishResults', {top: values.get('top') || null, showScores: values.has('showScores')}); await dashboard('Results are now public.'); });
  });

  let auditCursor = null;
  async function audit(reset) {
    if (reset) { auditCursor = null; el('audit-table').replaceChildren(); }
    const {entries} = await api('audit', auditCursor ? {before: auditCursor} : {});
    const describe = e => e.details ? Object.entries(e.details).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · ') : '';
    const rows = entries.map(e => [when(e.at), e.actor, e.action, describe(e)]);
    if (reset || !el('audit-table').firstChild) el('audit-table').replaceChildren(rows.length ? table(['When', 'Who', 'Action', 'Details'], rows) : make('p', 'No actions recorded yet.', 'empty'));
    else for (const columns of rows) { const row = el('audit-table').querySelector('tbody').insertRow(); for (const value of columns) row.insertCell().textContent = value; }
    auditCursor = entries.length ? entries.at(-1).id : auditCursor; el('audit-more').hidden = entries.length < 100;
  }
  el('audit-more').addEventListener('click', () => perform(() => audit(false)));

  el('refresh').addEventListener('click', () => perform(() => dashboard('Refreshed.')));
  el('ops-retry').addEventListener('click', () => perform(() => dashboard()));
  window.addEventListener('hashchange', tab); tab(); perform(() => dashboard());
})();
