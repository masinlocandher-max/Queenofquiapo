import {readFile,writeFile,cp,mkdir,readdir} from 'node:fs/promises';
import {join,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ics':'text/calendar; charset=utf-8'};
const assets={};
async function collect(dir){
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=join(dir,entry.name);
    if(entry.isDirectory()){await collect(file);continue;}
    const ext=extname(file), type=types[ext];if(!type)throw Error('Unknown static file type: '+ext);
    const text=type.startsWith('text/')||ext==='.svg';
    const url='/'+relative(source,file).split('\\').join('/');
    assets[url]=[type,text?(await readFile(file,'utf8')):(await readFile(file)).toString('base64'),text];
  }
}
await collect(source);
const api=await readFile(join(root,'server/api.mjs'),'utf8');
const helpers=(await Promise.all(['storage','competition'].map(name=>readFile(join(root,'server',name+'.mjs'),'utf8')))).join('\n');
const router=await readFile(join(root,'server/worker.mjs'),'utf8');
if(!api.includes('function handleApi('))throw Error('Missing application API handler');
await mkdir(join(root,'dist/server'),{recursive:true});
await mkdir(join(root,'dist/.openai'),{recursive:true});
await writeFile(join(root,'dist/server/index.js'),api+'\n'+helpers+'\nconst pageAssets='+JSON.stringify(assets)+';\n'+router);
await cp(join(root,'.openai/hosting.json'),join(root,'dist/.openai/hosting.json'));
console.log('Built pageant Worker with '+Object.keys(assets).length+' public assets.');
