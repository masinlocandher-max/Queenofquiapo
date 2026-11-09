(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const make = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let data, busy = false;
  const forms = {
    candidate: el('candidate-form'), judge: el('judge-form'),
    criterion: el('criterion-form'), announcement: el('announcement-form')
  };
  const labels = {candidate:'candidate', judge:'judge', criterion:'criterion', announcement:'announcement'};
  const announce = (message, error = false) => {
    el('ops-message').textContent = message;
    el('ops-message').classList.toggle('error', error);
  };
  function tab() {
    const inbox = location.hash === '#applications';
    el('applications').hidden = !inbox;
    el('competition').hidden = inbox;
    for (const link of document.querySelectorAll('.desk-tabs a')) {
      const active = link.hash === (inbox ? '#applications' : '#competition');
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  async function readResponse(response) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      el('dashboard').hidden = true;
      el('ops-recovery').hidden = false;
      el('ops-signin').hidden = response.status !== 401;
      throw Error(response.status === 401 ? 'Sign in with the organizer account to open the event desk.' : 'This account does not have organizer access.');
    }
    if (!response.ok || !body || body.error) {
      if (response.status === 503) throw Error('Event management is temporarily unavailable. Please try again.');
      throw Error(typeof body?.error === 'string' ? body.error : 'This change could not be confirmed. Refresh the desk and try again.');
    }
    return body;
  }
  async function api(action, payload = {}) {
    const response = await fetch('/api/competition/organizer.' + action, {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify(payload)
    });
    return readResponse(response);
  }
  async function dashboard(text) {
    const fresh = await api('dashboard');
    if (!fresh.round || !Array.isArray(fresh.candidates) || !fresh.tabulation || !Array.isArray(fresh.criteria) || !Array.isArray(fresh.judges) || !Array.isArray(fresh.announcements)) {
      throw Error('The event desk could not load the current round. Please try again.');
    }
    data = fresh; render(); el('dashboard').hidden = false; el('ops-recovery').hidden = true;
    announce(text || 'Private organizer controls.');
  }
  async function perform(operation) {
    if (busy) return;
    busy = true;
    try { await operation(); }
    catch (error) {
      announce(error instanceof TypeError ? 'The connection was interrupted. Refresh the desk before retrying.' : error.message,true);
      el('ops-recovery').hidden = false;
      el('ops-message').scrollIntoView({block:'nearest'});
    } finally { busy = false; }
  }
  function rowButton(label, action, name) {
    const button = make('button',label);button.type='button';button.className='text-button';
    button.setAttribute('aria-label',label+' '+name);button.addEventListener('click',action);
    return button;
  }
  function clearForm(kind) {
    const form=forms[kind]; form.reset(); delete form.dataset.id; delete form.dataset.photo;
    const editor=el(kind+'-editor'); editor.open=false;
    editor.querySelector('summary').textContent=kind==='announcement'?'Write an announcement':'Add a '+labels[kind];
    const note=form.querySelector('[data-edit-note]'); if (note) note.hidden=true;
  }
  function edit(kind, record) {
    const form=forms[kind];clearForm(kind);form.dataset.id=record.id;
    if (record.photoKey) form.dataset.photo=record.photoKey;
    for (const name of ['name','email','weight','title','body','published']) {
      const control=form.elements.namedItem(name);
      if (control && record[name] !== undefined) {if(control.type==='checkbox') control.checked=record[name]; else control.value=record[name];}
    }
    const note=form.querySelector('[data-edit-note]');
    if (note && record.photoKey) {note.textContent='Leave the photo field empty to keep the current portrait.';note.hidden=false;}
    const editor=el(kind+'-editor');editor.querySelector('summary').textContent='Edit '+labels[kind];editor.open=true;form.querySelector('input, textarea').focus();
  }
  function remove(kind,record) {
    if (!window.confirm('Remove '+record.name+' from this round?')) return;
    perform(async()=>{await api('remove',{kind,id:record.id});clearForm(kind);await dashboard('Removed '+record.name+'.');});
  }
  function list(kind, target, records, editable, subtitle) {
    const list=el(target);list.replaceChildren();
    if (!records.length) {const p=make('p',kind==='announcement'?'No announcements yet.':'No entries yet.');p.className='empty';list.append(p);return;}
    for(const record of records){
      const row=make('div'); row.className='list-row';
      if(kind==='candidate' && record.photoKey) {
        const img=make('img');img.alt='';img.loading='lazy';img.src='/api/competition/photo/'+encodeURIComponent(record.photoKey);row.append(img);
      }
      const info=make('div');info.className='row-info';info.append(make('strong',record.name||record.title),make('small',subtitle(record)));row.append(info);
      if(editable) {
        const actions=make('div');actions.className='row-buttons';
        actions.append(rowButton('Edit',()=>edit(kind,record),record.name||record.title));
        if(kind!=='announcement') actions.append(rowButton('Remove',()=>remove(kind,record),record.name));
        row.append(actions);
      }
      list.append(row);
    }
  }
  function table(headers, rows, caption) {
    const element=make('table');element.className='tally-table';
    if(caption)element.append(make('caption',caption));
    const head=element.createTHead().insertRow();
    for (const label of headers) {const cell=make('th',label);cell.scope='col';head.append(cell);}
    const body=element.createTBody();
    for (const columns of rows) {const row=body.insertRow();for(const value of columns)row.insertCell().textContent=value;}
    return element;
  }
  function render() {
    const {round,candidates,judges,criteria,announcements,tabulation}=data;
    const isSetup=round.phase==='setup', rosterEditable=isSetup && round.voting==='closed';
    const weight=criteria.reduce((sum,c)=>sum+Number(c.weight),0);
    const total=Number(tabulation.total), pending=Number(tabulation.pending);
    el('phase').textContent=({setup:'Set-up',scoring:'In progress',locked:'Final'})[round.phase]||'Unavailable';
    el('candidate-count').textContent=candidates.length;el('locked-count').textContent=(total-pending)+' / '+total;
    el('weight-total').textContent='Total weight: '+Number(weight.toFixed(2))+'%. Weights must add up to 100% to open judging.';
    el('candidate-editor').hidden=!rosterEditable;el('judge-editor').hidden=el('criterion-editor').hidden=!isSetup;
    list('candidate','candidates-list',candidates,rosterEditable,r=>r.photoKey?'Portrait attached':'No portrait');
    list('judge','judges-list',judges,isSetup,r=>r.email+' · '+(r.locked?'Ballot locked':'Awaiting locked ballot'));
    list('criterion','criteria-list',criteria,isSetup,r=>r.weight+'%');
    list('announcement','announcements-list',announcements,true,r=>r.published?'Published':'Draft');
    const countLocked=total-pending;
    const scores=Array.isArray(tabulation.results)?tabulation.results:[];
    el('tabulation-summary').textContent=tabulation.final?'Final tabulation is locked.':
      countLocked>0 ? 'Provisional results from '+countLocked+' locked ballot'+(countLocked===1?'':'s')+'. '+pending+' still outstanding.':
      'Combined scores appear here after judges lock their ballots.';
    const result=el('tally-results');result.replaceChildren();
    if(scores.length && countLocked>0) result.append(table(['Candidate','Weighted score'],scores.map(s=>[s.name,Number(s.score).toFixed(2)])));
    const audit=el('ballot-details');audit.replaceChildren();
    const cMap=new Map(candidates.map(c=>[c.id,c.name])), kMap=new Map(criteria.map(c=>[c.id,c.name]));
    for(const ballot of (tabulation.ballots||[])){
      const d=make('details');d.className='ballot-audit';
      d.append(make('summary',ballot.judgeName+' · locked scores'),table(['Candidate','Criterion','Score'],(ballot.scores||[]).map(s=>[cMap.get(s.candidateId)||'Candidate',kMap.get(s.criterionId)||'Criterion',s.score])));
      audit.append(d);
    }
    const ready=candidates.length>0 && judges.length>0 && criteria.length>0 && Math.abs(weight-100)<.00001;
    el('open-scoring').hidden=!isSetup;el('open-scoring').disabled=!ready;
    el('lock-tally').hidden=round.phase!=='scoring';el('lock-tally').disabled=pending!==0 || total<1;
    el('scoring-hint').textContent=isSetup?(ready?'Opening judging freezes the roster, judges and criteria for this round.':'Add the roster, at least one judge, and criteria totaling 100% before opening.'):round.phase==='scoring'?'Final locking requires a submitted ballot from every judge.':'';
    el('voting-status').textContent=round.voting==='open'?'Public voting is open. Votes are counted separately from judging.':round.voting==='ended'?'Public voting has ended.':'Public voting is closed. Open it only when the approved candidates and voting period are ready.';
    el('open-voting').hidden=round.voting!=='closed';el('open-voting').disabled=candidates.length===0;el('close-voting').hidden=round.voting!=='open';
  }
  async function upload(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP portrait up to 5 MB.');
    const body=new FormData();body.set('photo',file);
    const response=await fetch('/api/competition/candidate-photo',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},body});
    const res=await readResponse(response);if(!res.photoKey)throw Error('The portrait upload was not confirmed.');return res.photoKey;
  }
  for(const [kind,form] of Object.entries(forms)) {
    form.querySelector('[data-cancel]').addEventListener('click',()=>clearForm(kind));
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const btn=form.querySelector('button[type=submit]');
      perform(async()=>{
        btn.disabled=true;const previous=btn.textContent;btn.textContent='Saving…';
        try{
          const values=new FormData(form), payload={};
          if(form.dataset.id)payload.id=form.dataset.id;
          if(kind==='announcement') {
            payload.title=values.get('title').trim();payload.body=values.get('body').trim();payload.published=values.has('published');
            if(payload.published&&!window.confirm('Publish this announcement on the event website?'))return;
          } else {
            payload.name=values.get('name').trim();
            if(kind==='judge')payload.email=values.get('email').trim();
            if(kind==='criterion')payload.weight=Number(values.get('weight'));
            if(kind==='candidate'){
              const file=values.get('photo');
              if(file?.size)payload.photoKey=await upload(file);
              else if(form.dataset.photo)payload.photoKey=form.dataset.photo;
            }
          }
          await api(kind,payload);clearForm(kind);await dashboard('Saved '+labels[kind]+'.');
        }finally{btn.disabled=false;btn.textContent=previous;}
      });
    });
  }
  for (const [id,action,prompt,done] of [
    ['open-scoring','openScoring','Open judging now? Candidate, judge and criterion changes will be locked for this round.','Judging is open.'],
    ['lock-tally','lockTabulation','Permanently lock the final tabulation using the submitted judge ballots?','Final tabulation is locked.'],
    ['open-voting','openVoting','Open voting to visitors now? This freezes the current candidate roster.','Public voting is open.'],
    ['close-voting','closeVoting','End public voting for this round?','Public voting has ended.']
  ])el(id).addEventListener('click',()=>{if(window.confirm(prompt))perform(async()=>{await api(action);await dashboard(done);});});
  el('refresh').addEventListener('click',()=>perform(()=>dashboard('Scores refreshed.')));
  el('ops-retry').addEventListener('click',()=>perform(()=>dashboard()));
  window.addEventListener('hashchange',tab);tab();perform(()=>dashboard());
})();
