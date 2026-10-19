import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CODE_ROOT } from './paths.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};

// Servidor estático local: /app -> composição, /vendor -> node_modules, /proj -> raiz do projeto.
export function startServer(projectRoot, { port = 0 } = {}) {
  const roots = {
    app: path.join(CODE_ROOT, 'composition'),
    vendor: path.join(CODE_ROOT, 'node_modules'),
    proj: path.resolve(projectRoot),
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, mount, ...rest] = decodeURIComponent(url.pathname).split('/');
    const base = roots[mount];
    const file = base && path.resolve(base, rest.join('/'));
    if (!file || (file !== base && !file.startsWith(base + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('não encontrado');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
