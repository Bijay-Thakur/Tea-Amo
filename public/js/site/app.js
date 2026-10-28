const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const STOCK_ABOUT = 'TEA AMO is a café in Gokarna, Kathmandu. This website uses the same live menu as the café counter.';
const PUBLIC_INTRO = 'From a comforting cup of chiya to time spent with friends, TEA AMO is a place to slow down and enjoy the little moments.';

const ICONS = {
  tea: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 26h26v12a11 11 0 0 1-11 11h-4a11 11 0 0 1-11-11V26z"/><path d="M42 30h6a6 6 0 0 1 0 12h-6"/><path d="M24 16c0 4 4 4 4 8M33 14c0 4 4 4 4 8"/></svg>',
  coffee: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 26h24v14a12 12 0 0 1-24 0V26z"/><path d="M42 30h5a7 7 0 0 1 0 14h-5"/><path d="M24 16c1 4 5 4 4 8M32 14c1 4 5 4 4 8"/></svg>',
  plate: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 34h36"/><path d="M18 34c1 10 7 16 14 16s13-6 14-16"/><path d="M32 22v8M24 24c2 3 4 4 8 4s6-1 8-4"/></svg>',
  cold: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 16h16l-2 34a8 8 0 0 1-12 0L24 16z"/><path d="M24 24h16M28 20h.1M36 28h.1"/></svg>',
  sheesha: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M26 44h12v6H26z"/><path d="M32 44V28"/><path d="M24 28h16l-2-8H26z"/><path d="M38 18c6 2 10 6 10 12"/></svg>',
  glass: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 14h20l-2 24a10 10 0 0 1-16 0L22 14z"/><path d="M32 38v10M24 48h16"/></svg>',
  pack: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 16h20v34H22z"/><path d="M22 26h20M30 16v-4h4"/></svg>'
};

function iconKind(category) {
  const name = String(category || '').toLowerCase();
  if (/sheesha/.test(name)) return 'sheesha';
  if (/coffee/.test(name)) return 'coffee';
  if (/cigaret/.test(name)) return 'pack';
  if (/hard drink|beer|alcohol|spirit|wine/.test(name)) return 'glass';
  if (/iced|cold|lassi|drink/.test(name)) return 'cold';
  if (/chiya|tea|herbal|flavour|flavor/.test(name)) return 'tea';
  return 'plate';
}

const GROUPS = [
  { id: 'tea', label: 'Tea', icon: 'tea', test: /chiya|flavour tea|flavor tea|herbal|\btea\b/i },
  { id: 'coffee', label: 'Coffee', icon: 'coffee', test: /coffee/i },
  { id: 'cold', label: 'Cold drinks', icon: 'cold', test: /iced|cold|lassi/i },
  { id: 'sheesha', label: 'Sheesha', icon: 'sheesha', test: /sheesha/i },
  { id: 'food', label: 'Food', icon: 'plate', test: /^menu$|opening|food|snack|kitchen|momo|special/i },
  { id: 'bar', label: 'Bar', icon: 'glass', test: /hard drink|beer|alcohol|spirit|wine/i },
  { id: 'cigarettes', label: 'Cigarettes', icon: 'pack', test: /cigaret/i }
];

function groupFor(category) {
  const name = String(category || '').trim();
  const spec = GROUPS.find((group) => group.test.test(name));
  if (spec) return spec;
  return { id: `other:${name.toLowerCase()}`, label: name || 'Menu', icon: iconKind(name) };
}

function groupsFrom(menu) {
  const present = new Map();
  for (const item of menu) {
    const group = groupFor(item.category);
    if (!present.has(group.id)) present.set(group.id, group);
  }
  const ordered = GROUPS.filter((group) => present.has(group.id));
  for (const group of present.values()) {
    if (!GROUPS.some((spec) => spec.id === group.id)) ordered.push(group);
  }
  return ordered;
}

function intro(about) {
  const text = String(about || '').trim();
  if (!text || text === STOCK_ABOUT) return PUBLIC_INTRO;
  return text;
}

