import { pbkdf2 as pbkdf2Cb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Cb);

function decodeB64(value) {
  return Buffer.from(String(value || ''), 'base64');
}

export async function verifyOwnerPasswordRecord(password, auth, legacyHash) {
  const secret = String(password || '');
  if (!secret) return false;
  if (auth?.hash && auth?.salt) {
    const iterations = Math.max(10000, Number(auth.iterations || 210000));
    const salt = decodeB64(auth.salt);
    const expected = decodeB64(auth.hash);
    if (!salt.length || expected.length !== 32) return false;
    const got = await pbkdf2(secret, salt, iterations, 32, 'sha256');
    return timingSafeEqual(got, expected);
  }
  if (legacyHash) {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(secret).digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(String(legacyHash));
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}
