(() => {
  async function post(action, body = {}) {
    const response = await fetch('/api/competition/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {'Content-Type':'application/json', Accept:'application/json'},
      body: JSON.stringify(body)
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data || typeof data !== 'object') {
      const error = new Error(typeof data?.error === 'string' ? data.error : 'Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  const notices = document.getElementById('announcements');
  if (notices) {
    post('public.announcements').then(data => {
      const entries = (Array.isArray(data.announcements) ? data.announcements : [])
        .filter(entry => typeof entry?.title === 'string' && typeof entry?.body === 'string');
      if (!entries.length) return;
      const title = document.createElement('h2');
      title.textContent = 'Announcements';
      const fragment = document.createDocumentFragment();
      fragment.append(title);
      for (const entry of entries) {
        const article = document.createElement('article');
        const heading = document.createElement('h3');
        const copy = document.createElement('p');
        heading.textContent = entry.title;
        copy.textContent = entry.body;
        article.append(heading,copy);
        fragment.append(article);
      }
      notices.replaceChildren(fragment);
      notices.hidden = false;
    }).catch(() => { notices.hidden = true; });
  }

  const section = document.getElementById('public-ballot');
  if (!section) return;
  const byId = id => document.getElementById(id);
  const status = byId('vote-status'), ballot = byId('ballot'), choices = byId('choices');
  const review = byId('cast'), confirm = byId('verify-vote'), send = byId('confirm-cast');
  const feedback = byId('cast-feedback'), signIn = byId('voter-signin'), change = byId('change-choice');
  let selected = null, pending = false;
  post('public.voting').then(data => {
    if (data.voting === 'ended') {
      status.textContent = 'Voting has ended for this round.';
      return;
    }
    const entries = Array.isArray(data.candidates) ? data.candidates : [];
    if (data.voting !== 'open' || !entries.length) return;
    for (const item of entries) {
      if (!['number','string'].includes(typeof item?.id) || typeof item.name !== 'string' || !item.name.trim()) continue;
      const label = document.createElement('label'), radio = document.createElement('input'), title = document.createElement('strong');
      radio.type = 'radio'; radio.name = 'candidate'; radio.required = true;
      radio.value = String(item.id);
      if (typeof item.photoKey === 'string' && item.photoKey) {
        const img = document.createElement('img');
        img.src = '/api/competition/photo/' + encodeURIComponent(item.photoKey);
        img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => {img.hidden = true;}, {once:true});
        label.append(img);
      }
      title.textContent=item.name;
      radio.addEventListener('change',() => { selected=item; review.disabled=false; feedback.textContent=''; });
      label.append(radio,title); choices.append(label);
    }
    if (!choices.querySelector('input')) return;
    status.textContent = 'Voting is open for the current round.';
    section.hidden = false;
  }).catch(() => { status.textContent='Voting is currently unavailable. Please check back later.'; });
  ballot.addEventListener('submit',e => {
    e.preventDefault();
    if (!selected || pending || !ballot.reportValidity()) return;
    byId('selection').textContent='Your vote will go to '+selected.name+'.';
    ballot.hidden=true; confirm.hidden=false; feedback.textContent=''; send.focus();
  });
  change.addEventListener('click',() => {
    if (pending) return;
    confirm.hidden=true; ballot.hidden=false; feedback.textContent='';
    choices.querySelector('input:checked')?.focus();
  });
  send.addEventListener('click',async () => {
    if (!selected || pending || confirm.hidden) return;
    pending=true;send.disabled=true;change.disabled=true;signIn.hidden=true;
    feedback.textContent='Sending your vote…';
    try {
      await post('voter.cast',{candidateId:selected.id});
      confirm.hidden=true;
      feedback.textContent='Your vote has been recorded.';
    } catch (e) {
      if (e.status===401) {
        feedback.textContent='Please sign in to confirm your vote.';
        signIn.hidden=false; signIn.focus();
      } else {
        feedback.textContent=typeof e.status==='number' ? e.message : 'We could not confirm your vote. Check your connection and try again.';
      }
    } finally {pending=false;send.disabled=false;change.disabled=false;}
  });
})();