function money(cafe, value) {
  const amount = Number(value || 0);
  const digits = Number.isInteger(amount) ? 0 : 2;
  const currency = cafe?.currency;
  const label = !currency || currency === 'Rs' || currency === 'NPR' ? 'NPR' : currency;
  return `${label} ${amount.toLocaleString('en-NP', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* unpublished or invalid */ }
  return '';
}

function photoUrl(item) {
  const url = String(item?.image_url || item?.image || item?.photo || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

window.teaPhotoFallback = function (img) {
  const parent = img?.parentElement;
  if (!parent) return;
  parent.innerHTML = `<div class="ph">${ICONS[img.dataset.kind] || ICONS.tea}</div>`;
};

function visualMarkup(item) {
  const kind = iconKind(item.category);
  const url = photoUrl(item);
  if (!url) return `<div class="visual"><div class="ph">${ICONS[kind]}</div></div>`;
  return `<div class="visual"><img src="${esc(url)}" alt="" data-kind="${esc(kind)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="window.teaPhotoFallback(this)"></div>`;
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The menu could not be loaded.');
  return data;
}

function markNav() {
  const path = document.body.dataset.path || location.pathname;
  document.querySelectorAll('.site-nav a').forEach((link) => {
    const key = link.dataset.nav;
    const current = (key === 'home' && path === '/') || (key === 'menu' && path === '/menu') || (key === 'about' && path === '/about-contact');
    if (current) link.setAttribute('aria-current', 'page');
  });
}

