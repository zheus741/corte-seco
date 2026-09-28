/* Local copy of the Vercel setup: static files + the same headers (COOP/COEP) on http://localhost:8766 */
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = new URL('../site', import.meta.url).pathname;
const cfg = JSON.parse(fs.readFileSync(ROOT + '/vercel.json', 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  const h = { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': fs.statSync(f).size };
  for (const rule of cfg.headers) { const re = new RegExp('^' + rule.source.replace(/\((?!\?)/g, '(?:').replace(/\.\*/g, '.*') + '$'); if (re.test(p)) for (const x of rule.headers) h[x.key] = x.value; }
  res.writeHead(200, h); fs.createReadStream(f).pipe(res);
}).listen(8766, () => console.log('site on http://localhost:8766'));
