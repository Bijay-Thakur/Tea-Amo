import assert from 'node:assert/strict';
import { applyAuthoritativeStock, mergeMissingBills } from '../src/ops.js';

const ingredients = [{ key: 'dough', stock: 100, stockServer: 100, avg_cost: 2, avgCostServer: 2 }];
const synced = applyAuthoritativeStock(ingredients, [{ key: 'dough', stock: 80, avg_cost: 2 }]);
assert.equal(ingredients[0].stock, 80);
assert.equal(synced.preserved, 1);
assert.equal(synced.adjusted, 0);

const purchased = [{ key: 'dough', stock: 105, stockServer: 100, avg_cost: 2, avgCostServer: 2 }];
applyAuthoritativeStock(purchased, [{ key: 'dough', stock: 80, avg_cost: 2 }]);
assert.equal(purchased[0].stock, 85);

const state = { bills: [{ id: 'B1' }], ingredients: [{ key: 'dough', stock: 80, stockServer: 80 }] };
const added = mergeMissingBills(state, [{ id: 'S1', bill: { id: 'S1', items: [{ name: 'Momo', qty: 1 }] } }]);
assert.equal(added, 1);
assert.equal(state.ingredients[0].stock, 80);

console.log('PASS integrity helpers');
