import assert from 'node:assert/strict';
import { completePayment } from '../src/ops.js';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ path: new URL(url).pathname, method: options.method });
  return { ok: true, text: async () => JSON.stringify({ bill: { id: 'B-1' }, table_closed: true }) };
};
try {
  const result = await completePayment({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }, 'token', {
    idempotency_key: 'pay-1', table_id: 't4', expected_version: 2,
    items: [{ id: '12', qty: 1 }], payment: 'Cash', payments: { Cash: 100 }, cash_received: 100
  });
  assert.equal(result.bill.id, 'B-1');
  assert.deepEqual(calls, [{ path: '/rest/v1/rpc/complete_payment', method: 'POST' }], 'receipt response must not wait for inventory or table requests');
  console.log('Payment response OK: committed bill returns without follow-up queries');
} finally {
  globalThis.fetch = originalFetch;
}
