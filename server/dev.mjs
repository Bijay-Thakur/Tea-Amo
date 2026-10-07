import http from 'node:http';
import fs from 'node:fs';
import { loadEnv } from '../scripts/load-env.mjs';

loadEnv();
const { handle } = await import('../src/index.js');
const { appEnv, publicFile, contentType, webRequest, writeWebResponse } = await import('../src/node-adapter.js');

const port = Number(process.env.PORT || 8788);
const gated = new Set(['/', '/index.html', '/admin', '/server', '/staff', '/staff.html']);
const env = appEnv();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const dynamic = gated.has(url.pathname) || url.pathname.startsWith('/api/');
    if (!dynamic) {
      const file = publicFile(url.pathname);
      if (file) {
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType(file));
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    const request = await webRequest(req, `http://127.0.0.1:${port}`);
    await writeWebResponse(res, await handle(request, env));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.message || 'Server error' }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`TEA AMO http://127.0.0.1:${port}`);
  console.log('Administration /admin    Server /server');
});
