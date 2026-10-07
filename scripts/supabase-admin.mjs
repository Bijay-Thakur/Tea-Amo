import { loadEnv } from './load-env.mjs';

loadEnv();

export const url = process.env.SUPABASE_URL || '';
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const anonKey = process.env.SUPABASE_ANON_KEY || '';

export function requireConfig() {
  if (!url || !serviceKey || !anonKey) {
    console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
    process.exit(1);
  }
}

export async function call(path, { method = 'GET', body, key = serviceKey, prefer } = {}) {
  const headers = { apikey: key === serviceKey ? serviceKey : anonKey, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(path, url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || text || response.statusText);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function signIn(email, password) {
  return call(`/auth/v1/token?grant_type=password`, { method: 'POST', key: anonKey, body: { email, password } });
}
