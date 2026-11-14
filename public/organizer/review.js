// Organizer desk: private application inbox with status, search, notes and promotion to the official roster.
(() => {
  const {el, make, when, pill} = window.QOQ;
  const endpoint = '/api/reviewer/applications';
  const names = {submitted:'Submitted', under_review:'Under review', correction_requested:'Correction requested', qualified:'Qualified for screening', screened:'Screening completed', approved:'Approved', not_selected:'Not selected', withdrawn:'Withdrawn'};
  const tones = {approved:'good', qualified:'good', screened:'good', not_selected:'bad', withdrawn:'bad', correction_requested:'warn', under_review:'warn'};
  const next = {submitted:['under_review','withdrawn'], under_review:['qualified','correction_requested','not_selected','withdrawn'], correction_requested:['under_review','not_selected','withdrawn'],
    qualified:['screened','not_selected','withdrawn'], screened:['approved','not_selected','withdrawn'], approved:['withdrawn'], not_selected:['under_review'], withdrawn:[]};
  let cursor = null, selected = null, filter = '', busy = false;
  const status = (text, error) => { el('status').textContent = text; el('status').classList.toggle('error-text', Boolean(error)); };
  async function request(url, options = {}) {
    const response = await fetch(url, {cache:'no-store', credentials:'same-origin', ...options, headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})}});
    if (response.status === 401 || response.status === 403) {
      el('inbox').hidden = el('detail').hidden = true; el('signin').hidden = response.status !== 401;
      throw Error(response.status === 401 ? 'Sign in with the organizer account to review submissions.' : 'This account does not have organizer access.');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : 'The request could not be completed. Nothing was changed. Please try again.');
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
    if (reset) { cursor = null; el('rows').replaceChildren(); }
    el('more').disabled = true;
    try {
      const form = el('inbox-search'), params = new URLSearchParams({sort: form.sort.value});
      if (cursor) params.set('cursor', cursor); if (filter) params.set('status', filter); if (form.q.value.trim()) params.set('q', form.q.value.trim());
      const data = await request(endpoint + '?' + params);
      el('inbox').hidden = false; chips(data.counts || {}, data.total ?? 0);
      for (const entry of data.applications) {
        const button = make('button', undefined, 'entry'); button.type = 'button';
        const name = make('span', entry.femaleName), badge = make('span'); pill(badge, names[entry.status] || entry.status, tones[entry.status]); name.append(badge);
        if (entry.duplicate) { const dup = make('span'); pill(dup, 'Possible duplicate', 'warn'); name.append(dup); }
        button.append(name, make('small', entry.locality + ' · ' + when(entry.submittedAt) + ' · ' + entry.reference));
        button.addEventListener('click', () => show(entry.reference)); el('rows').append(button);
      }
      cursor = data.nextCursor; el('more').hidden = cursor == null;
      status(el('rows').childElementCount ? (data.total ?? '') + ' application' + (data.total === 1 ? '' : 's') + ' received. Select one to review.' : (filter || form.q.value.trim()) ? 'No applications match this filter.' : 'No applications have been received yet.');
    } catch (e) { status(e.message, true); } finally { el('more').disabled = false; }
  }
  async function show(reference) {
    try {
      const {application: entry} = await request(endpoint + '/' + encodeURIComponent(reference));
      selected = reference; el('inbox').hidden = true; el('detail').hidden = false; el('candidate').textContent = entry.femaleName;
      status('Private screening application'); el('fields').replaceChildren(); el('app-note').value = '';
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
        im.alt = label + ' of ' + entry.femaleName; im.src = url; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Open ' + label + ' at full size');
        a.append(im); f.append(a, make('figcaption', label)); el('pictures').append(f);
      }
      const history = el('app-history'); history.replaceChildren(make('li', 'Submitted ' + when(entry.submittedAt)));
      for (const h of entry.history || []) { const li = make('li', h.kind === 'status' ? (names[h.from] || h.from) + ' → ' + (names[h.to] || h.to) : 'Note'); if (h.note) li.append(': ' + h.note); li.append(make('small', ' · ' + h.actor + ' · ' + when(h.at))); history.append(li); }
      el('candidate').focus();
    } catch (e) { status(e.message, true); }
  }
  async function act(path, body, done) {
    if (busy || !selected) return; busy = true;
    try { await request(endpoint + '/' + encodeURIComponent(selected) + '/' + path, {method:'POST', body: JSON.stringify(body)}); const ref = selected; await show(ref); status(done); if (window.QOQ.state.reload) window.QOQ.state.reload().catch(() => {}); }
    catch (e) { status(e.message, true); el('status').scrollIntoView({block:'nearest'}); } finally { busy = false; }
  }
  function decide(target) {
    if (['withdrawn','not_selected','approved'].includes(target) && !window.confirm('Mark this application as ' + names[target].toLowerCase() + '?')) return;
    act('status', {status: target, note: el('app-note').value.trim()}, 'Status updated to ' + names[target].toLowerCase() + '.');
  }
  el('app-add-note').addEventListener('click', () => { if (el('app-note').value.trim()) act('note', {note: el('app-note').value.trim()}, 'Note saved.'); });
  el('app-promote').addEventListener('click', () => { if (window.confirm('Add this applicant to the official roster? Only her pageant name is copied. She stays unpublished until you assign a number, record her publicity clearance and publish.')) act('promote', {}, 'Added to the official roster. Finish her entry under Candidates.'); });
  el('back').addEventListener('click', () => { selected = null; el('detail').hidden = true; el('pictures').replaceChildren(); load(true); });
  el('more').addEventListener('click', () => load());
  el('inbox-search').addEventListener('submit', event => { event.preventDefault(); load(true); });
  el('remove').addEventListener('click', async () => { if (!selected || !window.confirm('Permanently erase this application, its history and both photos?')) return;
    el('remove').disabled = true;
    try { await request(endpoint + '/' + encodeURIComponent(selected), {method:'DELETE'}); el('detail').hidden = true; el('pictures').replaceChildren(); selected = null; await load(true); } catch (e) { status(e.message, true); } finally { el('remove').disabled = false; }
  });
  load(true);
})();
