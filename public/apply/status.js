// Applicant self-service: confirm an application arrived, or withdraw it with the private key from the receipt.
(() => {
  const $ = id => document.getElementById(id);
  const when = value => new Intl.DateTimeFormat('en-PH', {dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Manila'}).format(new Date(value));
  const stages = {
    received: ['Received', 'Your application arrived and is waiting for review.'],
    review: ['In review', 'The organizers are reviewing your application.'],
    correction: ['Please expect a message', 'The organizers need you to correct or add something. They will contact you at the email or mobile number you gave.'],
    reviewed: ['Reviewed', 'Your application has been reviewed. The organizers will contact you directly about the result.'],
    withdrawn: ['Withdrawn', 'This application has been withdrawn.']
  };
  // Prefill from a receipt in this tab, if there is one.
  try { const saved = JSON.parse(sessionStorage.getItem('qoq-apply-receipt')); if (saved?.reference) { $('status-form').reference.value = saved.reference; $('withdraw-form').reference.value = saved.reference; $('withdraw-form').key.value = saved.key || ''; } } catch {}
  const tidyReference = text => text.trim().toUpperCase().replace(/\s+/g, '');
  const show = (node, message) => { node.textContent = message; node.hidden = !message; if (message) node.focus(); };

  const statusForm = $('status-form');
  statusForm.addEventListener('submit', async event => {
    event.preventDefault();
    show($('status-error'), ''); $('status-result').hidden = true;
    if (!statusForm.reportValidity()) return;
    $('status-submit').disabled = true;
    try {
      const response = await fetch('/api/applications/status', {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({reference: tidyReference(statusForm.reference.value), email: statusForm.email.value.trim()})});
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.stage) throw Error(typeof data?.error === 'string' ? data.error : 'Please try again in a moment.');
      const [title, body] = stages[data.stage] || stages.received;
      $('result-ref').textContent = 'REFERENCE ' + data.reference; $('result-title').textContent = title; $('result-body').textContent = body;
      $('result-time').textContent = data.submittedAt ? 'Received ' + when(data.submittedAt) + ' (Philippine time).' : '';
      $('status-result').hidden = false; $('result-title').focus();
    } catch (failure) {
      show($('status-error'), failure instanceof TypeError ? 'No connection. Check your internet and try again.' : failure.message);
    } finally { $('status-submit').disabled = false; }
  });

  const withdrawForm = $('withdraw-form');
  withdrawForm.addEventListener('submit', async event => {
    event.preventDefault();
    show($('withdraw-error'), '');
    if (!withdrawForm.reportValidity()) return;
    if (!window.confirm('Permanently withdraw this application and delete both photographs?')) return;
    $('withdraw-submit').disabled = true;
    try {
      const reference = tidyReference(withdrawForm.reference.value);
      const response = await fetch('/api/applications/' + encodeURIComponent(reference), {method: 'DELETE', credentials: 'same-origin',
        headers: {Accept: 'application/json', 'X-Application-Token': withdrawForm.key.value.trim().toLowerCase()}});
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw Error(response.status === 404 ? 'That reference number and withdrawal key do not match an application. Check both, or ask the organizers for help.' : typeof data?.error === 'string' ? data.error : 'Please try again in a moment.');
      try { sessionStorage.removeItem('qoq-apply-receipt'); } catch {}
      $('withdraw-panel').hidden = true; $('withdraw-done').hidden = false; $('withdraw-done-title').focus();
    } catch (failure) {
      show($('withdraw-error'), failure instanceof TypeError ? 'No connection. Check your internet and try again.' : failure.message);
    } finally { $('withdraw-submit').disabled = false; }
  });
})();
