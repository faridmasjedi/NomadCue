// Injected into the app window while recording: a visible cursor, click ripples, a keycap badge
// for key presses, and a finder that turns a target description into screen coordinates.
module.exports = `(() => {
  if (window.__rec) return;
  const css = document.createElement('style');
  css.textContent = \`
    #rec-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none;
      transition: transform var(--rec-move, 600ms) cubic-bezier(.45,.05,.25,1); }
    #rec-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .rec-ripple { position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
      border: 3px solid #ffcc33; pointer-events: none; animation: rec-ripple 450ms ease-out forwards; }
    @keyframes rec-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    #rec-keys { position: fixed; z-index: 2147483647; left: 50%; bottom: 44px; transform: translateX(-50%); pointer-events: none;
      display: flex; gap: 8px; opacity: 0; transition: opacity 150ms; }
    #rec-keys.on { opacity: 1; }
    #rec-chip { position: absolute; left: 18px; top: 18px; white-space: nowrap; font: 600 13px/1 -apple-system, system-ui, sans-serif;
      color: #111; background: #ffcc33; border-radius: 6px; padding: 7px 10px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
    #rec-keys kbd { font: 600 22px/1 -apple-system, system-ui, sans-serif; color: #111; background: #fff; border-radius: 8px;
      padding: 10px 16px; box-shadow: 0 3px 0 #999, 0 6px 18px rgba(0,0,0,.5); }
  \`;
  document.head.appendChild(css);
  const cur = document.createElement('div');
  cur.id = 'rec-cursor';
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1 L2 18 L6.5 13.8 L9.6 20.5 L12.6 19.2 L9.6 12.6 L15.5 12.6 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const keys = document.createElement('div');
  keys.id = 'rec-keys';
  document.body.appendChild(keys);
  let keyTimer = null;

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__rec = {
    // spec: { sel, text, index, within } - text matches the element's trimmed textContent (substring).
    find(spec) {
      // { row: '3', col: 'c-post' } targets a column of the cue row numbered '3' (cells can be empty).
      if (spec.row !== undefined) {
        const row = [...document.querySelectorAll('#cuelist .rows .row')].find((r) => r.querySelector('.c-num')?.textContent.trim() === spec.row);
        if (!row) return null;
        row.scrollIntoView({ block: 'nearest' });
        const rr = row.getBoundingClientRect();
        const cr = (spec.col ? row.querySelector('.' + spec.col) : row.querySelector('.c-name')).getBoundingClientRect();
        return { x: Math.round(cr.left + Math.min(cr.width / 2, 60)), y: Math.round(rr.top + rr.height / 2) };
      }
      const root = spec.within ? document.querySelector(spec.within) : document;
      let els = [...root.querySelectorAll(spec.sel || '*')].filter(visible);
      if (spec.text) {
        const want = spec.text;
        els = els.filter((e) => e.textContent.trim().includes(want));
        // Prefer the innermost match so "Then:" finds the menu item, not the whole menu.
        els = els.filter((e) => ![...e.children].some((c) => els.includes(c)));
      }
      const el = els[spec.index || 0];
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const fx = spec.fx ?? 0.5, fy = spec.fy ?? 0.5;
      return { x: Math.round(r.left + r.width * fx), y: Math.round(r.top + r.height * fy) };
    },
    move(x, y, ms) {
      cur.style.setProperty('--rec-move', ms + 'ms');
      cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'rec-ripple';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 500);
    },
    // A file "chip" that follows the cursor, for showing a drag from the desktop.
    chip(text) {
      cur.querySelector('#rec-chip')?.remove();
      if (text) { const c = document.createElement('div'); c.id = 'rec-chip'; c.textContent = text; cur.appendChild(c); }
    },
    keys(list, ms) {
      keys.innerHTML = list.map((k) => '<kbd>' + k + '</kbd>').join('');
      keys.classList.add('on');
      clearTimeout(keyTimer);
      keyTimer = setTimeout(() => keys.classList.remove('on'), ms);
    },
  };
})()`;
