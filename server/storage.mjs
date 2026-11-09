// Only the Worker can authenticate to the media function. Object paths are scoped on both sides.
function mediaStore(env) {
  if (env.QOQ_INTAKE_BACKEND === 'legacy') {
    const checked = key => {
      if (!/^candidate-applications\/[a-f0-9-]{36}\/(portrait|swimsuit)$/i.test(key)) throw Error('Media service is unavailable');
      return key;
    };
    if (!env.BUCKET) throw Error('Private intake storage is unavailable');
    return {
      put:(key,body,options)=>env.BUCKET.put(checked(key),body,options),
      get:key=>env.BUCKET.get(checked(key)),
      delete:keys=>env.BUCKET.delete((Array.isArray(keys)?keys:[keys]).map(checked))
    };
  }
  const root=env.QOQ_SUPABASE_URL ? supabaseOrigin(env) : null;
  if(!root || !env.QOQ_SERVER_SECRET || !env.QOQ_PUBLISHABLE_KEY)throw Error('Media service is not configured');
  const endpoint=root+'/functions/v1/qoq-media';
  const headers={apikey:env.QOQ_PUBLISHABLE_KEY,'x-qoq-secret':env.QOQ_SERVER_SECRET};
  function objectPath(key) {
    const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    if(!new RegExp('^(?:candidate-applications/'+uuid+'/(?:portrait|swimsuit)|candidate-publicity/'+uuid+')$','i').test(key))throw Error('Invalid media key');
    return '/object/'+key;
  }
  async function send(path,init) {
    const response=await fetch(endpoint+path,{...init,headers:{...headers,...init.headers},redirect:'error'});
    if(!response.ok && !(response.status===404 && init.method==='GET'))throw Error('Private media request failed');
    return response;
  }
  return {
    async put(key,bytes,{httpMetadata}) {
      await send(objectPath(key),{method:'POST',headers:{'Content-Type':httpMetadata.contentType},body:bytes});
    },
    async get(key) {
      const r=await send(objectPath(key),{method:'GET'});
      return r.status===404?null:{body:r.body,contentType:r.headers.get('Content-Type')};
    },
    async delete(keys) {
      const list=Array.isArray(keys)?keys:[keys];list.forEach(objectPath);
      await send('/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:list})});
    }
  };
}
