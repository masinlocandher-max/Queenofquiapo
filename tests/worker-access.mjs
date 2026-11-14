// Run with: node scripts/build.mjs && node --test tests/worker-access.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/server/index.js';

const main = 'https://queenofquiapo.com';
const org = 'https://org.queenofquiapo.com';
const judge = 'https://judge.queenofquiapo.com';
const vote = 'https://vote.queenofquiapo.com';
const preview = 'https://queen-of-quiapo.fbautisat23.chatgpt.site';
const owner = { 'oai-authenticated-user-id':'owner-id', 'oai-authenticated-user-email':'OWNER@example.invalid' };
const member = { 'oai-authenticated-user-id':'member-id', 'oai-authenticated-user-email':'member@example.invalid' };
const baseEnv = { REVIEWER_EMAIL:'owner@example.invalid', QOQ_SUPABASE_URL:'https://synthetic.supabase.co', QOQ_PUBLISHABLE_KEY:'public-test-key',QOQ_SERVER_SECRET:'test-server-secret' };
function call(host, path, {headers={},method='GET',data}={},env=baseEnv) {
  return worker.fetch(new Request(host+path, {method,headers:{origin:host,'content-type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)}),env);
}
const action = (host, name, headers, data={},env) => call(host,'/api/competition/'+name,{method:'POST',headers,data},env);
function limitStore(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0001_throttle.sql',import.meta.url),'utf8'));
  return {prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args)};}};},close:()=>db.close()};
}

test('private pages and applicant records are isolated by host and verified organizer identity',async()=>{
  for (const host of [main,vote]) for (const path of ['/organizer/','/organizer/index.html','/judge/','/api/reviewer/applications']) {
    assert.equal((await call(host,path,{headers:owner})).status,404,host+path);
  }
  for (const host of [org,preview]){
    assert.equal((await call(host,'/organizer/')).status,401);
    assert.equal((await call(host,'/organizer/',{headers:member})).status,403);
    const r=await call(host,'/organizer/',{headers:owner});
    assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(r.headers.get('cache-control'),/no-store/);
  }
  assert.equal((await call(org,'/api/applications',{method:'POST',headers:owner,data:{}})).status,404);
  assert.equal((await call(judge,'/organizer/',{headers:owner})).status,404);
});

test('operation names, identity and server secret cannot be overridden by request data',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({ok:true});});
  const attack={p_actor:'attacker',p_email:'owner@example.invalid',p_secret:'bad',p_organizer:true,p_action:'organizer.dashboard'};
  assert.equal((await action(main,'organizer.dashboard',owner)).status,404);
  assert.equal((await action(vote,'judge.ballot',member)).status,404);
  assert.equal((await action(org,'organizer.dashboard',member,attack)).status,403);
  assert.equal((await action(org,'organizer.judge',{...owner,origin:'https://outside.invalid'},attack)).status,403);
  assert.equal((await action(judge,'public.photo',member,{photoKey:'not-an-id'})).status,404);
  assert.equal((await action(judge,'judge.ballot',{},attack)).status,401);
  assert.equal(calls.length,0);
  assert.equal((await action(judge,'judge.ballot',member,attack)).status,200);
  const body=calls[0].body;
  assert.equal(body.p_actor,'member-id');assert.equal(body.p_email,'member@example.invalid');
  assert.equal(body.p_organizer,false);assert.equal(body.p_action,'judge.ballot');assert.equal(body.p_secret,baseEnv.QOQ_SERVER_SECRET);assert.deepEqual(body.p_data,attack);
});

test('judge pages require assignment and refusals never expose the score workspace',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'42501',message:'Judge assignment required'},{status:403}));
  for (const host of [judge,preview]){
    const path=host===judge?'/':'/judge/';
    assert.equal((await call(host,path)).status,401);
    const denied=await call(host,path,{headers:member});assert.equal(denied.status,403);
    assert.doesNotMatch(await denied.text(),/criteria-list|scorecard-form/);
  }
});

test('checkout is refused before any storage while payments are off, and attempts are rate limited',async t=>{
  const db=limitStore(),env={...baseEnv,DB:db,QOQ_RATE_SALT:'rate-test-salt'};t.after(()=>db.close());
  const upstream=t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true}));t.mock.method(Date,'now',()=>1800000000000);
  const visitor={'cf-connecting-ip':'203.0.113.9'};
  const purchase={candidateId:'9800a230-90d4-4fb0-82b5-83b855757eae',packageId:'9800a230-90d4-4fb0-82b5-83b855757eaf',requestId:'9800a230-90d4-4fb0-82b5-83b855757eb0',email:'fan@example.invalid'};
  assert.equal((await action(org,'order.create',visitor,purchase,env)).status,404);
  assert.equal((await action(vote,'voter.cast',member,{candidateId:'x'},env)).status,404);
  // Each of these alone is not enough to open checkout on a production hostname.
  for(const extra of [{},{QOQ_PAYMENTS_ENABLED:'yes'},{QOQ_PAYMENTS_ENABLED:'yes',QOQ_PAYMENT_PROVIDER:'sandbox',QOQ_PAYMENT_WEBHOOK_SECRET:'s'.repeat(40),QOQ_ALLOW_SANDBOX_PAYMENTS:'yes'},{QOQ_PAYMENTS_ENABLED:'yes',QOQ_PAYMENT_PROVIDER:'unknown',QOQ_PAYMENT_WEBHOOK_SECRET:'s'.repeat(40)}]){
    const r=await action(vote,'order.create',visitor,purchase,{...env,...extra});assert.equal(r.status,409);assert.match((await r.json()).error,/coming soon/i);
  }
  for(let i=0;i<6;i++)assert.equal((await action(main,'order.create',visitor,purchase,env)).status,409);
  assert.equal((await action(main,'order.create',visitor,purchase,env)).status,429);
  assert.equal((await call(vote,'/api/payments/webhook/sandbox',{method:'POST',data:{}},env)).status,404);
  assert.equal(upstream.mock.callCount(),0);
});

