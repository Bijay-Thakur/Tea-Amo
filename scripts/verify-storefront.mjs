import assert from 'node:assert/strict';
import { menuImageUrl } from '../src/slim.js';
import { quoteItems, validNepalPhone, validateGuestDetails, defaultStorefront, publicBusiness } from '../src/storefront.js';

assert.equal(menuImageUrl({ image_url: 'https://cdn.example/tea.webp' }), 'https://cdn.example/tea.webp');
assert.equal(menuImageUrl({ photo: 'https://cdn.example/chiya.jpg' }), 'https://cdn.example/chiya.jpg');
assert.equal(menuImageUrl({ image: 'data:image/png;base64,xx', image_url: '' }), '');
assert.equal(menuImageUrl({}), '');

assert.equal(validNepalPhone('9800000000'), true);
assert.equal(validNepalPhone('+9779800000000'), true);
assert.equal(validNepalPhone('123'), false);

const menu = [
  { id: '1', name: 'Milk Tea', price: 80, available: true },
  { id: '2', name: 'Hidden', price: 10, available: false }
];
const cafe = publicBusiness({ business: { currency: 'Rs', taxRate: 0 }, storefront: { ...defaultStorefront(), deliveryEnabled: true, deliveryFee: 50, minOrder: 200 } });
const quote = quoteItems(menu, [{ id: '1', qty: 3 }], cafe, 'pickup');
assert.equal(quote.total, 240);
assert.equal(quote.delivery_fee, 0);

let failed = false;
try { quoteItems(menu, [{ id: '1', qty: 1, price: 99 }], cafe, 'pickup'); } catch (error) { failed = error.code === 'price_changed'; }
assert.equal(failed, true, 'client-submitted prices must be rejected');

failed = false;
try { quoteItems(menu, [{ id: '2', qty: 1 }], cafe, 'pickup'); } catch (error) { failed = error.code === 'unavailable'; }
assert.equal(failed, true);

failed = false;
try { quoteItems(menu, [{ id: '1', qty: 1 }], cafe, 'delivery'); } catch { failed = true; }
assert.equal(failed, true, 'delivery minimum must be enforced');

const details = validateGuestDetails({ fulfillment: 'pickup', customer_name: 'Bijay', customer_phone: '9800000000' });
assert.equal(details.payment, 'pay_at_pickup');
assert.equal(details.address, '');

console.log('PASS storefront: phone validation, server prices, availability, delivery minimum, guest details');
