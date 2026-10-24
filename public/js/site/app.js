const CART_KEY = 'tea_amo_public_cart';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
}
function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items.filter((item) => Number(item.qty) > 0)));
  renderNavCount();
}
function renderNavCount() {
  const count = loadCart().reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const el = $('navCartCount');
  if (el) el.textContent = count ? `(${count})` : '';
}
function money(cafe, value) {
  return `${cafe?.currency || 'Rs'} ${Number(value || 0).toLocaleString('en-NP', { maximumFractionDigits: 2 })}`;
}
function quote(cafe, items, fulfillment) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const tax = subtotal * Number(cafe?.taxRate || 0) / 100;
  const delivery = fulfillment === 'delivery' ? Math.max(0, Number(cafe?.storefront?.deliveryFee || 0)) : 0;
  return { subtotal, tax, delivery, total: subtotal + tax + delivery };
}

async function api(path, opt = {}) {
  const response = await fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }, ...opt });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.data = data;
    throw error;
  }
  return data;
}

async function loadMenu() {
  if (window.__teaPublicMenu) return window.__teaPublicMenu;
  window.__teaPublicMenu = api('/api/public/menu');
  return window.__teaPublicMenu;
}

function itemHref(item) {
  return '/menu/' + encodeURIComponent(item.id);
}

