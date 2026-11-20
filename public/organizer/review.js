// Organizer desk: private application inbox with status, search, notes and promotion to the official roster.
(() => {
  const {el, make, when, pill} = window.QOQ;
  const endpoint = '/api/reviewer/applications';
  const names = {submitted:'Submitted', under_review:'Under review', correction_requested:'Correction requested', qualified:'Qualified for screening', screened:'Screening completed', approved:'Approved', not_selected:'Not selected', withdrawn:'Withdrawn'};
  const tones = {approved:'good', qualified:'good', screened:'good', not_selected:'bad', withdrawn:'bad', correction_requested:'warn', under_review:'warn'};
  const next = {submitted:['under_review','withdrawn'], under_review:['qualified','correction_requested','not_selected','withdrawn'], correction_requested:['under_review','not_selected','withdrawn'],
    qualified:['screened','not_selected','withdrawn'], screened:['approved','not_selected','withdrawn'], approved:['withdrawn'], not_selected:['under_review'], withdrawn:[]};
  let cursor = null, selected = null, filter = '', busy = false, viewRequest = 0;
  const status = (text, error) => { el('status').textContent = text; el('status').classList.toggle('error-text', Boolean(error)); };
  async function request(url, options = {}) {
    if (window.QOQ.state.accessDenied) throw Error('Sign in again to continue.');
    const response = await fetch(url, {cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(25000), ...options, headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})}});
    if (response.status === 401 || response.status === 403) throw window.QOQ.accessDenied(response.status);
    if (window.QOQ.state.accessDenied) throw Error('Sign in again to continue.');
    const body = await response.json().catch(() => null);
    if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : 'The request could not be confirmed. Refresh the application before retrying a change.');
    return body;
  }
  function chips(counts, total) {
    const host = el('status-chips'); host.replaceChildren();
    for (const [key, label] of [['', 'All'], ...Object.entries(names)]) {
      const n = key ? counts[key] || 0 : total; if (key && !n && key !== filter) continue;
      const b = make('button', label + ' ' + n); b.type = 'button'; b.setAttribute('aria-pressed', String(filter === key));
      b.addEventListener('click', () => { filter = key; load(true); }); host.append(b);
    }
  }
  async function load(reset = false) {
    if (busy || window.QOQ.state.accessDenied) return;
    const ticket = ++viewRequest;
    el('rows').setAttribute('aria-busy','true'); el('inbox-retry').hidden = true;
    status('Loading applications…');
    if (reset) { cursor = null; el('rows').replaceChildren(); }
    el('more').disabled = true;
    try {
      const form = el('inbox-search'), params = new URLSearchParams({sort: form.sort.value});
      if (cursor) params.set('cursor', cursor); if (filter) params.set('status', filter); if (form.q.value.trim()) params.set('q', form.q.value.trim());
      const data = await request(endpoint + '?' + params);
      if (ticket !== viewRequest || window.QOQ.state.accessDenied) return;
      el('detail').hidden = true; el('inbox').hidden = false; chips(data.counts || {}, data.total ?? 0);
      for (const entry of data.applications) {
        const button = make('button', undefined, 'entry'); button.type = 'button';
        const name = make('span', entry.femaleName), badge = make('span'); pill(badge, names[entry.status] || entry.status, tones[entry.status]); name.append(badge);
        if (entry.duplicate) { const dup = make('span'); pill(dup, 'Possible duplicate', 'warn'); name.append(dup); }
        button.append(name, make('small', entry.locality + ' · ' + when(entry.submittedAt) + ' · ' + entry.reference));
        button.addEventListener('click', () => show(entry.reference)); el('rows').append(button);
      }
      cursor = data.nextCursor; el('more').hidden = cursor == null;
      const shown = el('rows').childElementCount;
      status(shown ? shown + ' application' + (shown === 1 ? '' : 's') + ' shown' + (filter || form.q.value.trim() ? ' for this filter.' : ' of ' + (data.total ?? shown) + ' received.') + ' Select one to review.' : (filter || form.q.value.trim()) ? 'No applications match. Clear the filters or try a different name or reference.' : 'Your inbox is ready. New applications will appear here after applicants submit the public form.');
    } catch (e) {
      if (ticket === viewRequest && !window.QOQ.state.accessDenied) { status('Applications could not be loaded. Please try again.', true); el('inbox-retry').hidden = false; }
    } finally { if (ticket === viewRequest) { el('more').disabled = false; el('rows').setAttribute('aria-busy','false'); } }
  }
  async function show(reference) {
    const ticket = ++viewRequest;
    status('Opening application…');
    try {
      const {application: entry} = await request(endpoint + '/' + encodeURIComponent(reference));
      if (ticket !== viewRequest || window.QOQ.state.accessDenied) return;
      selected = reference; el('inbox').hidden = true; el('detail').hidden = false; el('candidate').textContent = entry.femaleName;
      el('detail-context').textContent = entry.candidateId ? 'Added to the official roster. Open Candidates to finish the number, portrait and publicity clearance.' : 'Read the details and photographs before recording a screening decision. Decisions remain private.';
      status('Private screening application · ' + reference); el('fields').replaceChildren(); el('app-note').value = '';
      pill(el('app-status'), names[entry.status] || entry.status || 'Submitted', tones[entry.status]);
      el('app-dup').textContent = entry.duplicates?.length ? 'Same email or mobile as ' + entry.duplicates.join(', ') : '';
      const actions = el('app-actions'); actions.replaceChildren();
      for (const target of next[entry.status] || []) {
        const b = make('button', 'Mark ' + names[target].toLowerCase(), ['withdrawn','not_selected'].includes(target) ? 'plain danger' : 'btn quiet'); b.type = 'button';
        b.addEventListener('click', () => decide(target)); actions.append(b);
      }
      if (!actions.childElementCount) actions.append(make('p', 'No further status changes are available.', 'small'));
      el('app-promote').hidden = !(entry.status === 'approved' && !entry.candidateId);
      const data = [['Reference', reference], ['Received (PH time)', when(entry.submittedAt)], ['Legal name', entry.legalName], ['Pageant name', entry.femaleName], ['Email', entry.email], ['Mobile number', entry.mobile], ['City or municipality', entry.locality],
        ['Height (cm)', entry.heightCm], ['Bust (in)', entry.bustIn], ['Waist (in)', entry.waistIn], ['Hips (in)', entry.hipsIn], ['Talent or skill', entry.talent], ['Previous pageants', entry.experience], ['Why they are joining', entry.motivation],
        ['Official roster', entry.candidateId ? 'Added to the official roster' : 'Not on the roster']];
      for (const [label, value] of data) { const row = make('div'); row.append(make('dt', label), make('dd', value || '—')); el('fields').append(row); }
      el('pictures').replaceChildren();
      for (const [kind, label] of [['portrait','Close-up portrait'], ['swimsuit','Full-body swimsuit photo']]) {
        const f = make('figure'), im = make('img'), a = make('a'); const url = endpoint + '/' + encodeURIComponent(reference) + '/' + kind;
        im.alt = label + ' of ' + entry.femaleName; im.src = url; im.addEventListener('error', () => { f.append(make('p', 'Photo could not be loaded. Open it at full size or refresh this application.', 'error-text')); }, {once:true}); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Open ' + label + ' at full size');
        a.append(im); f.append(a, make('figcaption', label)); el('pictures').append(f);
      }
      const history = el('app-history'); history.replaceChildren(make('li', 'Submitted ' + when(entry.submittedAt)));
      for (const h of entry.history || []) { const li = make('li', h.kind === 'status' ? (names[h.from] || h.from) + ' → ' + (names[h.to] || h.to) : 'Note'); if (h.note) li.append(': ' + h.note); li.append(make('small', ' · ' + h.actor + ' · ' + when(h.at))); history.append(li); }
      el('candidate').focus(); return true;
    } catch (e) { if (ticket === viewRequest && !window.QOQ.state.accessDenied) { status('This application could not be opened. Please return to the inbox and try again.', true); el('inbox-retry').hidden = false; } }
  }
  function actionBusy(value) {
    busy = value;
    el('detail').querySelectorAll('button,textarea').forEach(control => { control.disabled = value; });
    el('detail').setAttribute('aria-busy', String(value));
  }
  async function act(path, body, done) {
    if (busy || !selected || window.QOQ.state.accessDenied) return; actionBusy(true);
    status('Saving application review…');
    try { await request(endpoint + '/' + encodeURIComponent(selected) + '/' + path, {method:'POST', body: JSON.stringify(body)}); const ref = selected; const refreshed = await show(ref); if (refreshed) status(done); else if (!window.QOQ.state.accessDenied) status(done + ' Reload the application to view the updated record.'); if (window.QOQ.state.reload) window.QOQ.state.reload().catch(() => {}); }
    catch (e) { status(e.message, true); el('status').scrollIntoView({block:'nearest'}); } finally { actionBusy(false); }
  }
  function decide(target) {
    if (['withdrawn','not_selected','approved'].includes(target) && !window.confirm('Mark this application as ' + names[target].toLowerCase() + '?')) return;
    act('status', {status: target, note: el('app-note').value.trim()}, 'Status updated to ' + names[target].toLowerCase() + '.');
  }
  el('app-add-note').addEventListener('click', () => { if (el('app-note').value.trim()) act('note', {note: el('app-note').value.trim()}, 'Note saved.'); });
  el('app-promote').addEventListener('click', () => { if (window.confirm('Add this applicant to the official roster? Only her pageant name is copied. She stays unpublished until you assign a number, record her publicity clearance and publish.')) act('promote', {}, 'Added to the official roster. Finish her entry under Candidates.'); });
  el('back').addEventListener('click', () => { if (busy || (el('app-note').value.trim() && !window.confirm('Leave without saving this note?'))) return; el('app-note').value = ''; selected = null; el('detail').hidden = true; el('pictures').replaceChildren(); load(true); });
  el('inbox-retry').addEventListener('click', () => { selected = null; load(true); });
  el('inbox-clear').addEventListener('click', () => { el('inbox-search').reset(); filter = ''; load(true); });
  window.addEventListener('beforeunload', event => { if (!window.QOQ.state.accessDenied && el('app-note').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('qoq-access-ended', () => { viewRequest++; selected = null; el('detail').hidden = el('inbox').hidden = true; });
  el('more').addEventListener('click', () => load());
  el('inbox-search').addEventListener('submit', event => { event.preventDefault(); load(true); });
  el('remove').addEventListener('click', async () => { if (busy || !selected || !window.confirm('Permanently erase this application, its history and both photos?')) return;
    actionBusy(true);
    try { await request(endpoint + '/' + encodeURIComponent(selected), {method:'DELETE'}); el('detail').hidden = true; el('pictures').replaceChildren(); selected = null; actionBusy(false); await load(true); } catch (e) { status(e.message, true); } finally { actionBusy(false); }
  });
  load(true);
})();
