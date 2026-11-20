(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const form = el('candidate-form');
  if (!form) return;
  const button = el('submit-application'), progress = el('submit-progress'), error = el('submit-error'), receipt = el('receipt');
  const steps = [...form.querySelectorAll('.form-part')];
  const links = [...document.querySelectorAll('.form-index a')];
  const photos = [...form.querySelectorAll('input[type=file]')];
  const previews = new Map();
  let current = 0, available = false, sending = false, touched = false, pendingBody = null;
  const titles = ['Candidate details', 'Height and vital stats', 'Your pageant profile', 'Required photographs', 'Review and send'];
  const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  form.noValidate = true;

  function clearPreview(input) {
    if (previews.has(input.id)) URL.revokeObjectURL(previews.get(input.id));
    previews.delete(input.id);
    const preview = el(input.id + '-preview');
    preview.hidden = true; preview.removeAttribute('src');
    document.querySelector('[data-remove-photo="' + input.id + '"]').hidden = true;
  }
  function validatePhoto(input) {
    const file = input.files[0];
    let message = '';
    if (file && (file.type ? !acceptedTypes.includes(file.type) : !/\.(jpe?g|png|webp)$/i.test(file.name))) {
      message = 'Choose a JPG, PNG or WebP photo. Export HEIC photos as JPEG first.';
    } else if (file && (file.size === 0 || file.size > 5 * 1024 * 1024)) {
      message = 'Choose a non-empty photo of 5 MB or less.';
    }
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    el(input.id + '-error').textContent = message;
    return Boolean(file) && !message;
  }
  for (const input of photos) {
    input.addEventListener('change', () => {
      clearPreview(input);
      if (!validatePhoto(input)) return;
      const url = URL.createObjectURL(input.files[0]);
      previews.set(input.id, url); el(input.id + '-preview').src = url; el(input.id + '-preview').hidden = false;
      document.querySelector('[data-remove-photo="' + input.id + '"]').hidden = false;
    });
    document.querySelector('[data-remove-photo="' + input.id + '"]').addEventListener('click', () => {
      input.value = ''; clearPreview(input); validatePhoto(input); input.focus();
    });
  }

  function validate(scope) {
    for (const input of scope.querySelectorAll('input,textarea')) {
      if (input.type === 'file') validatePhoto(input);
      else {
        input.setCustomValidity('');
        if (input.required && ['text','email'].includes(input.type) && !input.value.trim()) input.setCustomValidity('Please complete this field.');
        else if (input.type === 'email' && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) input.setCustomValidity('Enter a complete email address, such as name@example.com.');
      }
      input.setAttribute('aria-invalid', String(!input.validity.valid));
    }
    return scope.querySelector('input:invalid,textarea:invalid');
  }
  form.addEventListener('input', event => {
    touched = true;
    const input = event.target;
    if (input.setCustomValidity && input.type !== 'file') { input.setCustomValidity(''); input.removeAttribute('aria-invalid'); }
    el('step-error').hidden = true;
  });
  function checkStep(index) {
    const invalid = validate(steps[index]);
    if (!invalid) return true;
    showStep(index, false);
    el('step-error').textContent = 'Please check the highlighted field before continuing.'; el('step-error').hidden = false;
    invalid.focus(); invalid.reportValidity();
    return false;
  }
  function review() {
    const host = el('application-review'); host.replaceChildren();
    const groups = [
      [['Legal name','legalName'],['Pageant name','femaleName'],['Email address','email'],['Mobile number','mobile'],['City or municipality','locality']],
      [['Height (cm)','heightCm'],['Bust (in)','bustIn'],['Waist (in)','waistIn'],['Hips (in)','hipsIn']],
      [['Talent or skill','talent'],['Pageants or titles','experience'],['Why you want to join','motivation']],
      [['Close-up portrait','portrait'],['Full-body swimsuit photo','swimsuit']]
    ];
    groups.forEach((fields, index) => {
      const section = document.createElement('section'), heading = document.createElement('h3'), edit = document.createElement('button'), list = document.createElement('dl');
      section.className = 'review-group'; heading.textContent = titles[index];
      edit.type = 'button'; edit.className = 'journey-secondary'; edit.textContent = 'Edit ' + titles[index].toLowerCase(); edit.addEventListener('click', () => showStep(index));
      for (const [label, name] of fields) {
        const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'), input = form.elements.namedItem(name);
        dt.textContent = label;
        dd.textContent = input.type === 'file' ? (input.files[0]?.name || 'No photo selected') : (input.value.trim() || 'Not provided');
        row.append(dt, dd); list.append(row);
      }
      section.append(heading, list, edit); host.append(section);
    });
  }
  function showStep(index, focus = true) {
    current = index;
    steps.forEach((part, i) => { part.hidden = i !== current; });
    links.forEach((link, i) => { if (i === current) link.setAttribute('aria-current','step'); else link.removeAttribute('aria-current'); });
    el('step-label').textContent = 'Step ' + (current + 1) + ' of 5 · ' + titles[current];
    el('step-progress').value = current + 1;
    el('step-back').hidden = current === 0;
    el('step-next').hidden = current === 4;
    el('step-next').textContent = current === 2 ? 'Continue to photographs' : current === 3 ? 'Review application' : 'Continue';
    el('step-error').hidden = true;
    if (current === 4) review();
    if (focus) { const heading = steps[current].querySelector('legend'); heading.tabIndex = -1; heading.focus(); heading.scrollIntoView({block:'start',behavior:'auto'}); }
  }
  links.forEach((link, index) => link.addEventListener('click', event => {
    event.preventDefault(); if (sending || pendingBody) return;
    for (let i = current; i < index; i++) if (!checkStep(i)) return;
    showStep(index);
  }));
  el('step-back').addEventListener('click', () => showStep(Math.max(0, current - 1)));
  el('step-next').addEventListener('click', () => { if (checkStep(current)) showStep(current + 1); });
  el('journey-navigation').hidden = el('journey-progress').hidden = false;
  showStep(0, false);

  async function checkAvailability() {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    available = false; button.disabled = el('step-next').disabled = true; el('availability-retry').hidden = true;
    el('availability-message').textContent = 'Checking application availability…';
    try {
      const response = await fetch('/api/competition/public.event', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:'{}', signal:controller.signal});
      const data = await response.json();
      if (!response.ok || typeof data?.applicationsOpen !== 'boolean') throw Error();
      available = data.applicationsOpen;
      el('availability-message').textContent = available ? 'Applications are open for screening.' : 'Applications are not open at this time. Check the pageant schedule for updates.';
      el('availability-retry').hidden = available;
    } catch {
      el('availability-message').textContent = 'We could not check application availability. You can prepare your details below, then check again before sending.';
      el('availability-retry').hidden = false;
    } finally {
      clearTimeout(timeout); el('step-next').disabled = false; button.disabled = !available;
    }
    return available;
  }
  el('availability-retry').addEventListener('click', checkAvailability);
  checkAvailability();

  // This key and a pending upload stay in this tab only; no personal details are stored on the device.
  const submissionToken = crypto.randomUUID();
  form.elements.submissionId.value = submissionToken;
  function lock(locked) {
    steps.forEach(part => { part.disabled = locked; });
    el('step-back').disabled = el('step-next').disabled = locked;
    // Leave the submit button usable for an exact retry after a lost acknowledgement.
    steps[4].disabled = false;
    form.elements.consent.disabled = locked;
    el('application-review').querySelectorAll('button').forEach(b => { b.disabled = locked; });
    document.querySelector('.form-index').setAttribute('aria-disabled', String(locked));
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    if (current < 4) { if (checkStep(current)) showStep(current + 1); return; }
    if (!pendingBody) {
      for (let i = 0; i < steps.length; i++) if (!checkStep(i)) return;
      if (!available) { el('application-state').scrollIntoView({block:'center'}); return; }
      pendingBody = new FormData(form);
    }
    sending = true; lock(true); button.disabled = true; form.setAttribute('aria-busy','true');
    error.hidden = true; progress.textContent = 'Uploading both photos and sending your application. Keep this page open…';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(form.action, {method:'POST',body:pendingBody,credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}});
      const result = await response.json().catch(() => null);
      if (![200,201].includes(response.status) || typeof result?.reference !== 'string' || !result.reference.trim()) {
        // Only definitive rejection allows editing. Ambiguous failures retry the identical payload and key.
        if (response.status >= 400 && response.status < 500 && response.status !== 408) { pendingBody = null; lock(false); }
        let message = typeof result?.error === 'string' ? result.error : 'Receipt could not be confirmed. Keep this page open and retry the same submission.';
        if (response.status === 413) message = 'Choose smaller photos, up to 5 MB each, then try again.';
        if (response.status === 429) message = 'Please wait a few minutes, then try again.';
        if (response.status === 409 && result?.error === 'Applications are not open at this time') {
          available = false; el('availability-message').textContent = 'Applications are not open at this time. Your entries remain in this tab.'; el('availability-retry').hidden = false;
        }
        throw Error(message);
      }
      el('receipt-reference').textContent = result.reference;
      if (result.edition) el('receipt-edition').textContent = result.edition;
      const received = new Date(result.submittedAt);
      el('receipt-time').textContent = result.submittedAt && Number.isFinite(received.getTime())
        ? new Intl.DateTimeFormat('en-PH',{dateStyle:'long',timeStyle:'short',timeZone:'Asia/Manila'}).format(received) + ' (Philippine time)'
        : 'Recorded by the screening team';
      photos.forEach(clearPreview); form.reset(); pendingBody = null; touched = false;
      form.hidden = true; receipt.hidden = false; el('receipt-title').focus(); receipt.scrollIntoView({block:'start'});
    } catch (failure) {
      error.textContent = pendingBody
        ? 'We could not confirm receipt. Your entries are held in this tab. Use “Retry same submission” to check safely without creating another entry. Keep this page open.'
        : (failure.message || 'Please check your details and try again.');
      error.hidden = false; error.focus();
    } finally {
      clearTimeout(timeout); sending = false; progress.textContent = ''; form.removeAttribute('aria-busy');
      button.disabled = !available && !pendingBody; button.textContent = pendingBody ? 'Retry same submission' : 'Submit application';
      if (!pendingBody) lock(false);
    }
  });
  window.addEventListener('beforeunload', event => { if (touched && !form.hidden) { event.preventDefault(); event.returnValue = ''; } });
  el('receipt-print').addEventListener('click', () => window.print());
  el('receipt-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(el('receipt-reference').textContent); el('receipt-feedback').textContent = 'Reference copied.'; }
    catch { el('receipt-feedback').textContent = 'Copy is unavailable. Select the reference number above, or download your receipt.'; }
  });
  el('receipt-download').addEventListener('click', () => {
    const text = ['QUEEN OF QUIAPO 2027 — APPLICATION RECEIPT', 'Reference: ' + el('receipt-reference').textContent, 'Received: ' + el('receipt-time').textContent, 'Status: Submitted for screening', '', ...[...receipt.querySelectorAll(':scope > p')].filter(p => p.id !== 'receipt-feedback').map(p => p.textContent), '', 'Schedule: https://queenofquiapo.com/schedule/'].join('\n\n');
    const url = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})), link = document.createElement('a');
    link.href = url; link.download = el('receipt-reference').textContent + '-receipt.txt'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    el('receipt-feedback').textContent = 'Receipt download requested. Keep the file with your application reference.';
  });

  const options = el('withdraw-options'), withdraw = el('withdraw-confirm'), cancel = el('withdraw-cancel'), withdrawError = el('withdraw-error');
  cancel.addEventListener('click', () => { options.open = false; withdrawError.hidden = true; options.querySelector('summary').focus(); });
  withdraw.addEventListener('click', async () => {
    const reference = el('receipt-reference').textContent;
    if (withdraw.disabled || receipt.hidden || !reference) return;
    withdraw.disabled = cancel.disabled = true; withdraw.textContent = 'Withdrawing…'; withdrawError.hidden = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),30000);
    try {
      const response = await fetch(form.action + '/' + encodeURIComponent(reference), {method:'DELETE',signal:controller.signal,credentials:'same-origin',headers:{Accept:'application/json','X-Application-Token':submissionToken}});
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw Error(result?.error || 'We could not confirm withdrawal. Please try again.');
      receipt.hidden = true; el('withdrawn').hidden = false; el('withdrawn-title').focus();
    } catch (failure) {
      withdrawError.textContent = failure.name === 'AbortError' || failure instanceof TypeError ? 'Your connection was interrupted. Please try again to confirm withdrawal.' : failure.message;
      withdrawError.hidden = false; withdrawError.focus();
    } finally { clearTimeout(timeout); withdraw.disabled = cancel.disabled = false; withdraw.textContent = 'Confirm withdrawal'; }
  });
})();
