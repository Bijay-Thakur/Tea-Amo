import assert from 'node:assert/strict';
import { menuImageUrl } from '../src/slim.js';
import { quoteItems, validNepalPhone, validateGuestDetails, defaultStorefront, publicBusiness, publicCafeView, selectFeatured, guestOrderingAvailable, publicHttpUrl } from '../src/storefront.js';

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

const featuredMenu = [
  { id: 'a', name: 'Classic Sweet Chiya', category: 'Chiya', price: 45, available: true },
  { id: 'f', name: 'Shikhar Ice', category: 'Cigarettes', price: 25, available: true },
  { id: 'b', name: 'Milk Coffee Hot', category: 'Coffee', price: 130, available: true },
  { id: 'c', name: 'Chicken Biryani', category: 'Opening Special', price: 435, available: true },
  { id: 'd', name: 'Hidden Tea', category: 'Chiya', price: 10, available: false },
  { id: 'e', name: 'Green Tea', category: 'Himalayan Herbal Rituals', price: 45, available: true }
];
const chosen = selectFeatured(featuredMenu, { featuredIds: ['d', 'Milk Coffee Hot', 'c'] });
assert.deepEqual(chosen.items.map((item) => item.id), ['b', 'c']);
assert.equal(chosen.curated, true);
const tasted = selectFeatured(featuredMenu, {});
assert.deepEqual(tasted.items.map((item) => item.category), ['Chiya', 'Coffee', 'Opening Special', 'Himalayan Herbal Rituals']);
assert.equal(tasted.items.some((item) => item.category === 'Cigarettes'), false);
assert.equal(tasted.curated, false);
assert.equal(tasted.items.some((item) => item.available === false), false);

const view = publicCafeView(publicBusiness({
  business: { currency: 'Rs', taxRate: 13, payment_methods: [{ name: 'Cash' }], payment_qr: { eSewa: 'secret' } },
  storefront: { ...defaultStorefront(), phone: '9800000000', mapUrl: 'javascript:alert(1)', social: { instagram: 'https://instagram.com/teaamo' }, featuredIds: ' Classic Sweet Chiya, Classic Sweet Chiya ' }
}));
assert.equal(view.payment_methods, undefined);
assert.equal(view.taxRate, undefined);
assert.equal(view.storefront.phone, '9800000000');
assert.equal(view.storefront.mapUrl, '');
assert.equal(view.storefront.social.instagram, 'https://instagram.com/teaamo');
assert.deepEqual(view.storefront.featuredIds, ['Classic Sweet Chiya']);
assert.equal(publicHttpUrl('javascript:alert(1)'), '');
assert.equal(guestOrderingAvailable(), false);
const published = publicCafeView(publicBusiness({ business: {}, storefront: { hours: '', phone: ' ', email: '', social: { facebook: '', instagram: '' } } }));
assert.equal(published.storefront.hours, '7 AM to 9 PM');
assert.equal(published.storefront.phone, '9717128778');
assert.equal(published.storefront.email, 'teaaamo2024@gmail.com');
assert.equal(published.storefront.social.instagram, 'https://www.instagram.com/tea.amo2024/');
assert.equal(published.storefront.social.facebook, 'https://www.facebook.com/share/19rWN7yofK/?mibextid=wwXIfr');
assert.equal(published.storefront.social.tiktok, '');

console.log('PASS storefront: phone validation, server prices, availability, delivery minimum, guest details, featured menu, public view');