test('judge final lock conflict stays a conflict; no score data or secret can leak through database errors',async t=>{
  const db=limitStore(),env={...baseEnv,DB:db,QOQ_RATE_SALT:'rate-test-salt'};t.after(()=>db.close());
  let internal=false;
  t.mock.method(globalThis,'fetch',async()=>Response.json(internal?{code:'99999',message:'secret or database internal text'}:{code:'55000',message:'This ballot is locked'},{status:400}));
  const r=await action(judge,'judge.lock',member,{},env);assert.equal(r.status,409);assert.equal((await r.json()).error,'This ballot is locked');
  internal=true;
  const failed=await action(judge,'judge.save',member,{scores:[]},env);assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/internal text|test-server-secret/);
});

test('an unknown alias fails closed and a non-default port never becomes the privileged preview area',async t=>{
  const upstream=t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true}));
  const alias='https://unassigned.queenofquiapo.com';
  assert.equal((await call(alias,'/organizer/',{headers:owner})).status,404);
  assert.equal((await action(alias,'organizer.dashboard',owner)).status,404);
  assert.equal((await call(alias,'/judge/',{headers:member})).status,404);
  assert.equal((await call(main+':8443','/organizer/',{headers:owner})).status,404);
  assert.equal((await action(main+':8443','organizer.dashboard',owner)).status,404);
  assert.equal(upstream.mock.callCount(),0);
});


test('secrets only go directly to the configured HTTPS Supabase origin for RPC and media',async t=>{
  const photoKey='9800a230-90d4-4fb0-82b5-83b855757eae';
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return url.includes('/rpc/')?Response.json({ok:true}):new Response('photo',{headers:{'Content-Type':'image/webp'}});});
  for(const url of ['http://synthetic.supabase.co','https://synthetic.supabase.co.evil.invalid','https://user:pass@synthetic.supabase.co','https://synthetic.supabase.co:8443','https://synthetic.supabase.co/proxy','https://synthetic.supabase.co/?x']) {
    const env={...baseEnv,QOQ_SUPABASE_URL:url};
    assert.equal((await action(org,'organizer.dashboard',owner,{},env)).status,503,url);
    assert.equal((await call(org,'/api/competition/photo/'+photoKey,{headers:owner},env)).status,503,url);
  }
  assert.equal(calls.length,0);
  assert.equal((await action(org,'organizer.dashboard',owner)).status,200);
  assert.equal((await call(org,'/api/competition/photo/'+photoKey,{headers:owner})).status,200);
  assert.equal(calls.length,2);
  for(const {url,init} of calls){assert.equal(new URL(url).origin,baseEnv.QOQ_SUPABASE_URL);assert.equal(init.redirect,'error');}
});

 test('rehearsal payments are rejected on the live Sites hostname even with every deployment switch enabled', async t=>{
  const upstream=t.mock.method(globalThis,'fetch',async()=>Response.json({paymentsEnabled:true}));
  const env={...baseEnv,QOQ_PAYMENTS_ENABLED:'yes',QOQ_PAYMENT_PROVIDER:'sandbox',QOQ_ALLOW_SANDBOX_PAYMENTS:'yes',QOQ_PAYMENT_WEBHOOK_SECRET:'s'.repeat(40)};
  assert.equal((await action(preview,'order.create',{}, {},env)).status,409);
  assert.equal((await call(preview,'/api/payments/webhook/sandbox',{method:'POST',data:{}},env)).status,404);
  assert.equal(upstream.mock.callCount(),0);
  assert.equal((await (await action(preview,'public.catalog',{}, {},env)).json()).paymentsEnabled,false);
});

test('webhook streams are bounded without trusting Content-Length', async t=>{
  const upstream=t.mock.method(globalThis,'fetch',async()=>Response.json({}));
  const env={...baseEnv,QOQ_PAYMENT_PROVIDER:'sandbox',QOQ_ALLOW_SANDBOX_PAYMENTS:'yes',QOQ_PAYMENT_WEBHOOK_SECRET:'s'.repeat(40)};
  const request=new Request('http://127.0.0.1/api/payments/webhook/sandbox',{method:'POST',body:'x'.repeat(65537)});
  assert.equal((await worker.fetch(request,env)).status,413);
  assert.equal(upstream.mock.callCount(),0);
});