function photoUrl(item) {
  const url = String(item?.image_url || item?.image || item?.photo || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

window.teaPhotoFallback = function (img) {
  const parent = img?.parentNode;
  const mark = img?.dataset?.mark || '';
  img?.remove();
  if (parent && !parent.querySelector('img')) parent.textContent = mark;
};

function photoMarkup(item, className = 'photo', id = '') {
  const url = photoUrl(item);
  const mark = esc((item?.name || 'T').slice(0, 1));
  const idAttr = id ? ` id="${esc(id)}"` : '';
  if (!url) return `<div class="${className}"${idAttr} aria-hidden="true">${mark}</div>`;
  return `<div class="${className}"${idAttr}><img src="${esc(url)}" alt="${esc(item.name || '')}" data-mark="${mark}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="window.teaPhotoFallback(this)"></div>`;
}

function itemCard(cafe, item) {
  return `<a class="card ${item.available === false ? 'unavailable' : ''}" href="${itemHref(item)}">${photoMarkup(item)}<b>${esc(item.name)}</b><span class="muted">${esc(item.category)}</span><div class="price">${money(cafe, item.price)}</div></a>`;
}

function addToCart(item, qty = 1) {
  const cart = loadCart();
  const line = cart.find((row) => String(row.id) === String(item.id));
  if (line) line.qty = Number(line.qty || 0) + qty;
  else cart.push({ id: item.id, name: item.name, price: item.price, qty });
  saveCart(cart);
}

function markNav() {
  const path = document.body.dataset.path || location.pathname;
  document.querySelectorAll('.site-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href && (href === path || (href === '/menu' && path.startsWith('/menu/')))) link.setAttribute('aria-current', 'page');
  });
}

function fillCafe(cafe) {
  const site = cafe.storefront || {};
  const set = (id, value) => { if ($(id) && value) $(id).textContent = value; };
  set('footerAddress', site.address || cafe.branch || 'Gokarna, Kathmandu, Nepal');
  set('homeTag', site.heroTag || 'Café in Gokarna, Kathmandu');
  set('homeAbout', site.about || '');
  set('homeHours', site.hours ? `Hours: ${site.hours}` : 'Opening hours will be published here when the owner enters them.');
  set('homeAddress', site.address || 'Gokarna, Kathmandu, Nepal');
  set('aboutCopy', site.about || $('aboutCopy')?.textContent);
  set('contactAddress', site.address || 'Gokarna, Kathmandu, Nepal');
  set('contactPhone', site.phone ? `Phone: ${site.phone}` : 'Phone will appear here when published in Settings.');
  set('contactEmail', site.email ? `Email: ${site.email}` : '');
  set('contactHours', site.hours ? `Hours: ${site.hours}` : '');
  if ($('contactMap') && site.mapUrl) $('contactMap').innerHTML = `<a href="${esc(site.mapUrl)}">Directions</a>`;
  if ($('deliveryCopy')) {
    $('deliveryCopy').textContent = site.deliveryEnabled
      ? `Delivery is available. Fee ${money(cafe, site.deliveryFee || 0)}${site.minOrder ? `, minimum ${money(cafe, site.minOrder)}` : ''}.`
      : 'Delivery is not enabled right now. Please choose pickup or visit the café.';
  }
}

function renderHome(cafe, menu) {
  fillCafe(cafe);
  const featured = menu.filter((item) => item.category === (cafe.storefront?.featuredCategory || menu[0]?.category)).slice(0, 6);
  if ($('homeFeatured')) $('homeFeatured').innerHTML = featured.map((item) => itemCard(cafe, item)).join('');
  const cats = [...new Set(menu.map((item) => item.category))];
  if ($('homeCategories')) {
    $('homeCategories').innerHTML = cats.map((cat) => {
      const cover = menu.find((item) => item.category === cat && photoUrl(item)) || { name: cat };
      return `<a class="card" href="/menu?cat=${encodeURIComponent(cat)}">${photoMarkup(cover)}<b>${esc(cat)}</b></a>`;
    }).join('');
  }
}

function renderMenuPage(cafe, menu) {
  const params = new URLSearchParams(location.search);
  let category = params.get('cat') || '';
  const search = $('menuSearch');
  const paint = () => {
    const query = (search?.value || '').trim().toLowerCase();
    const rows = menu.filter((item) => (!category || item.category === category) && (!query || item.name.toLowerCase().includes(query)));
    $('menuGrid').innerHTML = rows.map((item) => itemCard(cafe, item)).join('') || '<div class="empty">No items match.</div>';
    document.querySelectorAll('#menuChips button').forEach((button) => button.classList.toggle('on', (button.dataset.cat || '') === category));
  };
  $('menuChips').innerHTML = `<button type="button" class="${category ? '' : 'on'}" data-cat="">All</button>` + [...new Set(menu.map((item) => item.category))].map((cat) => `<button type="button" data-cat="${esc(cat)}">${esc(cat)}</button>`).join('');
  $('menuChips').onclick = (event) => {
    const chip = event.target.closest('[data-cat]');
    if (!chip) return;
    category = chip.dataset.cat || '';
    paint();
  };
  if (search) search.oninput = paint;
  paint();
}

function renderItem(cafe, menu) {
  const id = decodeURIComponent(location.pathname.split('/').pop() || '');
  const item = menu.find((row) => String(row.id) === String(id));
  if (!item) {
    $('itemName').textContent = 'Item not found';
    return;
  }
  document.title = `${item.name} — TEA AMO`;
  $('itemName').textContent = item.name;
  $('itemCategory').textContent = item.category;
  $('itemDesc').textContent = item.description || 'Prepared at TEA AMO. Ask staff if you need allergen details.';
  $('itemPrice').textContent = money(cafe, item.price);
  const photo = $('itemPhoto');
  if (photo) photo.outerHTML = photoMarkup(item, 'photo', 'itemPhoto');
  let qty = 1;
  const sync = () => { $('itemQty').textContent = String(qty); };
  $('itemMinus').onclick = () => { qty = Math.max(1, qty - 1); sync(); };
  $('itemPlus').onclick = () => { qty += 1; sync(); };
  $('itemAdd').onclick = () => { addToCart(item, qty); $('itemStatus').textContent = 'Added to cart.'; };
}

function renderCart(cafe) {
  const items = loadCart();
  if (!items.length) {
    $('cartLines').innerHTML = '<div class="empty">Your cart is empty.</div>';
    $('cartTotals').innerHTML = '';
    return;
  }
  $('cartLines').innerHTML = items.map((item) => `<div class="cart-line"><div><b>${esc(item.name)}</b><div class="muted">${money(cafe, item.price)}</div></div><div class="qty"><button type="button" data-id="${esc(item.id)}" data-d="-1">−</button><b>${item.qty}</b><button type="button" data-id="${esc(item.id)}" data-d="1">+</button></div><button type="button" data-id="${esc(item.id)}" data-d="0">Remove</button></div>`).join('');
  const totals = quote(cafe, items, 'pickup');
  $('cartTotals').innerHTML = `<div class="srow"><span>Subtotal</span><b>${money(cafe, totals.subtotal)}</b></div><div class="srow"><span>Tax</span><b>${money(cafe, totals.tax)}</b></div><div class="srow"><span>Estimated total</span><b>${money(cafe, totals.total)}</b></div><p class="muted">Delivery fee, if any, is added at checkout.</p>`;
  $('cartLines').onclick = (event) => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    const next = loadCart().map((item) => String(item.id) === String(button.dataset.id) ? { ...item, qty: button.dataset.d === '0' ? 0 : Number(item.qty) + Number(button.dataset.d) } : item);
    saveCart(next);
    renderCart(cafe);
  };
}

