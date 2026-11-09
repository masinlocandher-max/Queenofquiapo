(() => {
  const el = id => document.getElementById(id);
  const endpoint = '/api/reviewer/applications';
  let cursor = null, selected = null;
  const status = text => { el('status').textContent = text; };
  const formatTime = value => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle:'short', timeZone:'Asia/Manila' }).format(new Date(value));
  async function request(url, options) {
    const response = await fetch(url, { cache:'no-store', ...options });
    if (response.status === 401 || response.status === 403) {
      el('inbox').hidden = el('detail').hidden = true;
      el('signin').hidden = response.status !== 401;
      throw Error(response.status === 401 ? 'Sign in with the organizer account to review submissions.' : 'This account does not have organizer access.');
    }
    if (!response.ok) throw Error('The request could not be completed. Please try again.');
    return response.json();
  }
  async function load(reset=false) {
    if (reset) { cursor = null; el('rows').replaceChildren(); }
    el('more').disabled = true;
    try {
      const data = await request(endpoint + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      el('inbox').hidden = false;
      for (const entry of data.applications) {
        const button=document.createElement('button'); button.type='button'; button.className='entry';
        const name=document.createElement('span'); name.textContent=entry.femaleName;
        const info=document.createElement('small'); info.textContent=entry.locality+' · '+formatTime(entry.submittedAt);
        button.append(name,info);button.addEventListener('click',()=>show(entry.reference));el('rows').append(button);
      }
      cursor = data.nextCursor; el('more').hidden = cursor == null;
      status(el('rows').childElementCount ? 'Select a candidate to review the submitted details and both photos.' : 'No applications have been received yet.');
    } catch (e) {status(e.message);} finally {el('more').disabled=false;}
  }
  async function show(reference) {
    try {
      const {application:entry}=await request(endpoint+'/'+encodeURIComponent(reference));
      selected=reference;el('inbox').hidden=true;el('detail').hidden=false;el('candidate').textContent=entry.femaleName;
      status('Private screening application');el('fields').replaceChildren();
      const data=[['Reference',reference],['Received (PH time)',formatTime(entry.submittedAt)],['Legal name',entry.legalName],['Female name',entry.femaleName],['Email',entry.email],['Mobile number',entry.mobile],['City or municipality',entry.locality],['Height (cm)',entry.heightCm],['Bust (in)',entry.bustIn],['Waist (in)',entry.waistIn],['Hips (in)',entry.hipsIn],['Talent or skill',entry.talent],['Previous pageants',entry.experience],['Why they are joining',entry.motivation]];
      for (const [label,value] of data) {const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'—';row.append(dt,dd);el('fields').append(row);}
      el('pictures').replaceChildren();
      for (const [kind,label] of [['portrait','Close-up portrait'],['swimsuit','Full-body swimsuit photo']]) {
        const f=document.createElement('figure'),im=document.createElement('img'),caption=document.createElement('figcaption');
        const url=endpoint+'/'+encodeURIComponent(reference)+'/'+kind;im.alt=label+' of '+entry.femaleName;im.src=url;
        const a=document.createElement('a'); a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','Open '+label+' at full size');a.append(im);caption.textContent=label;f.append(a,caption);el('pictures').append(f);
      }
      el('candidate').focus();
    } catch (e) {status(e.message);}
  }
  el('back').addEventListener('click',()=>{selected=null;el('detail').hidden=true;el('pictures').replaceChildren();el('inbox').hidden=false;status('Select a candidate to review the submission.');});
  el('more').addEventListener('click',()=>load());
  el('remove').addEventListener('click',async()=>{if(!selected||!window.confirm('Permanently remove this application and both photos?'))return;
    el('remove').disabled=true;
    try{await request(endpoint+'/'+encodeURIComponent(selected),{method:'DELETE'});el('detail').hidden=true;el('pictures').replaceChildren();selected=null;await load(true);}catch(e){status(e.message);}finally{el('remove').disabled=false;}
  });
  load(true);
})();
