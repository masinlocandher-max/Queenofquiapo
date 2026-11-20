// Candidate application. Built for phones on mobile data:
//  - photos are prepared on the phone (resized, re-encoded as JPEG, location and camera details removed) before upload;
//  - the upload shows real progress and is not cut off while it is still moving;
//  - typed answers and this form's private id survive a reload, so a retry never creates a second application;
//  - nothing says "received" until the server has stored the application.
(() => {
  const form = document.getElementById('candidate-form');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const button = $('submit-application'), progress = $('submit-progress'), meter = $('submit-meter'), error = $('submit-error'), receipt = $('receipt');
  const LIMIT = 5 * 1024 * 1024, ORIGINAL_LIMIT = 40 * 1024 * 1024, MAX_EDGE = 2400;
  const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
  const TEXT_FIELDS = ['legalName', 'femaleName', 'email', 'mobile', 'locality', 'heightCm', 'bustIn', 'waistIn', 'hipsIn', 'talent', 'experience', 'motivation'];
  const KEYS = {id: 'qoq-apply-id', draft: 'qoq-apply-draft', receipt: 'qoq-apply-receipt'};
  // sessionStorage lives only in this browser tab: enough to survive a reload, gone when the tab closes (shared phones).
  const store = {
    get: key => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    set: (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} },
    drop: key => { try { sessionStorage.removeItem(key); } catch {} }
  };
  const when = value => new Intl.DateTimeFormat('en-PH', {dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Manila'}).format(new Date(value));
  const mb = bytes => (bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1) + ' MB';

  function newId() {
    if (self.crypto.randomUUID) return self.crypto.randomUUID();
    const bytes = self.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  // One private id per application, kept across reloads until a receipt is issued. The server uses it to recognize a retry.
  let token = store.get(KEYS.id);
  if (!/^[0-9a-f-]{36}$/.test(token || '')) { token = newId(); store.set(KEYS.id, token); }
  form.elements.submissionId.value = token;

  // ---- Typed answers survive a reload (not the photos, which are never stored on the device) ----
  const draft = store.get(KEYS.draft);
  if (draft && typeof draft === 'object') {
    let restored = false;
    for (const name of TEXT_FIELDS) if (typeof draft[name] === 'string' && draft[name] && !form.elements[name].value) { form.elements[name].value = draft[name]; restored = true; }
    $('draft-restored').hidden = !restored;
  }
  let touched = false;
  form.addEventListener('input', () => {
    touched = true;
    const values = {}; for (const name of TEXT_FIELDS) values[name] = form.elements[name].value;
    store.set(KEYS.draft, values);
  });
  window.addEventListener('beforeunload', event => { if (touched && !form.hidden && !submitting) { event.preventDefault(); event.returnValue = ''; } });

  // ---- Clear, human messages for measurements ----
  const measureHelp = {heightCm: 'Enter your height in centimeters, between 100 and 250 — for example 168.', bustIn: 'Enter your bust in inches, between 10 and 80 — for example 34.',
    waistIn: 'Enter your waist in inches, between 10 and 80 — for example 26.', hipsIn: 'Enter your hips in inches, between 10 and 80 — for example 36.'};
  for (const [name, message] of Object.entries(measureHelp)) {
    const input = form.elements[name];
    input.addEventListener('invalid', () => { if (!input.validity.customError) input.setCustomValidity(message); });
    input.addEventListener('input', () => input.setCustomValidity(''));
  }

  // ---- Photos: prepared on the phone ----
  const photos = Array.from(form.querySelectorAll('input[type=file]'));
  const prepared = new Map(), pending = new Map(), previews = new Map();
  function showPhotoMessage(input, message, ready = '') {
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    $(input.id + '-error').textContent = message;
    $(input.id + '-ready').textContent = ready;
  }
  function clearPreview(input) {
    const previous = previews.get(input.id); if (previous) URL.revokeObjectURL(previous);
    previews.delete(input.id); prepared.delete(input.id);
    const preview = $(input.id + '-preview'); preview.hidden = true; preview.removeAttribute('src');
  }
  async function prepare(file) {
    if (!file.size) throw Error('This file is empty. Choose the photo again.');
    if (file.size > ORIGINAL_LIMIT) throw Error('This file is unusually large. Choose the photo straight from your camera or gallery.');
    let bitmap = null;
    try { bitmap = await createImageBitmap(file); } catch {}
    if (!bitmap) {
      // The browser cannot open it. A small JPEG, PNG or WebP can still go as it is; the server checks it again.
      if (ACCEPTED.includes(file.type) && file.size <= LIMIT) return {blob: file, ready: 'Ready to send (' + mb(file.size) + ').', small: false};
      throw Error(/hei[cf]/i.test(file.type + file.name)
        ? 'This iPhone photo format (HEIC) cannot be opened here. Set Settings › Camera › Formats to “Most Compatible” and take it again, or share the photo as JPEG.'
        : 'This file could not be opened as a photo. Choose a JPG, PNG or WebP photo.');
    }
    const {width, height} = bitmap;
    let edge = MAX_EDGE, quality = .9, blob = null;
    for (let attempt = 0; attempt < 4 && !(blob && blob.size <= LIMIT); attempt++) {
      const scale = Math.min(1, edge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);   // transparent areas become white, not black
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      edge = Math.round(edge * .8); quality = Math.max(.75, quality - .05);
    }
    bitmap.close?.();
    if (!blob || blob.size > LIMIT) {
      if (ACCEPTED.includes(file.type) && file.size <= LIMIT) return {blob: file, ready: 'Ready to send (' + mb(file.size) + ').', small: false};
      throw Error('This photo could not be made small enough to send. Try another photo.');
    }
    return {blob, small: Math.max(width, height) < 800,
      ready: 'Ready to send: ' + mb(blob.size) + (file.size > blob.size ? ' (was ' + mb(file.size) + ')' : '') + '. Location and camera details removed.'};
  }
  for (const input of photos) {
    input.addEventListener('change', () => {
      clearPreview(input);
      const file = input.files[0];
      if (!file) { showPhotoMessage(input, ''); return; }
      showPhotoMessage(input, '', 'Preparing your photo…');
      const job = prepare(file).then(result => {
        if (input.files[0] !== file) return;   // a newer choice replaced this one
        prepared.set(input.id, result);
        const url = URL.createObjectURL(result.blob); previews.set(input.id, url);
        const preview = $(input.id + '-preview'); preview.src = url; preview.hidden = false;
        showPhotoMessage(input, '', result.ready + (result.small ? ' This photo is quite small; a larger, clearer photo helps the screening panel.' : ''));
      }).catch(failure => { if (input.files[0] === file) showPhotoMessage(input, failure.message); })
        .finally(() => { if (pending.get(input.id) === job) pending.delete(input.id); });
      pending.set(input.id, job);
    });
  }

  // ---- Application window and confirmed screening details ----
  let windowInfo = null;
  fetch('/api/competition/public.applications', {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: '{}'})
    .then(r => r.ok ? r.json() : null).then(info => {
      if (!info) return;
      windowInfo = info;
      const line = $('apply-window');
      if (info.open === false) {
        const notice = $('apply-closed');
        const opensLater = info.opensAt && new Date(info.opensAt) > new Date();
        notice.textContent = opensLater ? 'Applications open on ' + when(info.opensAt) + ' (Philippine time). Please come back then.' : 'Applications for Queen of Quiapo 2027 are closed. Thank you for your interest.';
        notice.hidden = false;
        form.querySelectorAll('fieldset').forEach(field => { field.disabled = true; });
        button.disabled = true;
        line.textContent = notice.textContent; line.hidden = false;
      } else if (info.closesAt) {
        line.textContent = 'Applications close on ' + when(info.closesAt) + ' (Philippine time).'; line.hidden = false;
      }
      if (info.screeningVenue) $('receipt-venue').textContent = 'the venue is ' + info.screeningVenue;
    }).catch(() => {});

  // ---- Upload with visible progress ----
  function upload(body) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', form.action);
      request.setRequestHeader('Accept', 'application/json');
      request.timeout = 300000;   // five minutes: slow mobile data is still progress, not failure
      request.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        const percent = Math.round(event.loaded / event.total * 100);
        meter.hidden = false; meter.value = percent;
        progress.textContent = percent < 100 ? 'Sending your application… ' + percent + '%' : 'Saving your application…';
      };
      request.onload = () => { let data = null; try { data = JSON.parse(request.responseText); } catch {} resolve({status: request.status, data}); };
      request.onerror = () => reject(Object.assign(Error('network'), {network: true}));
      request.ontimeout = () => reject(Object.assign(Error('timeout'), {network: true}));
      request.send(body);
    });
  }

  let submitting = false;
  function showReceipt(record) {
    $('receipt-reference').textContent = record.reference;
    $('receipt-edition').textContent = record.edition || 'Queen of Quiapo 2027';
    $('receipt-time').textContent = when(record.submittedAt || Date.now()) + ' (Philippine time)';
    $('receipt-key').textContent = record.key;
    $('receipt-note').textContent = record.note || ''; $('receipt-note').hidden = !record.note;
    if (record.venue) $('receipt-venue').textContent = 'the venue is ' + record.venue;
    photos.forEach(clearPreview);
    form.hidden = true; receipt.hidden = false; touched = false;
  }
  // A receipt already issued in this tab is shown again after a reload, instead of an empty form.
  const earlier = store.get(KEYS.receipt);
  if (earlier?.reference && earlier.key) showReceipt(earlier);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    error.hidden = true; error.textContent = '';
    if (pending.size) { progress.textContent = 'Preparing your photos…'; await Promise.all(pending.values()); progress.textContent = ''; }
    for (const input of photos) if (input.files[0] && !prepared.has(input.id) && !input.validationMessage) showPhotoMessage(input, 'Choose this photo again.');
    if (!form.reportValidity()) return;

    const body = new FormData();
    for (const name of TEXT_FIELDS) body.set(name, form.elements[name].value);
    body.set('consent', form.elements.consent.checked ? 'yes' : '');
    body.set('submissionId', token);
    body.set('portrait', prepared.get('portrait').blob, 'portrait.jpg');
    body.set('swimsuit', prepared.get('swimsuit').blob, 'swimsuit.jpg');

    submitting = true;
    const fields = Array.from(form.querySelectorAll('fieldset'));
    fields.forEach(field => { field.disabled = true; });
    button.disabled = true; form.setAttribute('aria-busy', 'true');
    meter.value = 0; meter.hidden = false; progress.textContent = 'Sending your application… 0%';
    try {
      const {status, data} = await upload(body);
      const arrived = typeof data?.reference === 'string' && data.reference.trim();
      if (([200, 201].includes(status) || (status === 409 && data?.alreadyReceived)) && arrived) {
        const record = {reference: data.reference, submittedAt: data.submittedAt || null, edition: data.edition || null, key: token,
          venue: windowInfo?.screeningVenue || null, note: status === 409 ? data.error : ''};
        store.set(KEYS.receipt, record); store.drop(KEYS.draft); store.drop(KEYS.id);
        form.reset(); showReceipt(record);
        $('receipt-title').focus(); receipt.scrollIntoView({block: 'start'});
        return;
      }
      let message = 'We could not confirm that your application arrived. Your answers are still here; please try again.';
      if (typeof data?.error === 'string') message = data.error;
      else if (status === 413) message = 'The photos are too large to send. Choose each photo again.';
      else if (status === 429) message = 'Many applications are arriving from this connection. Please wait a few minutes, then press Submit again.';
      else if (status === 401 || status === 403) message = 'Access was interrupted. Keep this page open, reload the website in another tab, then press Submit again.';
      throw Error(message);
    } catch (failure) {
      error.textContent = failure.network
        ? 'Your connection dropped before we could confirm your application. Your answers and photos are still on this page. Press Submit again: it will not create a second application.'
        : failure.message;
      error.hidden = false; error.focus();
    } finally {
      submitting = false; meter.hidden = true; progress.textContent = '';
      form.removeAttribute('aria-busy');
      fields.forEach(field => { field.disabled = false; });
      button.disabled = false;
    }
  });

  // ---- Receipt actions ----
  for (const copy of document.querySelectorAll('[data-copy]')) {
    copy.addEventListener('click', async () => {
      const text = $(copy.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { const range = document.createRange(); range.selectNodeContents($(copy.dataset.copy)); getSelection().removeAllRanges(); getSelection().addRange(range); copy.textContent = 'Selected'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    });
  }
  $('receipt-print').addEventListener('click', () => { $('receipt').querySelector('.receipt-key').open = true; window.print(); });
  $('receipt-another').addEventListener('click', () => {
    if (!window.confirm('Start a new application, for example for another candidate on this phone? Keep this receipt first: print it or copy the reference number and key.')) return;
    store.drop(KEYS.receipt); token = newId(); store.set(KEYS.id, token); form.elements.submissionId.value = token;
    form.reset(); $('draft-restored').hidden = true; photos.forEach(input => { clearPreview(input); showPhotoMessage(input, ''); });
    receipt.hidden = true; $('withdrawn').hidden = true; form.hidden = false;
    $('candidate-details').scrollIntoView({block: 'start'}); form.elements.legalName.focus({preventScroll: true});
  });

  const withdrawOptions = $('withdraw-options'), withdrawButton = $('withdraw-confirm'), withdrawCancel = $('withdraw-cancel'), withdrawError = $('withdraw-error');
  withdrawCancel.addEventListener('click', () => { withdrawOptions.open = false; withdrawError.hidden = true; withdrawOptions.querySelector('summary').focus(); });
  withdrawButton.addEventListener('click', async () => {
    const reference = $('receipt-reference').textContent, key = $('receipt-key').textContent;
    if (withdrawButton.disabled || receipt.hidden || !reference || !key) return;
    withdrawButton.disabled = true; withdrawCancel.disabled = true; withdrawButton.textContent = 'Withdrawing…'; withdrawError.hidden = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(form.action + '/' + encodeURIComponent(reference), {method: 'DELETE', signal: controller.signal, credentials: 'same-origin',
        headers: {Accept: 'application/json', 'X-Application-Token': key}});
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw Error(typeof result?.error === 'string' ? result.error : 'We could not confirm withdrawal. Please try again.');
      store.drop(KEYS.receipt);
      receipt.hidden = true; $('withdrawn').hidden = false; $('withdrawn-title').focus();
    } catch (failure) {
      withdrawError.textContent = failure.name === 'AbortError' || failure instanceof TypeError ? 'Your connection was interrupted. Please try again to confirm withdrawal.' : failure.message;
      withdrawError.hidden = false; withdrawError.focus();
    } finally { clearTimeout(timeout); withdrawButton.disabled = false; withdrawCancel.disabled = false; withdrawButton.textContent = 'Confirm withdrawal'; }
  });
  button.disabled = false;
})();