function renderCheckout(cafe, menu) {
  const site = cafe.storefront || {};
  if (!loadCart().length) {
    $('checkoutNotice').classList.remove('hidden');
    $('checkoutNotice').textContent = 'Your cart is empty. Add items from the menu before placing an order.';
    $('placeOrder').disabled = true;
  }
  if (!site.enabled || site.orderingPaused) {
    $('checkoutNotice').classList.remove('hidden');
    $('checkoutNotice').textContent = 'Online ordering is paused.';
    $('placeOrder').disabled = true;
  }
  if (!site.deliveryEnabled) {
    $('deliveryChoice')?.setAttribute('hidden', '');
    $('fulfillmentHelp').textContent = 'Pickup is available. Delivery is not enabled by the café right now.';
  } else {
    $('fulfillmentHelp').textContent = `Delivery fee ${money(cafe, site.deliveryFee || 0)}${site.minOrder ? `, minimum ${money(cafe, site.minOrder)}` : ''}.`;
  }
  const form = $('checkoutForm');
  const paint = () => {
    const fulfillment = form.fulfillment.value;
    $('deliveryFields').hidden = fulfillment !== 'delivery';
    $('deliveryAddress').required = fulfillment === 'delivery';
    const totals = quote(cafe, loadCart(), fulfillment);
    $('checkoutTotals').innerHTML = `<div>Subtotal ${money(cafe, totals.subtotal)}</div><div>Tax ${money(cafe, totals.tax)}</div><div>Delivery ${money(cafe, totals.delivery)}</div><b>Total ${money(cafe, totals.total)}</b>`;
  };
  form.onchange = paint;
  paint();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = $('placeOrder');
    button.disabled = true;
    $('checkoutNotice').classList.add('hidden');
    try {
      const fulfillment = form.fulfillment.value;
      const items = loadCart().map((item) => ({ id: item.id, qty: item.qty, price: item.price, name: item.name }));
      if (!items.length) throw new Error('Your cart is empty.');
      const result = await api('/api/public/orders', {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          fulfillment,
          customer_name: $('customerName').value,
          customer_phone: $('customerPhone').value,
          delivery_address: $('deliveryAddress').value,
          landmark: $('landmark').value,
          instructions: $('instructions').value,
          items
        })
      });
      saveCart([]);
      sessionStorage.setItem('tea_amo_last_order_token', result.order.access_token);
      location.assign('/order/confirmation?token=' + encodeURIComponent(result.order.access_token));
    } catch (error) {
      $('checkoutNotice').classList.remove('hidden');
      $('checkoutNotice').className = 'notice bad';
      $('checkoutNotice').textContent = error.message;
      button.disabled = false;
    }
  };
}

async function renderConfirmation() {
  const token = new URLSearchParams(location.search).get('token') || sessionStorage.getItem('tea_amo_last_order_token');
  if (!token) {
    $('confirmBox').textContent = 'No confirmation token was found. If you just ordered, keep the reference from the café staff.';
    return;
  }
  try {
    const data = await api('/api/public/orders/' + encodeURIComponent(token));
    const order = data.order;
    $('confirmBox').innerHTML = `<p>Order <b>${esc(order.public_ref)}</b> is <b>${esc(order.status)}</b>.</p><p>${esc(order.fulfillment)} · ${money({ currency: order.currency }, order.total)}</p><p class="muted">Staff still have to accept this order. It is not marked paid until they collect payment.</p>`;
  } catch {
    $('confirmBox').textContent = 'This confirmation link is not valid.';
  }
}

$('navToggle')?.addEventListener('click', () => {
  const nav = $('siteNav');
  const open = nav.classList.toggle('open');
  $('navToggle').setAttribute('aria-expanded', String(open));
});

markNav();
renderNavCount();

const path = document.body.dataset.path || location.pathname;
if (['/', '/menu', '/cart', '/checkout', '/delivery', '/about', '/contact'].includes(path) || path.startsWith('/menu/')) {
  loadMenu().then(({ cafe, menu }) => {
    fillCafe(cafe);
    if (path === '/') renderHome(cafe, menu);
    if (path === '/menu') renderMenuPage(cafe, menu);
    if (path.startsWith('/menu/') && path !== '/menu') renderItem(cafe, menu);
    if (path === '/cart') renderCart(cafe);
    if (path === '/checkout') renderCheckout(cafe, menu);
  }).catch((error) => {
    const main = document.querySelector('.site-wrap');
    if (main) main.insertAdjacentHTML('afterbegin', `<div class="notice bad">${esc(error.message)}</div>`);
  });
}
if (path === '/order/confirmation') renderConfirmation();
if (path === '/delivery' || path === '/about' || path === '/contact') {
  api('/api/public/cafe').then(({ cafe }) => fillCafe(cafe)).catch(() => {});
}
