// Platform identity headers are supplied by Sites dispatch, never by the JSON form.
function eventIdentity(request,env) {
  const actor=request.headers.get('oai-authenticated-user-id')||'';
  const email=(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
  const organizer=Boolean(actor && email && env.REVIEWER_EMAIL && email===env.REVIEWER_EMAIL.trim().toLowerCase());
  return {actor,email,organizer};
}
function supabaseOrigin(env) {
  const url=new URL(env.QOQ_SUPABASE_URL);
  if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid service origin');
  return url.origin;
}
async function qoqRpc(env,name,parameters) {
  if(!env.QOQ_SUPABASE_URL||!env.QOQ_PUBLISHABLE_KEY||!env.QOQ_SERVER_SECRET) reject(503,'Pageant operations are temporarily unavailable.');
  const result=await fetch(supabaseOrigin(env)+'/rest/v1/rpc/'+name,{redirect:'error',
    method:'POST',headers:{'Content-Type':'application/json',apikey:env.QOQ_PUBLISHABLE_KEY},
    body:JSON.stringify({...parameters,p_secret:env.QOQ_SERVER_SECRET})
  });
  if(!result.ok) {
    const error=await result.json().catch(()=>({}));
    const status=({42501:403,22023:422,23505:409,55000:409,'22P02':422,23514:422})[error.code]||503;
    const allowed=['22023','23505','55000','42501'].includes(error.code);
    reject(status,allowed && typeof error.message==='string' && error.message.length<165 && !/\b(?:relation|constraint|schema|function|sql|query|duplicate key)\b/i.test(error.message) ? error.message : status===503?'The service is temporarily unavailable. Please try again.':'The request could not be completed.');
  }
  return result.json();
}
const ops = (request,env,action,data={}) => {
  const {actor,email,organizer}=eventIdentity(request,env);
  return qoqRpc(env,'qoq_operations',{p_actor:actor,p_email:email,p_organizer:organizer,p_action:action,p_data:data});
};
const publicActions=new Set(['public.voting','public.announcements']);
const orgActions=new Set(['organizer.dashboard','organizer.candidate','organizer.judge','organizer.criterion','organizer.announcement','organizer.remove','organizer.openScoring','organizer.lockTabulation','organizer.openVoting','organizer.closeVoting']);
const judgeActions=new Set(['judge.ballot','judge.save','judge.lock']);
async function smallJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))reject(415,'Use JSON for this request.');
  if(Number(request.headers.get('content-length'))>350000)reject(413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)reject(400,'Missing request.');
  let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>350000){await reader.cancel();reject(413,'Request is too large.');}chunks.push(value);}
  const blob=new Blob(chunks);let data;try{data=JSON.parse(await blob.text());}catch{reject(400,'Invalid request.');}
  if(!data||Array.isArray(data)||typeof data!=='object')reject(422,'Invalid request.');
  return data;
}
function domainArea(host){
  switch(host){
    case 'org.queenofquiapo.com':return 'org';
    case 'judge.queenofquiapo.com':return 'judge';
    case 'vote.queenofquiapo.com':return 'vote';
    case 'queenofquiapo.com':case 'www.queenofquiapo.com':return 'public';
    case 'queen-of-quiapo.fbautisat23.chatgpt.site':case 'localhost':case '127.0.0.1':case 'terminal.local':return 'preview';
    default:return 'unknown';
  }
}
async function edgeLimit(request,env,group,max,windowSeconds) {
  const {actor}=eventIdentity(request,env);
  const ip=request.headers.get('cf-connecting-ip');
  const visitor=actor||ip;
  if(!visitor)return; // service verification calls may have neither
  if(!env.DB||!env.QOQ_RATE_SALT)reject(503,'Please try again shortly.');
  const key=await digest(encode.encode(env.QOQ_RATE_SALT+'|'+group+'|'+visitor));
  const starts=Math.floor(Date.now()/1000/windowSeconds)*windowSeconds;
  const reset=starts+windowSeconds;
  const row=await env.DB.prepare('INSERT INTO qoq_throttle (id,expires_at,hits) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN qoq_throttle.expires_at=excluded.expires_at THEN qoq_throttle.hits+1 ELSE 1 END, expires_at=excluded.expires_at RETURNING hits').bind(key,reset).first();
  if(!row||row.hits>max)reject(429,'Too many attempts. Please try again later.');
  if(Math.random()<.02)await env.DB.prepare('DELETE FROM qoq_throttle WHERE id IN (SELECT id FROM qoq_throttle WHERE expires_at < ? LIMIT 100)').bind(starts-86400).run();
}
async function competition(request,env,path) {
  const action=path.slice('/api/competition/'.length),area=domainArea(new URL(request.url).hostname);
  const {actor,email,organizer}=eventIdentity(request,env);
  if(action.startsWith('photo/')) {
    if(request.method!=='GET')reject(405,'Method not allowed.');
    const key=action.slice(6);if(!UUID.test(key))reject(404,'Photograph unavailable.');
    if(organizer && ['org','preview'].includes(area)) { /* Organizer may preview new uploads before assigning. */ }
    else if(actor && ['judge','preview'].includes(area)) {
      let assigned=false;try{const ballot=await ops(request,env,'judge.ballot');assigned=ballot.candidates.some(c=>c.photoKey===key);}catch(e){if(!(e instanceof IntakeError)||e.status!==403)throw e;}
      if(!assigned)await ops(request,env,'public.photo',{photoKey:key});
    } else { await ops(request,env,'public.photo',{photoKey:key}); }
    const file=await mediaStore(env).get('candidate-publicity/'+key);
    if(!file)reject(404,'Photograph unavailable.');
    return new Response(file.body,{headers:{...SAFE_RESPONSE,'Content-Type':file.contentType||'application/octet-stream','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  if(request.method!=='POST')reject(405,'Method not allowed.');
  requireSameOrigin(request);
  if(action==='candidate-photo'||orgActions.has(action)){
    if(!['org','preview'].includes(area))reject(404,'Not found.');
    requireReviewer(request,env);
    if(action==='candidate-photo'){
      const form=await readMultipart(request), file=await photo(form,'photo'), key=crypto.randomUUID();
      await mediaStore(env).put('candidate-publicity/'+key,file.bytes,{httpMetadata:{contentType:file.type}});
      return json({photoKey:key},201);
    }
  } else if(judgeActions.has(action)){
    if(!['judge','preview'].includes(area))reject(404,'Not found.');
    if(!actor||!email)reject(401,'Sign in to your assigned judging account.');
    if(action==='judge.save'||action==='judge.lock')await edgeLimit(request,env,'ballot',120,60);
  } else if(action==='voter.cast') {
    if(!['preview','public','vote'].includes(area))reject(404,'Not found.');
    if(!actor||!email)reject(401,'Sign in to vote.');
    await edgeLimit(request,env,'vote',8,60);
  } else if(!publicActions.has(action))reject(404,'Not found.');
  const data=await smallJson(request);
  if(env.QOQ_INTAKE_BACKEND==='legacy'&&!env.QOQ_SUPABASE_URL){
    if(action==='public.voting')return json({voting:'closed',candidates:[]});
    if(action==='public.announcements')return json({announcements:[]});
    if(action==='voter.cast')reject(409,'Voting is not open.');
  }
  return json(await ops(request,env,action,data));
}
