import { spawn } from 'node:child_process';
import { loadEnv } from './load-env.mjs';

loadEnv();
const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const environments = ['production', 'preview', 'development'];

for (const name of names) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  for (const environment of environments) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx', 'vercel', 'env', 'add', name, environment, '--sensitive', '--force'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { out += chunk; });
      child.stdin.end(value);
      child.on('exit', (code) => {
        const safe = names.reduce((text, key) => text.split(process.env[key]).join('[set]'), out);
        console.log(`${name} ${environment} ${code === 0 ? 'ok' : 'failed'}`);
        if (code !== 0) console.log(safe.slice(0, 500));
        code === 0 ? resolve() : reject(new Error(`${name} ${environment}`));
      });
    });
  }
}
