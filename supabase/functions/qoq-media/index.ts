const bucket = "qoq-private-media";
const limit = 5 * 1024 * 1024;
const formats = ["image/jpeg", "image/png", "image/webp"];
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const keyPattern = new RegExp("^(?:candidate-applications/"+uuid+"/(?:portrait|swimsuit)|candidate-publicity/"+uuid+")$", "i");
const json = (data: unknown, status = 200) => Response.json(data, {status, headers:{"Cache-Control":"no-store"}});
async function boundedBody(req: Request, max: number) {
  if (Number(req.headers.get("Content-Length")) > max) return null;
  const reader=req.body?.getReader();
  if(!reader)return null;
  const parts: Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>max){await reader.cancel().catch(()=>{});return null;}parts.push(value);}
  if(!size)return null;
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}

Deno.serve(async(req: Request) => {
  const secret=req.headers.get("x-qoq-secret")??"";
  if(secret.length<32||secret.length>512)return json({error:"Forbidden"},403);
  const base=Deno.env.get("SUPABASE_URL"), role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!base||!role)return json({error:"Storage unavailable"},503);
  const credentials={"Authorization":"Bearer "+role,"apikey":role};
  const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,headers:{...credentials,...(init.headers||{})},redirect:"error"});
  try{
    const check=await request("/rest/v1/rpc/qoq_media_authorized",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({p_secret:secret})});
    if(!check.ok)return json({error:"Authorization unavailable"},503);
    if((await check.json())!==true)return json({error:"Forbidden"},403);
    const path=new URL(req.url).pathname.split("/qoq-media").pop() || "/";
    const store="/storage/v1";
    if(req.method==="POST"&&path==="/bootstrap"){
      const read=async()=>request(store+"/bucket/"+bucket);
      let existing=await read();
      if(!existing.ok){
        const created=await request(store+"/bucket",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:limit,allowed_mime_types:formats})});
        if(!created.ok && created.status!==409){
          existing=await read();
          if(!existing.ok)return json({error:"Bucket creation failed"},503);
        } else existing=await read();
      }
      if(!existing.ok)return json({error:"Bucket verification failed"},503);
      const config=await existing.json();
      if(config.name!==bucket || config.public!==false || Number(config.file_size_limit)!==limit || !Array.isArray(config.allowed_mime_types) || config.allowed_mime_types.length!==formats.length || !formats.every(x=>config.allowed_mime_types.includes(x)))return json({error:"Bucket configuration must be private and restricted to screening images"},409);
      return json({ok:true});
    }
    if(req.method==="POST"&&path==="/remove"){
      const bytes=await boundedBody(req,2048);if(!bytes)return json({error:"Invalid request"},400);
      let keys;try{keys=JSON.parse(new TextDecoder().decode(bytes)).keys;}catch{return json({error:"Invalid request"},400);}
      if(!Array.isArray(keys)||keys.length<1||keys.length>2||!keys.every(k=>typeof k==="string"&&keyPattern.test(k)))return json({error:"Invalid keys"},400);
      const result=await request(store+"/object/"+bucket,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({prefixes:keys})});
      return result.ok?json({ok:true}):json({error:"Could not remove photos"},503);
    }
    if(!path.startsWith("/object/"))return json({error:"Not found"},404);
    const key=path.slice(8);
    if(!keyPattern.test(key))return json({error:"Invalid media key"},400);
    if(req.method==="POST"){
      const type=req.headers.get("Content-Type")||"";
      if(!formats.includes(type))return json({error:"Unsupported file type"},415);
      const bytes=await boundedBody(req,limit);
      if(!bytes)return json({error:"Invalid file size"},413);
      const uploaded=await request(store+"/object/"+bucket+"/"+key,{method:"POST",headers:{"Content-Type":type,"x-upsert":"false","Cache-Control":"0"},body:bytes});
      return uploaded.ok?json({ok:true},201):json({error:"Could not save photo"},503);
    }
    if(req.method==="GET"){
      const photo=await request(store+"/object/authenticated/"+bucket+"/"+key);
      if(!photo.ok){
        const failure=await photo.json().catch(()=>({}));
        if(photo.status===404||String(failure.statusCode)==="404"||failure.error==="not_found")return json({error:"Not found"},404);
        return json({error:"Could not read photo"},503);
      }
      const type=(photo.headers.get("Content-Type")||"").split(";")[0];
      if(!formats.includes(type))return json({error:"Unexpected file type"},415);
      return new Response(photo.body,{headers:{"Content-Type":type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
    }
    return json({error:"Method not allowed"},405);
  }catch{return json({error:"Storage unavailable"},503);}
});
