export function json(data, status = 200, extra = {}) {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

export function text(body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
  const headers = new Headers(extra);
  headers.set('Content-Type', type);
  headers.set('Cache-Control', 'no-store');
  return new Response(body, { status, headers });
}

export function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

export function cookiesOf(request) {
  const out = {};
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

export function sessionCookies(access, refresh, secure) {
  const base = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return [
    `tea_access=${encodeURIComponent(access)}; ${base}; Max-Age=3600`,
    `tea_refresh=${encodeURIComponent(refresh || '')}; ${base}; Max-Age=43200`
  ];
}

export function clearCookies(secure) {
  const base = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  return [`tea_access=; ${base}`, `tea_refresh=; ${base}`];
}

export async function readJson(request, limit = 32 * 1024 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > limit) {
    const error = new Error('Request too large');
    error.status = 413;
    throw error;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

export function clientKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
}

export function isSecure(request) {
  const url = new URL(request.url);
  return url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}
