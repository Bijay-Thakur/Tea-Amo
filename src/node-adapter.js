import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicCandidates = [
  path.resolve(process.cwd(), 'public'),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
];
const publicDir = publicCandidates.find((dir) => fs.existsSync(dir)) || publicCandidates[0];
const publicRoot = publicDir.endsWith(path.sep) ? publicDir : publicDir + path.sep;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function fileFor(urlPath) {
  let rel = decodeURIComponent(String(urlPath || ''));
  try { rel = decodeURIComponent(rel); } catch { /* already decoded */ }
  rel = rel.replace(/^\/+/, '');
  if (!rel || rel.includes('\0') || rel.includes('..')) return null;
  const file = path.resolve(publicDir, rel);
  if (file !== publicDir && !file.startsWith(publicRoot)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

export function appEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ASSETS: {
      async fetch(request) {
        const file = fileFor(new URL(request.url).pathname);
        if (!file) return new Response('Missing', { status: 404 });
        const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
        return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
      }
    }
  };
}

export function publicFile(urlPath) {
  return fileFor(urlPath);
}

export function contentType(file) {
  return types[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

export async function webRequest(req, origin) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, String(value));
  }
  const method = req.method || 'GET';
  return new Request(new URL(req.url || '/', origin), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body
  });
}

export async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
