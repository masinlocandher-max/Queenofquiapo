(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const status=(message,error=false)=>{el('judge-status').textContent=message;el('judge-status').classList.toggle('error',error);};
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  let current=null,busy=false,dirty=false,inputs=[];
  async function api(action,body={}) {
    const response=await fetch('/api/competition/judge.'+action,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
    const answer=await response.json().catch(()=>null);
    if(response.status===401||response.status===403){
      el('ballot').hidden=true;el('judge-recovery').hidden=false;el('judge-signin').hidden=response.status!==401;
      throw Error(response.status===401?'Sign in with the email registered for judging.':'This account has not been assigned a judge ballot.');
    }
    if(!response.ok||!answer||answer.error){
      if(response.status===503)throw Error('Your scorecard is temporarily unavailable. Please try again.');
      throw Error(typeof answer?.error==='string'?answer.error:'The server could not confirm the change. Check your connection and retry.');
    }
    return answer;
  }
  function updateProgress() {
    const count=inputs.filter(item=>item.field.value!==''&&item.field.validity.valid).length;
    el('score-count').textContent=count+' / '+inputs.length;
    el('lock').disabled=busy||count!==inputs.length||!inputs.length;
    el('save').disabled=busy||!dirty;
  }
  function render() {
    const {phase,locked,candidates,criteria,scores}=current;
    const editable=phase==='scoring'&&!locked;
    const host=el('score-fields');host.replaceChildren();inputs=[];dirty=false;
    el('ballot-state').textContent=locked?'Locked':phase==='setup'?'Upcoming':editable?'Draft':'Closed';
    el('ballot-help').textContent=locked?'Your ballot was locked'+(current.lockedAt?' on '+new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(current.lockedAt))+' (Philippine time)':'')+'. Your submitted scores are shown below and can no longer be changed.':phase==='setup'?'Your scorecard will be available when judging opens.':editable?'Score each criterion from 0 to 100. A draft can be saved before all scores are entered.':'Judging is closed.';
    const records=new Map(scores.map(s=>[s.candidateId+'/'+s.criterionId,s.score]));
    if(phase!=='setup')for(const c of candidates){
      const card=make('section');card.className='card';const title=make('div');title.className='candidate-title';
      if(c.photoKey){const image=make('img');image.alt='';image.src='/api/competition/photo/'+encodeURIComponent(c.photoKey);image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});title.append(image);}
      title.append(make('h2',(c.number!=null?'No. '+c.number+' · ':'')+c.name));card.append(title);
      const grid=make('div');grid.className='scoresheet';card.append(grid);
      for(const criterion of criteria){
        const label=make('label');label.append(document.createTextNode(criterion.name+' '),make('small',criterion.weight+'%'+(criterion.description?' · '+criterion.description:'')));
        const field=make('input');field.type='number';field.inputMode='decimal';field.min='0';field.max='100';field.step='0.01';field.readOnly=!editable;field.setAttribute('aria-label',c.name+', '+criterion.name+' score out of 100');
        const original=records.get(c.id+'/'+criterion.id);
        if(original!==undefined&&original!==null)field.value=String(original);
        field.addEventListener('input',()=>{dirty=true;updateProgress();});
        label.append(field);grid.append(label);inputs.push({candidateId:c.id,criterionId:criterion.id,field,original});
      }
      host.append(card);
    }
    el('ballot-actions').hidden=!editable;el('ballot').hidden=false;el('judge-recovery').hidden=true;updateProgress();
  }
  async function load() {
    const next=await api('ballot');
    if(!next.phase||!Array.isArray(next.candidates)||!Array.isArray(next.criteria)||!Array.isArray(next.scores))throw Error('Your scorecard could not be loaded.');
    current=next;render();
  }
  function values(locking) {
    const out=[];
    for(const item of inputs){
      const f=item.field;
      if(!f.validity.valid){f.reportValidity();throw Error('Each score must be between 0 and 100, with up to two decimal places.');}
      if(f.value===''){
        if(locking || item.original!==undefined && item.original!==null){f.focus();throw Error(locking?'Enter every score before locking.':'Replace the previously saved score with a number between 0 and 100.');}
      }else if(item.original===undefined || item.original===null || Number(f.value)!==Number(item.original)){
        out.push({candidateId:item.candidateId,criterionId:item.criterionId,score:Number(f.value)});
      }
    }
    return out;
  }
  async function act(locking) {
    if(busy||!current||current.locked||current.phase!=='scoring')return;
    let rows;try{rows=values(locking);}catch(e){status(e.message,true);return;}
    if(locking&&!window.confirm('Lock your complete ballot now? Your scores will become final and can no longer be edited.'))return;
    busy=true;updateProgress();inputs.forEach(i=>i.field.readOnly=true);
    try {
      if(rows.length)await api('save',{scores:rows});
      if(locking)await api('lock');
      dirty=false;await load();
      status(locking?'Your ballot has been locked and received. Thank you.':'Draft saved at '+new Intl.DateTimeFormat('en-PH',{timeStyle:'medium',timeZone:'Asia/Manila'}).format(new Date())+'. You can keep editing until you lock your ballot.');
    } catch(e) {
      status(e instanceof TypeError?'The connection was interrupted. Your typed scores are still on this screen. Do not close the page: press Save draft again when you are back online.':e.message,true);
      if(!el('ballot').hidden)inputs.forEach(i=>i.field.readOnly=current.locked||current.phase!=='scoring');
      el('judge-recovery').hidden=false;
    } finally {busy=false;updateProgress();}
  }
  async function refresh() {
    if(busy)return;
    if(dirty&&!window.confirm('Reload your scorecard and discard unsaved changes?'))return;
    busy=true;
    try {await load();status(current.judgeName?'Private scorecard of '+current.judgeName+'.':'Private judge scorecard.');}
    catch(e){status(e instanceof TypeError?'Your scorecard could not connect. Please try again.':e.message,true);el('judge-recovery').hidden=false;}
    finally {busy=false;updateProgress();}
  }
  el('scores').addEventListener('submit',e=>e.preventDefault());
  el('save').addEventListener('click',()=>act(false));el('lock').addEventListener('click',()=>act(true));
  el('retry').addEventListener('click',refresh);
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  refresh();
})();
