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
