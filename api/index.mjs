import { loadEnv } from '../scripts/load-env.mjs';
import { handle } from '../src/index.js';
import { appEnv, webRequest, writeWebResponse } from '../src/node-adapter.js';

loadEnv();
const env = appEnv();

export default async function handler(req, res) {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const origin = `${proto}://${host}`;
    const current = new URL(req.url || '/', origin);
    const routed = current.searchParams.get('__path');
    if (routed != null && current.pathname.startsWith('/api/index')) {
      current.pathname = routed ? `/${routed.replace(/^\/+/, '')}` : '/';
      current.searchParams.delete('__path');
      req.url = `${current.pathname}${current.search}`;
    }
    const request = await webRequest(req, origin);
    await writeWebResponse(res, await handle(request, env));
  } catch (error) {
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.message || 'Server error' }));
  }
}
