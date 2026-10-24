// Guide dashboard: one <section class="tab"> per feature, chosen from the sidebar or the URL hash.
(function () {
  const tabs = [...document.querySelectorAll('.tab')];
  const links = [...document.querySelectorAll('.side a[href^="#"]')];
  const side = document.querySelector('.side');
  const ids = tabs.map((t) => t.id);

  function show(id, scroll) {
    if (!ids.includes(id)) id = ids[0];
    for (const t of tabs) t.classList.toggle('on', t.id === id);
    for (const a of links) a.classList.toggle('on', a.getAttribute('href') === '#' + id);
    const tab = document.getElementById(id);
    document.title = tab.querySelector('h1').textContent + ' · NomadCue Guide';
    side.classList.remove('open');
    if (scroll) window.scrollTo({ top: 0 });
    // Keep the active link visible inside the sidebar without scrolling the page.
    const on = links.find((a) => a.classList.contains('on'));
    if (on && (on.offsetTop < side.scrollTop || on.offsetTop > side.scrollTop + side.clientHeight - 40)) side.scrollTop = on.offsetTop - 80;
  }

  // Previous / next links at the bottom of each tab, in sidebar order.
  tabs.forEach((tab, i) => {
    const pager = document.createElement('nav');
    pager.className = 'pager';
    const link = (t, cls, label) => {
      const a = document.createElement('a');
      a.href = '#' + t.id;
      a.className = cls;
      a.innerHTML = `<small>${label}</small>${t.querySelector('h1').textContent}`;
      return a;
    };
    if (tabs[i - 1]) pager.appendChild(link(tabs[i - 1], 'prev', '← Previous'));
    if (tabs[i + 1]) pager.appendChild(link(tabs[i + 1], 'next', 'Next →'));
    tab.appendChild(pager);
  });

  window.addEventListener('hashchange', () => show(location.hash.slice(1), true));
  show(location.hash.slice(1), true);

  // Search filters the sidebar by each tab's title and text.
  const search = document.getElementById('search');
  const none = document.querySelector('.side .none');
  const text = Object.fromEntries(tabs.map((t) => [t.id, t.textContent.toLowerCase()]));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    for (const a of links) {
      const hit = !q || text[a.getAttribute('href').slice(1)].includes(q);
      a.classList.toggle('hidden', !hit);
      any = any || hit;
    }
    for (const h of document.querySelectorAll('.side h4')) {
      let el = h.nextElementSibling, visible = false;
      while (el && el.tagName === 'A') { if (!el.classList.contains('hidden')) visible = true; el = el.nextElementSibling; }
      h.classList.toggle('hidden', !visible);
    }
    none.style.display = any ? 'none' : 'block';
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = links.find((a) => !a.classList.contains('hidden')); if (first) location.hash = first.getAttribute('href'); }
  });

  document.querySelector('.menu-toggle').addEventListener('click', () => side.classList.toggle('open'));
})();
