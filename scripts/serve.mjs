// 의존성 없는 로컬 정적 서버. index.html 을 file:// 로 열면 fetch가 CORS로 막히므로 필요하다.
//   node scripts/serve.mjs [포트]

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

http
  .createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let rel = url.slice(1);
    // 디렉터리 경로("/" 또는 "c/")는 그 안의 index.html 로 (정적 호스트와 동일)
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';

    // 경로 탈출 차단
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // 확장자 없는 경로가 실제 디렉터리면 index.html 을 찾는다
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch { /* 파일이면 그대로 진행 */ }

    try {
      const body = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT} 에서 서빙 중 (Ctrl+C 로 종료)`));
