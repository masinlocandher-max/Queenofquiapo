// Staff sign-in without a ChatGPT account: organizer password or judge access code.
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const host = location.hostname, form = el('signin-form');
  const fixed = host.startsWith('org.') ? 'organizer' : host.startsWith('judge.') ? 'judge' : null;
  const params = new URLSearchParams(location.search);
  const back = params.get('return_to');
  const role = () => fixed || form.role.value;
  // Only same-site paths are followed after sign-in.
  const destination = () => back && /^\/(?!\/)[\w\-./%?=&#]*$/.test(back) ? back : role() === 'organizer' ? '/organizer/' : '/judge/';
  el('chatgpt-link').href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(destination());
  function describe() {
    const judge = role() === 'judge';
    el('signin-title').textContent = fixed === 'organizer' ? 'Organizer sign-in' : fixed === 'judge' ? 'Judge sign-in' : 'Staff sign-in';
    el('secret-label').textContent = judge ? 'Access code' : 'Password';
    el('secret').autocomplete = judge ? 'one-time-code' : 'current-password';
    el('secret').autocapitalize = judge ? 'characters' : 'off';
    el('secret-help').textContent = judge ? 'The code the organizer gave you, for example ABCD-EFGH-JKMN. Dashes and spaces are optional.' : 'At least 12 characters.';
    el('signin-help').textContent = judge ? 'Forgot your access code? Ask the organizer to reset it. Resetting gives you a new code and ends any earlier sign-in.'
      : 'Forgot the organizer password? It is reset by the technical administrator (see docs/DEPLOYMENT.md).';
  }
  el('role-choice').hidden = Boolean(fixed);
  form.addEventListener('change', event => { if (event.target.name === 'role') describe(); });
  el('show-secret').addEventListener('change', event => { el('secret').type = event.target.checked ? 'text' : 'password'; });
  describe();
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; el('signin-submit').disabled = true; el('signin-status').textContent = 'Signing in…'; el('signin-status').classList.remove('error');
    try {
      const response = await fetch('/api/access/login', {method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({email: el('email').value.trim(), secret: el('secret').value, role: role()})});
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true) throw Error(typeof body?.error === 'string' ? body.error : 'Sign-in could not be completed. Please try again.');
      el('signin-status').textContent = 'Signed in. Opening…';
      location.replace(destination());
    } catch (error) {
      el('signin-status').textContent = error instanceof TypeError ? 'No connection. Check your internet and try again.' : error.message;
      el('signin-status').classList.add('error'); el('secret').select();
    } finally { busy = false; el('signin-submit').disabled = false; }
  });
})();
