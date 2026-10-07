/* Reusable Tea Amo UI helpers. Markup stays in the page; these build the shared pieces. */
(function (global) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setPageHeader(title, context) {
    const heading = document.getElementById('pageTitle');
    if (heading && title) heading.textContent = title;
    const host = document.querySelector('.top-title');
    if (!host) return;
    let note = document.getElementById('pageContext');
    if (!note) {
      note = el('div', 'page-context');
      note.id = 'pageContext';
      host.appendChild(note);
    }
    if (context) note.textContent = context;
  }

  function metricCard(label, value, hint) {
    const card = el('div', 'card metric');
    card.appendChild(el('div', 'k', label));
    card.appendChild(el('div', 'v', value));
    if (hint) card.appendChild(el('div', 'sub', hint));
    return card;
  }

  function statusPill(text, kind) {
    return el('span', 'pill' + (kind ? ' pill-' + kind : ''), text);
  }

  function emptyState(title, hint) {
    const box = el('div', 'empty-state');
    box.appendChild(el('b', '', title));
    if (hint) box.appendChild(el('div', 'sub', hint));
    return box;
  }

  global.TeaUI = { el, setPageHeader, metricCard, statusPill, emptyState };
})(window);
