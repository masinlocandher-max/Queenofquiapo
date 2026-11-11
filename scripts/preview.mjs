import {createServer} from 'node:http';
import {stat} from 'node:fs/promises';

// Render the built Worker locally. No production identity or data bindings.
const entry = new URL('../dist/server/index.js', import.meta.url);
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number((portIndex >= 0 ? args[portIndex + 1] : undefined) || process.env.PORT || 3000);
createServer(async (incoming, outgoing) => {
  try {
    const previewUrl = new URL(incoming.url, 'http://localhost:' + port);
    if (previewUrl.pathname === '/__preview/responsive') {
      const pages = ['/', '/about/', '/schedule/', '/apply/', '/vote/'];
      const page = pages.includes(previewUrl.searchParams.get('page')) ? previewUrl.searchParams.get('page') : '/';
      const width = [320, 390, 768].includes(Number(previewUrl.searchParams.get('width'))) ? Number(previewUrl.searchParams.get('width')) : 390;
      outgoing.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      outgoing.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Responsive preview</title><style>body{margin:0;padding:24px;background:#d8d4dc;font:14px system-ui}iframe{display:block;margin:20px auto;border:0;width:'+width+'px;height:844px;background:white}p{text-align:center}</style><p>'+width+' px responsive preview</p><iframe title="Queen of Quiapo mobile" src="'+page+'"></iframe>');
      return;
    }
    const {mtimeMs} = await stat(entry);
    const {default: worker} = await import(entry.href + '?v=' + mtimeMs);
    const method = incoming.method || 'GET';
    const body = [];
    for await (const chunk of incoming) body.push(chunk);
    const request = new Request(new URL(incoming.url, 'http://localhost:' + port), {
      method, headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(method) ? {body: Buffer.concat(body)} : {})
    });
    const response = await worker.fetch(request, {});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(503, {'Content-Type': 'text/plain'});
    outgoing.end('Preview unavailable. Run npm run build.');
  }
}).listen(port, '0.0.0.0', () => console.log('Preview listening on port ' + port));
