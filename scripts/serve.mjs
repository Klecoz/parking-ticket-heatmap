#!/usr/bin/env node
// Dev server that sends Cache-Control: no-store for all JS/JSON files,
// preventing browser ES module caching across reloads.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = parseInt(process.argv[2] || '8765', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const NO_CACHE_EXTS = new Set(['.js', '.mjs', '.json', '.geojson', '.css']);

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  // strip query string from filesystem path
  const fsPath = resolve(ROOT, '.' + p);
  if (!fsPath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(fsPath) || statSync(fsPath).isDirectory()) {
    // try index.html inside directory
    const idx = resolve(fsPath, 'index.html');
    if (existsSync(idx)) { res.writeHead(301, { Location: url.pathname + '/' }); res.end(); return; }
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = extname(fsPath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const noCache = NO_CACHE_EXTS.has(ext);
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': noCache ? 'no-store' : 'public, max-age=3600',
  });
  res.end(readFileSync(fsPath));
}).listen(PORT, () => console.log(`[serve] http://localhost:${PORT}/  (no-store for JS/JSON)`));