function bindHeader() {
  const header = $('siteHeader');
  const toggle = $('navToggle');
  const nav = $('siteNav');
  const onScroll = () => header?.classList.toggle('stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  const setOpen = (open) => {
    nav?.classList.toggle('open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    const label = toggle?.querySelector('.sr');
    if (label) label.textContent = open ? 'Close navigation' : 'Open navigation';
  };
  toggle?.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav?.addEventListener('click', (event) => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  document.addEventListener('click', (event) => {
    if (!nav?.classList.contains('open')) return;
    if (event.target.closest('#siteNav, #navToggle')) return;
    setOpen(false);
  });
}

const CONTACT_ICONS = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M8 4h2l1.2 3.2-1.6 1.2a12 12 0 0 0 5 5l1.2-1.6L19 13v2a2 2 0 0 1-2.2 2A14 14 0 0 1 5 7.2 2 2 0 0 1 7 5"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M4 7l8 6 8-6"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.2 8.5h2.3V6h-2.3c-2 0-3.5 1.4-3.5 3.5V12H8.5v2.5h2.2V20h2.6v-5.5h2.2l.3-2.5h-2.5V9.6c0-.6.4-1.1 1-1.1z"/></svg>',
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.6" cy="7.4" r=".9" fill="currentColor"/></svg>'
};

function iconLink(href, label, icon, external) {
  const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="icon-btn" href="${esc(href)}" aria-label="${esc(label)}"${extra}>${icon}</a>`;
}

function contactIcons(site) {
  const links = [];
  const phone = String(site?.phone || '').trim();
  const email = String(site?.email || '').trim();
  const facebook = httpUrl(site?.social?.facebook);
  const instagram = httpUrl(site?.social?.instagram);
  if (phone) links.push(iconLink(`tel:${phone.replace(/[^\d+]/g, '')}`, `Call TEA AMO, ${phone}`, CONTACT_ICONS.phone, false));
  if (email.includes('@')) links.push(iconLink(`mailto:${email}`, `Email TEA AMO at ${email}`, CONTACT_ICONS.email, false));
  if (facebook) links.push(iconLink(facebook, 'TEA AMO on Facebook', CONTACT_ICONS.Facebook, true));
  if (instagram) {
    const handle = /instagram\.com\/tea\.amo2024/i.test(instagram) ? ', @tea.amo2024' : '';
    links.push(iconLink(instagram, `TEA AMO on Instagram${handle}`, CONTACT_ICONS.Instagram, true));
  }
  return links.join('');
}

function applyCafe(cafe) {
  const site = cafe?.storefront || {};
  const address = site.address || 'Gokarna, Kathmandu, Nepal';
  const hours = String(site.hours || '').trim();
  const hoursText = hours;
  const set = (id, value) => { const el = $(id); if (el && value != null) el.textContent = value; };
  set('footerAddress', address);
  set('footerHours', hoursText);
  set('visitAddress', address);
  set('visitHours', hoursText);
  for (const id of ['footerHours', 'visitHours']) { const el = $(id); if (el) el.hidden = !hoursText; }
  set('homeTag', site.heroTag || 'Café in Gokarna, Kathmandu');
  const copy = intro(site.about);
  set('homeAbout', copy);
  set('aboutLede', copy);
  set('aboutCopy', copy);
  const legal = [];
  if (site.legalName && site.legalName !== 'TEA AMO') legal.push(site.legalName);
  if (site.registration) legal.push(site.registration);
  if (site.pan) legal.push(`PAN ${site.pan}`);
  if (site.vat) legal.push(`VAT ${site.vat}`);
  const legalEl = $('visitLegal');
  if (legalEl) legalEl.textContent = legal.join(' · ');
  const icons = contactIcons(site);
  for (const id of ['footerSocial', 'contactActions', 'visitActions']) {
    const host = $(id);
    if (host) host.innerHTML = icons;
  }
  const actions = $('contactActions');
  if (actions && site.complaintContact && site.complaintContact !== site.phone && site.complaintContact !== site.email) {
    actions.insertAdjacentHTML('beforeend', `<p class="quiet contact-note">Complaints: ${esc(site.complaintContact)}</p>`);
  }
}

function detailExtras(cafe, item) {
  const blocks = [];
  if (Array.isArray(item.variants) && item.variants.length) {
    const rows = item.variants.map((variant) => {
      if (typeof variant === 'string') return esc(variant);
      const name = esc(variant?.name || variant?.label || '');
      if (!name) return '';
      const price = variant?.price == null ? '' : ` · ${esc(money(cafe, variant.price))}`;
      return name + price;
    }).filter(Boolean);
    if (rows.length) blocks.push(`<h3>Options</h3><ul>${rows.map((row) => `<li>${row}</li>`).join('')}</ul>`);
  }
  const notes = [].concat(item.dietary || [], item.allergens || []).filter((note) => typeof note === 'string' && note.trim());
  if (notes.length) blocks.push(`<h3>Notes from the café</h3><ul>${notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>`);
  return blocks.join('');
}

function renderHome(data) {
  const cafe = data.cafe || {};
  const menu = Array.isArray(data.menu) ? data.menu : [];
  const featured = Array.isArray(data.featured) ? data.featured : menu.slice(0, 4);
  applyCafe(cafe);
  const note = $('favoritesNote');
  if (note) note.textContent = data.featuredCurated ? 'Selected by the café.' : 'A few cups and plates from today. The rest of the menu is one page away.';
  const featuredHost = $('homeFeatured');
  if (featuredHost) {
    featuredHost.innerHTML = featured.length
      ? featured.map((item) => `<button type="button" class="fav-card" data-item="${esc(item.id)}">${visualMarkup(item)}<span class="name">${esc(item.name)}</span><span class="price">${esc(money(cafe, item.price))}</span></button>`).join('')
      : '<p class="empty">No menu items are published right now.</p>';
  }
  const strip = $('categoryStrip');
  if (strip) {
    const groups = groupsFrom(menu);
    strip.innerHTML = groups.map((group) => `<a class="cat-btn" href="/menu?group=${encodeURIComponent(group.id)}"><span class="mark">${ICONS[group.icon] || ICONS.plate}</span><span>${esc(group.label)}</span></a>`).join('');
  }
  bindItems(cafe, menu);
}

function renderMenu(data) {
  const cafe = data.cafe || {};
  const menu = Array.isArray(data.menu) ? data.menu : [];
  applyCafe(cafe);
  const groups = groupsFrom(menu);
  const chips = $('menuChips');
  if (chips) {
    chips.innerHTML = `<button type="button" class="chip" data-group="">All</button>` + groups.map((group) => `<button type="button" class="chip" data-group="${esc(group.id)}">${esc(group.label)}</button>`).join('');
  }
  const catSelect = $('menuCatSelect');
  if (catSelect) {
    catSelect.innerHTML = `<option value="">All</option>` + groups.map((group) => `<option value="${esc(group.id)}">${esc(group.label)}</option>`).join('');
  }

  const params = new URLSearchParams(location.search);
  let group = params.get('group') || '';
  if (!group && params.get('cat')) group = groupFor(params.get('cat')).id;
  if (group && !groups.some((item) => item.id === group)) group = '';
  const search = $('menuSearch');
  const grid = $('menuGrid');
  const paint = () => {
    const query = (search?.value || '').trim().toLowerCase();
    const rows = menu.filter((item) => {
      if (group && groupFor(item.category).id !== group) return false;
      if (!query) return true;
      return `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase().includes(query);
    });
    if (grid) {
      grid.innerHTML = rows.map((item) => `<button type="button" class="item-card ${item.available === false ? 'unavailable' : ''}" data-item="${esc(item.id)}">${visualMarkup(item)}<span class="copy"><span class="item-cat">${esc(item.category || 'Menu')}</span><span class="item-name">${esc(item.name)}</span><span class="price">${esc(money(cafe, item.price))}</span>${item.description ? `<p>${esc(item.description)}</p>` : ''}${item.available === false ? '<span class="status">Not available right now</span>' : ''}</span></button>`).join('')
        || '<p class="empty">No items match.</p>';
    }
    const count = $('menuCount');
    if (count) count.textContent = menu.length ? `${rows.length} ${rows.length === 1 ? 'item' : 'items'}` : '';
    if (catSelect) catSelect.value = group;
    document.querySelectorAll('#menuChips .chip').forEach((button) => {
      button.setAttribute('aria-pressed', String((button.dataset.group || '') === group));
    });
  };
  const chooseGroup = (next) => {
    group = next || '';
    const url = new URL(location.href);
    if (group) url.searchParams.set('group', group);
    else url.searchParams.delete('group');
    url.searchParams.delete('cat');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    paint();
  };
  chips?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-group]');
    if (!button) return;
    chooseGroup(button.dataset.group || '');
  });
  catSelect?.addEventListener('change', () => chooseGroup(catSelect.value));
  if (search) search.addEventListener('input', paint);
  paint();
  bindItems(cafe, menu);
}

