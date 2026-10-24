import assert from 'node:assert/strict';
import { clearedOperationalState, resetPhrase, resetVerified } from '../src/reset.js';

assert.equal(resetPhrase(), 'RESET TEA AMO');
const next = clearedOperationalState({
  bills: [1], attendance: [1], customers: [1], complaints: [1], accountTransfers: [1],
  menu: [{ name: 'Tea' }], business: { name: 'TEA AMO' },
  ingredients: [{ key: 'tea', stock: 9, avg_cost: 2 }],
  staff: [{ clockIn: 'now' }], tables: [{ attention: true, reservation: {} }],
  operationalGeneration: 4
});
assert.equal(next.bills.length, 0);
assert.equal(next.complaints.length, 0);
assert.equal(next.accountTransfers.length, 0);
assert.equal(next.menu.length, 1);
assert.equal(next.business.name, 'TEA AMO');
assert.equal(next.ingredients[0].stock, 0);
assert.equal(next.staff[0].clockIn, null);
assert.equal(next.operationalGeneration, 5);
assert.equal(resetVerified({ sales: 10 }, { sales: 0, sale_items: 0, payments: 0, live_orders: 0, order_items: 0, inventory_movements: 0, guest_orders: 0, bills: 0 }), true);
assert.equal(resetVerified({}, { sales: 2, sale_items: 0, payments: 0, live_orders: 0, order_items: 0, inventory_movements: 0, guest_orders: 0, bills: 0 }), false);
console.log('PASS reset helpers: scope, generation, verification');
