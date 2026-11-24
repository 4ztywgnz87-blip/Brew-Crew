// Local preview: serves /public and runs the Cloudflare functions in Node.
// Usage: node tools/dev-server.mjs  → http://localhost:8788
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = Number(process.env.PORT || 8788);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const file = path.join(root, 'functions', url.pathname.replace(/\/$/, '') + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404).end('{}'); return; }
    const mod = await import(pathToFileURL(file).href);
    const r = await mod.onRequestGet({ request: new Request(url) });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = path.join(pub, decodeURIComponent(url.pathname));
  if (!p.startsWith(pub)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Brew Crew dev server on http://localhost:${port}`));
