// Shared by the organizer desk and the judge scorecard: shows who is signed in and offers sign-out for site sessions.
(() => {
  const bar = document.querySelector('.bar-inner');
  if (!bar) return;
  fetch('/api/access/me', {credentials: 'same-origin', cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(me => {
    if (!me?.signedIn) return;
    const box = document.createElement('span'); box.className = 'session-box';
    const who = document.createElement('span'); who.className = 'session-who'; who.textContent = me.email; box.append(who);
    if (me.via === 'session') {
      const out = document.createElement('button'); out.type = 'button'; out.className = 'plain session-out'; out.textContent = 'Sign out';
      out.addEventListener('click', async () => {
        if (document.body.dataset.unsaved === 'yes' && !window.confirm('Sign out? Scores you have not saved will be lost.')) return;
        await fetch('/api/access/logout', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: '{}'}).catch(() => {});
        location.replace('/access/');
      });
      box.append(out);
    }
    bar.append(box);
  }).catch(() => {});
})();
