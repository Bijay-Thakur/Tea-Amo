export function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
}

async function call(url, headers, method, body) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || data?.msg || data?.error || response.statusText || 'Request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function rest(env, path, { method = 'GET', body, token, prefer } = {}) {
  const headers = {
    apikey: token ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${token || env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return call(new URL(path, env.SUPABASE_URL), headers, method, body);
}

export function rpc(env, name, args, token) {
  return rest(env, `/rest/v1/rpc/${name}`, { method: 'POST', body: args, token });
}

export async function passwordGrant(env, email, password) {
  return call(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  }, 'POST', { email, password });
}

export async function refreshGrant(env, refreshToken) {
  return call(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  }, 'POST', { refresh_token: refreshToken });
}

export async function authUser(env, accessToken) {
  return call(`${env.SUPABASE_URL}/auth/v1/user`, {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`
  }, 'GET');
}

export function authAdmin(env, path, { method = 'GET', body } = {}) {
  return call(new URL(`/auth/v1/admin${path}`, env.SUPABASE_URL), {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }, method, body);
}

function serviceHeaders(env, contentType) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

export async function ensureMenuImageBucket(env) {
  const url = new URL('/storage/v1/bucket', env.SUPABASE_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: serviceHeaders(env, 'application/json'),
    body: JSON.stringify({
      id: 'menu-images',
      name: 'menu-images',
      public: true,
      file_size_limit: 2097152,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp']
    })
  });
  if (response.ok || response.status === 409) return;
  const raw = await response.text();
  if (/already exists|duplicate/i.test(raw)) return;
  const error = new Error(raw || 'Could not prepare menu image storage');
  error.status = response.status;
  throw error;
}

export async function uploadMenuImageObject(env, path, bytes, contentType) {
  await ensureMenuImageBucket(env);
  const url = new URL(`/storage/v1/object/menu-images/${path}`, env.SUPABASE_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env, contentType),
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable'
    },
    body: bytes
  });
  if (!response.ok) {
    const raw = await response.text();
    const error = new Error(raw || 'Image upload failed');
    error.status = response.status;
    throw error;
  }
  const version = Date.now();
  return `${env.SUPABASE_URL}/storage/v1/object/public/menu-images/${path}?v=${version}`;
}

export function menuImageObjectPath(env, imageUrl) {
  if (!imageUrl) return '';
  try {
    const url = new URL(imageUrl);
    const origin = new URL(env.SUPABASE_URL).origin;
    if (url.origin !== origin) return '';
    const marker = '/storage/v1/object/public/menu-images/';
    const index = url.pathname.indexOf(marker);
    if (index === -1) return '';
    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return '';
  }
}

export async function deleteMenuImageObject(env, imageUrl) {
  const path = menuImageObjectPath(env, imageUrl);
  if (!path || path.includes('..')) return false;
  const listed = new URL('/storage/v1/object/menu-images', env.SUPABASE_URL);
  const response = await fetch(listed, {
    method: 'DELETE',
    headers: serviceHeaders(env, 'application/json'),
    body: JSON.stringify({ prefixes: [path] })
  });
  if (response.ok) return true;
  const exact = new URL(`/storage/v1/object/menu-images/${path.split('/').map(encodeURIComponent).join('/')}`, env.SUPABASE_URL);
  const fallback = await fetch(exact, { method: 'DELETE', headers: serviceHeaders(env) });
  return fallback.ok;
}
