function accessGate(request,area,status,env={}) {
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const where=new URL(request.url).pathname;
  const label=area==='org'?'organizer':'judge';
  const back=encodeURIComponent(where);
  // The site's own sign-in comes first; ChatGPT is an optional alternative where the hosting offers it.
  const signin=status===401||status===403?'<p><a href="/access/?return_to='+back+'" style="display:inline-block;padding:.8rem 1.2rem;border-radius:999px;background:#3c2a5c;color:#fff;text-decoration:none">Sign in with your '+(area==='org'?'email and password':'email and access code')+'</a></p>'+
    (env.QOQ_CHATGPT_SIGNIN==='off'?'':'<p style="font-size:15px">or <a target="_top" href="/signin-with-chatgpt?return_to='+back+'">sign in with ChatGPT</a> (optional)</p>'):'';
  const message=status===401?'Sign in with your assigned '+label+' account.':status===503?'This area is temporarily unavailable. Please try again in a minute.':'This account does not have '+label+' access. Sign in with a different account.';
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private access · Queen of Quiapo</title><main style="max-width:32rem;margin:16vh auto;padding:1rem;font:17px/1.55 system-ui;color:#282537"><h1>Private access</h1><p>'+message+'</p>'+signin+'</main>',{status,headers});
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
        const who=await resolveIdentity(request,env);
        // A sign-in that cannot be checked during an outage is reported as an outage, not as "please sign in".
        if(who.unavailable&&!path.startsWith('/api/applications'))return json({error:'The service is temporarily unavailable. Please try again.'},503);
        if(path.startsWith('/api/access/'))return ['org','judge','preview'].includes(area)?await access(request,env,path,area):hidden();
        if(path.startsWith('/api/competition/'))return await competition(request,env,path);
        if(path.startsWith('/api/payments/'))return ['preview','public','vote'].includes(area)?await paymentWebhook(request,env,path,area):hidden();
        if(path.startsWith('/api/reviewer/')&&!['preview','org'].includes(area))return hidden();
        if(path.startsWith('/api/applications')&&!['preview','public'].includes(area))return hidden();
        if(path==='/api/applications'&&request.method==='POST')await edgeLimit(request,env,'intake',60,600);   // Screening Day: many applicants on one venue Wi-Fi
        return await handleApi(request,env);
      }catch(e){return json({error:e instanceof IntakeError?e.message:'The service is temporarily unavailable. Please try again.'},e instanceof IntakeError?e.status:503);}
    }
    if(!['HEAD','GET'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...common,Allow:'GET, HEAD'}});
    let route=path;
    if(path==='/'&&area==='org')route='/organizer/';
    if(path==='/'&&area==='judge')route='/judge/';
    if(path==='/'&&area==='vote')route='/vote/';
    const sharedJudgeCSS=route==='/organizer/workspace.css'; // a stylesheet, not a record: the sign-in page needs it before sign-in
    const section=route==='/organizer'||route.startsWith('/organizer/')?'org':route==='/judge'||route.startsWith('/judge/')?'judge':null;
    if(section && !sharedJudgeCSS) {
      if(![section,'preview'].includes(area))return hidden();
      const who=await resolveIdentity(request,env);
      if(who.unavailable)return accessGate(request,section,503,env);
      if(!who.actor||!who.email)return accessGate(request,section,401,env);
      if(section==='org'&&!who.organizer)return accessGate(request,section,403,env);
      if(section==='judge') {
        if(who.via==='session'&&who.role!=='judge')return accessGate(request,section,403,env);
        try { await ops(request,env,'judge.ballot'); }
        catch(e){return accessGate(request,section,e.status===403?403:503,env);}
      }
    }
    // Private hostnames never serve the general site or each other's private shell.
    // The staff sign-in page exists only on the private hostnames (and the preview host).
    if(route.startsWith('/access/')&&!['org','judge','preview'].includes(area))return hidden();
    if((area==='org'||area==='judge')&&!section&&!sharedJudgeCSS&&!/^\/(assets\/|access\/|style\.css$|pearl\.css$|subpages\.css$|script\.js$)/.test(route))return hidden();
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
    if(body && type.startsWith('text/html') && area==='vote'){
      body=body.replace(/href="\/(|about\/|schedule\/|apply\/|privacy\/|terms\/|results\/)"/g,(_,suffix)=>'href="https://queenofquiapo.com/'+suffix+'"');
    }
    if(body && type.startsWith('text/html') && area==='public' && env.QOQ_VOTE_DOMAIN_READY==='yes'){
      body=body.replaceAll('href="/vote/"','href="https://vote.queenofquiapo.com/"');
    }
    return new Response(body,{headers});
  }
};
