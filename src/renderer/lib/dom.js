// Tiny hyperscript helper.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function modal(title, body, { onClose, wide, actions } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { overlay.remove(); onClose?.(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  const overlay = h('div', { class: 'modal-overlay', onMousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', title: 'Close', onClick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions ? h('div', { class: 'modal-actions' }, actions(close)) : null));
  root.appendChild(overlay);
  document.addEventListener('keydown', esc, true);
  return close;
}

export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', danger } = {}) {
  return new Promise((resolve) => {
    let result = false;
    modal('NomadQlab', h('p', {}, message), {
      onClose: () => resolve(result),
      actions: (close) => [
        h('button', { onClick: close }, cancel),
        h('button', { class: danger ? 'danger' : 'primary', onClick: () => { result = true; close(); } }, ok),
      ],
    });
  });
}

export function toast(msg, ms = 2500) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// Modal replacement for window.prompt (unsupported in Electron). fields: [{ key, label, value }]
export function promptDialog(title, fields) {
  return new Promise((resolve) => {
    let result = null;
    const inputs = fields.map((f) => h('input', { value: f.value ?? '', type: f.type || 'text' }));
    const submit = (close) => { result = Object.fromEntries(fields.map((f, i) => [f.key, inputs[i].value])); close(); };
    let closeFn;
    const body = h('form', { class: 'form', onSubmit: (e) => { e.preventDefault(); submit(closeFn); } },
      fields.map((f, i) => h('label', { class: 'field' }, h('span', {}, f.label), inputs[i])),
      h('button', { type: 'submit', style: { display: 'none' } }));
    closeFn = modal(title, body, {
      onClose: () => resolve(result),
      actions: (close) => [h('button', { onClick: close }, 'Cancel'), h('button', { class: 'primary', onClick: () => submit(close) }, 'OK')],
    });
    setTimeout(() => inputs[0]?.select(), 0);
  });
}
