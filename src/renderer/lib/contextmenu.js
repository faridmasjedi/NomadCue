// Lightweight context menu with nested submenus.
// item: { label, onClick, shortcut, checked, disabled, danger, icon, submenu: [items], swatches: [{ color, label, onClick, on }] }
//       or 'separator' / { heading: 'Text' }
import { h } from './dom.js';

let openRoot = null;

export function closeMenu() {
  if (!openRoot) return;
  openRoot.remove();
  openRoot = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
}

function onOutside(e) {
  if (openRoot && !openRoot.contains(e.target)) closeMenu();
}

function onKey(e) {
  if (!openRoot) return;
  const menus = [...openRoot.querySelectorAll('.cm')];
  const menu = menus[menus.length - 1];
  const items = [...menu.querySelectorAll(':scope > .cm-item:not(.disabled)')];
  const cur = items.indexOf(menu.querySelector(':scope > .cm-item.active'));
  const focus = (i) => { items.forEach((x) => x.classList.remove('active')); if (items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); } };
  e.stopPropagation();
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      if (menus.length > 1) menu.remove(); else closeMenu();
      break;
    case 'ArrowDown': e.preventDefault(); focus((cur + 1) % items.length); break;
    case 'ArrowUp': e.preventDefault(); focus((cur - 1 + items.length) % items.length); break;
    case 'ArrowRight': if (items[cur]?.classList.contains('has-sub')) { e.preventDefault(); items[cur].dispatchEvent(new Event('opensub')); } break;
    case 'ArrowLeft': if (menus.length > 1) { e.preventDefault(); menu.remove(); } break;
    case 'Enter': case ' ': e.preventDefault(); items[cur]?.click(); break;
    default: break;
  }
}

function place(el, x, y, parentRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (parentRect) {
    left = parentRect.right - 2;
    top = parentRect.top - 4;
    if (left + r.width > vw - 4) left = parentRect.left - r.width + 2;
  } else if (left + r.width > vw - 4) left = vw - r.width - 4;
  if (top + r.height > vh - 4) top = Math.max(4, vh - r.height - 4);
  el.style.left = Math.max(4, left) + 'px';
  el.style.top = Math.max(4, top) + 'px';
}

function buildMenu(items, depth) {
  const menu = h('div', { class: 'cm', dataset: { depth: String(depth) } });
  for (const it of items) {
    if (!it) continue;
    if (it === 'separator') { menu.appendChild(h('div', { class: 'cm-sep' })); continue; }
    if (it.heading) { menu.appendChild(h('div', { class: 'cm-heading' }, it.heading)); continue; }
    if (it.swatches) {
      menu.appendChild(h('div', { class: 'cm-swatches' }, it.swatches.map((s) => h('button', {
        class: `swatch c-${s.color}${s.on ? ' on' : ''}`, title: s.label || s.color,
        onClick: () => { closeMenu(); s.onClick(); },
      }))));
      continue;
    }
    const hasSub = Array.isArray(it.submenu) && it.submenu.length;
    const el = h('div', {
      class: ['cm-item', hasSub && 'has-sub', it.disabled && 'disabled', it.danger && 'danger'].filter(Boolean).join(' '),
      title: it.title || '',
    },
    h('span', { class: 'cm-check' }, it.checked ? '✓' : it.icon || ''),
    h('span', { class: 'cm-label' }, it.label),
    h('span', { class: 'cm-shortcut' }, hasSub ? '▸' : it.shortcut || ''));
    if (hasSub) {
      let timer = null;
      const openSub = () => {
        // close deeper menus from siblings
        [...openRoot.querySelectorAll('.cm')].filter((m) => Number(m.dataset.depth) > depth).forEach((m) => m.remove());
        menu.querySelectorAll('.cm-item.open').forEach((x) => x.classList.remove('open'));
        el.classList.add('open');
        const sub = buildMenu(it.submenu, depth + 1);
        openRoot.appendChild(sub);
        place(sub, 0, 0, el.getBoundingClientRect());
      };
      el.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(openSub, 120); });
      el.addEventListener('mouseleave', () => clearTimeout(timer));
      el.addEventListener('click', openSub);
      el.addEventListener('opensub', openSub);
    } else {
      el.addEventListener('mouseenter', () => {
        [...openRoot.querySelectorAll('.cm')].filter((m) => Number(m.dataset.depth) > depth).forEach((m) => m.remove());
        menu.querySelectorAll('.cm-item.open').forEach((x) => x.classList.remove('open'));
      });
      if (!it.disabled) el.addEventListener('click', () => { closeMenu(); it.onClick?.(); });
    }
    menu.appendChild(el);
  }
  return menu;
}

export function showMenu(x, y, items) {
  closeMenu();
  openRoot = h('div', { class: 'cm-root', onContextmenu: (e) => e.preventDefault() });
  document.body.appendChild(openRoot);
  const menu = buildMenu(items, 0);
  openRoot.appendChild(menu);
  place(menu, x, y);
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  }, 0);
}

export function isMenuOpen() { return !!openRoot; }
