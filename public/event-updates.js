// Public read-only data: announcements, the official candidate gallery and published results.
// Everything is rendered with textContent. Nothing here can change a record.
window.QOQPublic = (() => {
  async function post(action, body = {}) {
    const response = await fetch('/api/competition/' + action, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type':'application/json', Accept:'application/json'}, body: JSON.stringify(body)
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
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };
  const number = value => new Intl.NumberFormat('en-PH').format(Number(value || 0));
  const peso = centavos => new Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP', maximumFractionDigits: Number(centavos) % 100 ? 2 : 0}).format(Number(centavos || 0) / 100);
  const when = value => new Intl.DateTimeFormat('en-PH', {dateStyle:'long', timeStyle:'short', timeZone:'Asia/Manila'}).format(new Date(value));
  const valid = item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim();

  // One candidate card: number, portrait (or a monogram when no cleared portrait exists) and official name.
  function candidateCard(item, pointsPublic) {
    const card = make('article', undefined, 'candidate-card');
    const frame = make('div', undefined, 'candidate-portrait');
    if (typeof item.photoKey === 'string' && item.photoKey) {
      const img = make('img'); img.src = '/api/competition/photo/' + encodeURIComponent(item.photoKey); img.alt = 'Official portrait of ' + item.name; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => { img.remove(); frame.classList.add('no-portrait'); }, {once:true});
      frame.append(img);
    } else frame.classList.add('no-portrait');
    if (item.number != null) frame.append(make('span', String(item.number).padStart(2, '0'), 'candidate-number'));
    const body = make('div', undefined, 'candidate-body');
    if (item.number != null) body.append(make('p', 'CANDIDATE NO. ' + item.number, 'eyebrow'));
    body.append(make('h3', item.name));
    if (typeof item.bio === 'string' && item.bio) body.append(make('p', item.bio, 'candidate-bio'));
    if (pointsPublic && item.points != null) body.append(make('p', number(item.points) + ' points', 'candidate-points'));
    card.append(frame, body);
    return card;
  }

  const notices = document.getElementById('announcements');
  if (notices) {
    post('public.announcements').then(data => {
      const entries = (Array.isArray(data.announcements) ? data.announcements : []).filter(entry => typeof entry?.title === 'string' && typeof entry?.body === 'string');
      if (!entries.length) return;
      const fragment = document.createDocumentFragment();
      fragment.append(make('h2', 'Announcements'));
      for (const entry of entries) { const article = make('article'); article.append(make('h3', entry.title), make('p', entry.body)); fragment.append(article); }
      notices.replaceChildren(fragment);
      notices.hidden = false;
    }).catch(() => { notices.hidden = true; });
  }

  const gallery = document.getElementById('candidate-gallery');
  if (gallery) {
    post('public.catalog').then(data => {
      const entries = (Array.isArray(data.candidates) ? data.candidates : []).filter(valid);
      if (!entries.length) return;
      gallery.replaceChildren(...entries.map(item => candidateCard(item, data.pointsPublic === true)));
      document.getElementById('gallery-empty').hidden = true;
      document.getElementById('gallery-vote').hidden = false;
    }).catch(() => {});
  }

  const placements = document.getElementById('placements');
  if (placements) {
    post('public.results').then(data => {
      if (data.published !== true || !Array.isArray(data.placements) || !data.placements.length) return;
      const title = rank => rank === 1 ? 'Queen of Quiapo 2027' : rank === 2 ? '1st Runner-up' : rank === 3 ? '2nd Runner-up' : (rank - 1) + 'th Runner-up';
      for (const entry of data.placements) {
        const item = make('li', undefined, entry.rank === 1 ? 'winner' : '');
        item.append(make('p', (entry.tied ? 'TIED · ' : '') + 'PLACE ' + entry.rank, 'eyebrow'), make('h2', entry.name));
        item.append(make('p', (entry.number != null ? 'Candidate No. ' + entry.number : '') + (entry.score != null ? ' · ' + Number(entry.score).toFixed(2) : ''), 'placement-detail'));
        placements.append(item);
      }
      placements.hidden = false;
      document.getElementById('results-empty').hidden = true;
      document.getElementById('results-status').textContent = 'Official results of ' + (data.edition || 'Queen of Quiapo 2027') + ', certified by the organizers.';
      const meta = document.getElementById('results-meta');
      meta.textContent = 'Certified ' + when(data.certifiedAt) + ' · published ' + when(data.publishedAt) + ' (Philippine time). Placements are by the judges’ scores.';
      meta.hidden = false;
    }).catch(() => {});
  }
  return {post, make, number, peso, when, valid, candidateCard};
})();
