// Shared helpers for the organizer desk. Everything rendered here is built with textContent, never markup strings.
window.QOQ = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const when = value => value ? new Intl.DateTimeFormat('en-PH', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Manila'}).format(new Date(value)) : '—';
  const peso = centavos => new Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP'}).format(Number(centavos || 0) / 100);
  const count = value => new Intl.NumberFormat('en-PH').format(Number(value || 0));
  const announce = (message, error = false) => { el('ops-message').textContent = message; el('ops-message').classList.toggle('error', error); };

  async function api(action, payload = {}) {
    const response = await fetch('/api/competition/organizer.' + action, {method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json', Accept:'application/json'}, body:JSON.stringify(payload)});
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      el('dashboard').hidden = true; el('ops-recovery').hidden = false; el('ops-signin').hidden = response.status !== 401;
      throw Error(response.status === 401 ? 'Sign in with the organizer account to open the event desk.' : 'This account does not have organizer access.');
    }
    if (!response.ok || !body || body.error) {
      if (response.status === 503) throw Error('Event management is temporarily unavailable. Nothing was changed. Please try again.');
      throw Error(typeof body?.error === 'string' ? body.error : 'This change could not be confirmed. Refresh the desk and try again.');
    }
    return body;
  }
  let busy = false;
  async function perform(operation) {
    if (busy) return;
    busy = true;
    try { await operation(); }
    catch (error) {
      announce(error instanceof TypeError ? 'The connection was interrupted. Refresh the desk before retrying.' : error.message, true);
      el('ops-recovery').hidden = false; el('ops-message').scrollIntoView({block:'nearest'});
    } finally { busy = false; }
  }
  // rows: arrays of cells. A cell is text, a Node, or {text, num:true, className}.
  function table(headers, rows, caption) {
    const element = make('table', undefined, 'tally-table');
    if (caption) element.append(make('caption', caption));
    const head = element.createTHead().insertRow();
    for (const label of headers) { const numeric = typeof label === 'object'; const cell = make('th', numeric ? label.text : label); cell.scope = 'col'; if (numeric) cell.className = 'num'; head.append(cell); }
    const body = element.createTBody();
    for (const columns of rows) {
      const row = body.insertRow();
      for (const value of columns) {
        const cell = row.insertCell();
        if (value instanceof Node) cell.append(value);
        else if (value && typeof value === 'object') { cell.textContent = value.text ?? ''; if (value.num) cell.classList.add('num'); if (value.className) cell.classList.add(value.className); }
        else cell.textContent = value ?? '';
      }
    }
    return element;
  }
  const pill = (node, text, tone) => { node.textContent = text; node.className = 'pill' + (tone ? ' ' + tone : ''); };
  function checklist(target, items) {
    target.replaceChildren(...items.map(([state, label, detail]) => {
      const item = make('li', undefined, state === true ? 'done' : state === 'blocked' ? 'blocked' : '');
      const body = make('span', label); if (detail) body.append(make('small', detail)); item.append(body); return item;
    }));
  }
  // A printable sheet. `status` is printed as a boxed label so a draft can never pass for a certified result.
  function print({title, subtitle, status, reportId, tables, signatures}) {
    const sheet = el('print-sheet');
    sheet.replaceChildren(make('h1', 'Queen of Quiapo 2027'), make('h2', title + (subtitle ? ' · ' + subtitle : '')), make('p', status, 'watermark'));
    for (const item of tables) sheet.append(item);
    if (signatures) { const row = make('div', undefined, 'sign'); for (const name of signatures) row.append(make('div', name)); sheet.append(row); }
    sheet.append(make('footer', 'Report ' + reportId + ' · generated ' + when(Date.now()) + ' Philippine time · Barangay 306, Quiapo, Manila. Signature lines are blank until signed by hand; this sheet carries no approval of its own.'));
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }
  const listeners = [];
  return {el, make, when, peso, count, announce, api, perform, table, pill, checklist, print,
    state: {}, onChange: fn => listeners.push(fn), changed: () => listeners.forEach(fn => fn())};
})();
