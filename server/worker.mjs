function accessGate(request,area,status) {
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const where=new URL(request.url).pathname;
  const label=area==='org'?'organizer':'judge';
  const link=status===401?'<p><a target="_top" href="/signin-with-chatgpt?return_to='+encodeURIComponent(where)+'">Sign in to continue</a></p>':'';
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private access · Queen of Quiapo</title><main style="max-width:32rem;margin:16vh auto;padding:1rem;font:17px/1.55 system-ui;color:#282537"><h1>Private access</h1><p>'+(status===401?'Sign in using your assigned '+label+' account.':status===503?'This area is temporarily unavailable.':'This account does not have access.')+'</p>'+link+'</main>',{status,headers});
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
    if(body && type.startsWith('text/html') && area==='vote'){
      body=body.replace(/href="\/(|about\/|schedule\/|apply\/|privacy\/|terms\/|results\/)"/g,(_,suffix)=>'href="https://queenofquiapo.com/'+suffix+'"');
    }
    if(body && type.startsWith('text/html') && area==='public' && env.QOQ_VOTE_DOMAIN_READY==='yes'){
      body=body.replaceAll('href="/vote/"','href="https://vote.queenofquiapo.com/"');
    }
    return new Response(body,{headers});
  }
};