function bindItems(cafe, menu) {
  const dialog = $('itemDialog');
  const findItem = (id) => menu.find((item) => String(item.id) === String(id));
  const openItem = (item, push) => {
    if (!dialog || !item) return;
    const url = photoUrl(item);
    const kind = iconKind(item.category);
    const photo = url
      ? `<img src="${esc(url)}" alt="${esc(item.name)}" data-kind="${esc(kind)}" decoding="async" referrerpolicy="no-referrer" onerror="window.teaPhotoFallback(this)">`
      : `<div class="ph">${ICONS[kind]}</div>`;
    $('dialogBody').innerHTML = `<div class="dialog-photo">${photo}</div><div class="dialog-copy"><div class="dialog-top"><div><p class="eyebrow">${esc(item.category || 'Menu')}</p><h2 id="dialogName">${esc(item.name)}</h2></div><button type="button" class="dialog-close" id="dialogClose">Close</button></div><p>${esc(item.description || 'The café has not published a description for this item.')}</p><p class="price">${esc(money(cafe, item.price))}</p><p>${item.available === false ? 'Not available right now.' : 'Available on the current menu.'}</p>${detailExtras(cafe, item)}</div>`;
    $('dialogClose')?.addEventListener('click', () => dialog.close());
    if (!dialog.open) dialog.showModal();
    if (push) history.pushState({ item: String(item.id) }, '', `#item-${encodeURIComponent(item.id)}`);
  };
  document.querySelector('.site-main')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-item]');
    if (!button) return;
    openItem(findItem(button.dataset.item), true);
  });
  dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog?.addEventListener('close', () => {
    if (location.hash.startsWith('#item-')) history.replaceState(null, '', location.pathname + location.search);
  });
  window.addEventListener('popstate', () => {
    const id = itemIdFromHash();
    if (!id) { if (dialog?.open) dialog.close(); return; }
    const item = findItem(id);
    if (item) openItem(item, false);
  });
  const initial = new URLSearchParams(location.search).get('item') || itemIdFromHash();
  if (initial) openItem(findItem(initial), false);
}

function itemIdFromHash() {
  if (!location.hash.startsWith('#item-')) return '';
  try { return decodeURIComponent(location.hash.slice(6)); } catch { return ''; }
}

markNav();
bindHeader();
const path = document.body.dataset.path || location.pathname;
if (path === '/' && (location.hash === '#menu' || location.hash.startsWith('#item-'))) {
  const id = itemIdFromHash();
  location.replace(id ? `/menu?item=${encodeURIComponent(id)}` : '/menu');
} else if (path === '/' || path === '/menu' || path === '/about-contact') {
  api(path === '/about-contact' ? '/api/public/cafe' : '/api/public/menu').then((data) => {
    if (path === '/') renderHome(data);
    else if (path === '/menu') renderMenu(data);
    else applyCafe(data.cafe);
  }).catch((error) => {
    const host = document.querySelector('.site-main');
    host?.insertAdjacentHTML('afterbegin', `<div class="wrap"><p class="notice">${esc(error.message)}</p></div>`);
  });
} else {
  api('/api/public/cafe').then((data) => applyCafe(data.cafe)).catch(() => {});
}
