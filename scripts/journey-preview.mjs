// Local-only UX rehearsal. This module is never imported by the production build.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const attempts=new Map();
const allowed=new Set(['applicant','applicant-retry','applicant-closed','organizer','organizer-denied','organizer-expired']);
const entry={reference:'QOQ-REHEARSAL0000001',femaleName:'Preview Candidate',legalName:'Synthetic Applicant',email:'applicant@example.invalid',mobile:'',locality:'Preview City',heightCm:168,bustIn:34,waistIn:26,hipsIn:36,talent:'',experience:'',motivation:'',submittedAt:'2026-11-20T08:00:00Z',status:'submitted',history:[],duplicates:[]};
export async function journeyPreview(request, worker) {
  const url=new URL(request.url);
  if (!['localhost','127.0.0.1'].includes(url.hostname)) return null;
  if (url.pathname==='/__preview/journey') {
    const mode=url.searchParams.get('scenario');
    if (!allowed.has(mode)) return new Response('Choose a documented rehearsal scenario.',{status:400});
    return new Response(null,{status:303,headers:{Location:mode.startsWith('organizer')?'/organizer/':'/apply/','Set-Cookie':'qoq_rehearsal='+mode+'; Path=/; SameSite=Strict'}});
  }
  const mode=/\bqoq_rehearsal=([a-z-]+)/.exec(request.headers.get('cookie')||'')?.[1];
  if (!allowed.has(mode)) return null;
  const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (url.pathname.startsWith('/api/')) {
    if (mode==='organizer-expired') return json({error:'Rehearsal session expired'},401);
    if (url.pathname==='/api/competition/public.event') return json({name:'Queen of Quiapo 2027',applicationsOpen:mode!=='applicant-closed'});
    if (url.pathname==='/api/applications' && request.method==='POST') {
      const form=await request.formData(),id=form.get('submissionId'),values=[];
      for(const [key,value] of form.entries()) values.push([key,typeof value==='string'?value:[value.name,value.type,createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex')]]);
      const fingerprint=JSON.stringify(values),old=attempts.get(id);
      if (old && old!==fingerprint) return json({error:'Rehearsal detected a changed retry payload.'},409);
      attempts.set(id,fingerprint);
      if (mode==='applicant-retry'&&!old) return json({error:'Simulated lost acknowledgement'},503);
      return json({reference:'QOQ-REHEARSAL0000001',submittedAt:'2026-11-20T08:00:00Z',edition:'Queen of Quiapo 2027'},old?200:201);
    }
    if (url.pathname.startsWith('/api/applications/') && request.method==='DELETE') return json({ok:true});
    const data=JSON.parse(await readFile(new URL('./journey-fixtures.json',import.meta.url),'utf8'));
    if(url.pathname==='/api/competition/organizer.dashboard') {data.dashboard.applications={total:1,pending:['submitted','under_review','correction_requested','qualified','screened'].includes(entry.status)?1:0,approved:entry.status==='approved'?1:0};return json(data.dashboard)}
    if(url.pathname==='/api/competition/organizer.voting') return json(data.voting);
    if(url.pathname==='/api/competition/organizer.orders') return json(data.orders);
    if(url.pathname==='/api/reviewer/applications') {
      const match=!url.searchParams.get('q') || (entry.femaleName+' '+entry.reference).toLowerCase().includes(url.searchParams.get('q').toLowerCase());
      return json({applications:match?[entry]:[],total:1,counts:{[entry.status]:1},nextCursor:null});
    }
    if(url.pathname==='/api/reviewer/applications/'+entry.reference) return json({application:entry});
    if(url.pathname.endsWith('/status') && request.method==='POST') {const body=await request.json();entry.history.push({kind:'status',from:entry.status,to:body.status,note:body.note,actor:'preview@example.invalid',at:new Date().toISOString()});entry.status=body.status;return json({ok:true})}
    if(url.pathname.endsWith('/note') && request.method==='POST') {const body=await request.json();entry.history.push({kind:'note',note:body.note,actor:'preview@example.invalid',at:new Date().toISOString()});return json({ok:true})}
    if(/\/(portrait|swimsuit)$/.test(url.pathname)) return new Response(await readFile(new URL('../public/assets/icon.png',import.meta.url)),{headers:{'Content-Type':'image/png'}});
    return json({error:'This operation is not part of the local UX rehearsal.'},409);
  }
  const headers=new Headers(request.headers);
  if(mode.startsWith('organizer')) {headers.set('oai-authenticated-user-id','rehearsal-only');headers.set('oai-authenticated-user-email',mode==='organizer-denied'?'unassigned@example.invalid':'preview@example.invalid')}
  const result=await worker.fetch(new Request(request,{headers}),{REVIEWER_EMAIL:'preview@example.invalid'});
  if(!result.headers.get('content-type')?.includes('text/html')) return result;
  const body=(await result.text()).replace('<body','<body').replace(/(<body[^>]*>)/,'$1<div style="padding:10px 20px;background:#432957;color:white;font:600 12px/1.5 system-ui;text-align:center">LOCAL REHEARSAL · Simulated records only · '+mode+'</div>');
  return new Response(body,{status:result.status,headers:result.headers});
}
