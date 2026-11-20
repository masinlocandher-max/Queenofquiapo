function escapeAccessText(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function accessGate(request,area,status) {
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"};
  const where = new URL(request.url).pathname === '/' ? '/' : area === 'org' ? '/organizer/' : '/judge/';
  const label = area === 'org' ? 'Organizer' : 'Judge';
  const title = status === 401 ? label + ' access' : status === 403 ? 'Use your assigned account' : 'Please try again shortly';
  const message = status === 401 ? 'Sign in with the ChatGPT account assigned to you by the event administrator.' : status === 403 ? 'You are signed in, but this account is not assigned to this '+label.toLowerCase()+' area.' : 'We could not check access to this area. Your records have not been displayed.';
  const action = status === 401 ? '<a class="primary" target="_top" href="/signin-with-chatgpt?return_to='+encodeURIComponent(where)+'">Sign in with ChatGPT</a>' : status === 403 ? '<a class="primary" target="_top" href="/signout-with-chatgpt?return_to='+encodeURIComponent(where)+'">Sign out and switch account</a>' : '<a class="primary" href="'+where+'">Try again</a>';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${label} access · Queen of Quiapo</title><link rel="icon" href="/assets/icon.png"><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(135deg,#f8f5f9,#eee6f3);color:#2e203b;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100% - 36px,920px);margin:clamp(30px,9vh,100px) auto}.brand{display:flex;gap:12px;align-items:center;font-size:16px;font-weight:650;letter-spacing:-.02em}.brand img{width:42px;height:42px;border-radius:10px}.brand small{display:block;font-size:10px;letter-spacing:.12em;font-weight:500;color:#725b80}.panel{display:grid;grid-template-columns:1.1fr 1fr;background:#ffffffba;border:1px solid #ded1e6;border-radius:22px;margin:30px 0;overflow:hidden}.intro,.help{padding:clamp(24px,4vw,42px)}.intro{background:#fff9}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:650;color:#735584}h1{font:500 clamp(32px,5vw,43px)/1.1 Georgia,serif;letter-spacing:-.04em;margin:17px 0}p{color:#685771;font-size:14px}.primary{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border-radius:10px;background:#49305f;color:white;text-decoration:none;font-size:14px;font-weight:600;margin:14px 0}.primary:hover{background:#352044}a:focus-visible{outline:3px solid #9569ae;outline-offset:4px}.help{border-left:1px solid #e5dbe9}.help h2{font-size:16px;margin:0 0 12px}.help ol{margin:0;padding-left:22px;color:#665270;font-size:14px}.help li+li{margin-top:15px}.help p{border-top:1px solid #e5dbe9;padding-top:18px;margin-top:23px;font-size:12px}.foot{display:flex;flex-wrap:wrap;gap:15px;justify-content:space-between;font-size:12px;color:#6e597a}.foot a{color:#503260;display:inline-flex;align-items:center;min-height:44px}a{overflow-wrap:anywhere}@media(max-width:620px){.panel{grid-template-columns:1fr}.help{border-left:0;border-top:1px solid #e5dbe9}.primary{width:100%}.intro,.help{padding:26px}.foot{gap:0}main{margin-block:28px}}
  </style></head><body><main><div class="brand"><img src="/assets/icon.png" alt=""><span>Queen of Quiapo<small>FAITH · TRADITION · GRACE</small></span></div><section class="panel"><div class="intro"><div class="eyebrow">2027 · Private ${label.toLowerCase()} workspace</div><h1>${title}</h1><p>${message}</p>${action}</div><aside class="help"><h2>Before you continue</h2><ol><li>Use the account whose email was assigned to this event.</li><li>After signing in, you will return here. Access is checked before any private information is shown.</li><li>If access is still unavailable, ask the event administrator to verify your assigned email.</li></ol><p>Applicants do not need an organizer account. Use the public application form to join screening.</p></aside></section><nav class="foot" aria-label="Public website"><a href="https://queenofquiapo.com/">Back to the pageant website</a><a href="https://queenofquiapo.com/apply/">Candidate application</a><a href="https://queenofquiapo.com/privacy/">Privacy Notice</a></nav></main></body></html>`,{status,headers});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),area=domainArea(url.hostname),path=url.pathname;
    const common={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
    if(area!=='preview')common['Strict-Transport-Security']='max-age=31536000';
    const hidden=()=>new Response('Not found',{status:404,headers:{...common,'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
    if(area==='unknown')return hidden();
    if(path.startsWith('/api/')){
      try{
        if(path.startsWith('/api/competition/'))return await competition(request,env,path);
        if(path.startsWith('/api/payments/'))return ['preview','public','vote'].includes(area)?await paymentWebhook(request,env,path,area):hidden();
        if(path.startsWith('/api/reviewer/')&&!['preview','org'].includes(area))return hidden();
        if(path.startsWith('/api/applications')&&!['preview','public'].includes(area))return hidden();
        if(path==='/api/applications'&&request.method==='POST')await edgeLimit(request,env,'intake',20,600);
        return await handleApi(request,env);
      }catch(e){return json({error:e instanceof IntakeError?e.message:'The service is temporarily unavailable. Please try again.'},e instanceof IntakeError?e.status:503);}
    }
    if(!['HEAD','GET'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...common,Allow:'GET, HEAD'}});
    let route=path;
    if(path==='/'&&area==='org')route='/organizer/';
    if(path==='/'&&area==='judge')route='/judge/';
    if(path==='/'&&area==='vote')route='/vote/';
    const sharedJudgeCSS=route==='/organizer/workspace.css'&&['judge','preview'].includes(area); // a stylesheet, not a record
    const section=route==='/organizer'||route.startsWith('/organizer/')?'org':route==='/judge'||route.startsWith('/judge/')?'judge':null;
    if(section && !sharedJudgeCSS) {
      if(![section,'preview'].includes(area))return hidden();
      const {actor,email,organizer}=eventIdentity(request,env);
      if(!actor||!email)return accessGate(request,section,401);
      if(section==='org'&&!organizer)return accessGate(request,section,403);
      if(section==='judge') {
        try { await ops(request,env,'judge.ballot'); }
        catch(e){return accessGate(request,section,e.status===403?403:503);}
      }
    }
    // Private hostnames never serve the general site or each other's private shell.
    if((area==='org'||area==='judge')&&!section&&!/^\/(assets\/|style\.css$|pearl\.css$|subpages\.css$|script\.js$)/.test(route))return hidden();
    const key=route.endsWith('/')?route+'index.html':route;
    if(!Object.hasOwn(pageAssets,key)){
      if(Object.hasOwn(pageAssets,route+'/index.html')){url.pathname+='/';return Response.redirect(url,308);}
      return hidden();
    }
    const [type,value,text]=pageAssets[key];
    const headers={...common,'Content-Type':type,'Cache-Control':route.startsWith('/assets/')?'public, max-age=86400':'private, no-store'};
    if(section||area==='org'||area==='judge')headers['X-Robots-Tag']='noindex, nofollow';
    if(type.startsWith('text/html')){
      // Every page loads only same-origin scripts. Enforce once sign-in is confirmed to work under the policy (QOQ_CSP=enforce).
      headers[env.QOQ_CSP==='enforce'?'Content-Security-Policy':'Content-Security-Policy-Report-Only']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
      headers['Permissions-Policy']='camera=(), microphone=(), geolocation=(), payment=()';
    }
    if(type.startsWith('text/calendar'))headers['Content-Disposition']='attachment; filename="'+key.split('/').pop()+'"';
    let body=request.method==='HEAD'?null:text?value:Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    if(body && type.startsWith('text/html') && section==='org') {
      const {email} = eventIdentity(request,env);
      body=body.replace('<!-- organizer-session -->','<span class="session-email">Signed in as '+escapeAccessText(email)+'</span>');
    }
    if(body && type.startsWith('text/html') && area==='vote'){
      body=body.replace(/href="\/(|about\/|schedule\/|apply\/|privacy\/|terms\/|results\/)"/g,(_,suffix)=>'href="https://queenofquiapo.com/'+suffix+'"');
    }
    if(body && type.startsWith('text/html') && area==='public' && env.QOQ_VOTE_DOMAIN_READY==='yes'){
      body=body.replaceAll('href="/vote/"','href="https://vote.queenofquiapo.com/"');
    }
    return new Response(body,{headers});
  }
};
