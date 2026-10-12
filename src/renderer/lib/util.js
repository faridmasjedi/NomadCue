export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const MIN_DB = -60;

export function dbToGain(db) {
  if (db === null || db === undefined || db === '' || Number(db) <= MIN_DB) return 0;
  return Math.pow(10, Number(db) / 20);
}

export function gainToDb(g) {
  if (g <= 0) return -Infinity;
  return 20 * Math.log10(g);
}

export function formatTime(sec, showHours = false) {
  if (sec === null || sec === undefined || !isFinite(sec)) return '—';
  const neg = sec < 0;
  sec = Math.abs(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(2).padStart(5, '0');
  const body = h || showHours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
  return (neg ? '-' : '') + body;
}

// Accepts "1.5", "01:02.5", "1:02:03.25"
export function parseTime(str) {
  if (typeof str === 'number') return str;
  const s = String(str || '').trim();
  if (!s) return 0;
  const parts = s.split(':').map(Number);
  if (parts.some((p) => isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// Easing curves for fades. t in [0,1] -> [0,1]
export const CURVES = {
  linear: (t) => t,
  scurve: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  equalPower: (t) => Math.sin((t * Math.PI) / 2),
  exponential: (t) => t * t,
  logarithmic: (t) => Math.sqrt(t),
};

export function ease(curve, t) {
  return (CURVES[curve] || CURVES.scurve)(clamp(t, 0, 1));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function deepClone(o) {
  return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mediaUrl(absPath) {
  return 'media://local/' + encodeURIComponent(absPath);
}

export function basename(p) {
  return String(p || '').split(/[\\/]/).pop();
}

export function dirname(p) {
  const parts = String(p || '').split(/[\\/]/);
  parts.pop();
  return parts.join(p.includes('\\') && !p.includes('/') ? '\\' : '/');
}

// Next cue number after `n` that is not taken (numbers are strings, may be decimals or text).
export function nextCueNumber(existing, after) {
  const taken = new Set(existing.filter(Boolean).map(String));
  let base = parseFloat(after);
  if (isNaN(base)) {
    const nums = existing.map(parseFloat).filter((x) => !isNaN(x));
    base = nums.length ? Math.max(...nums) : 0;
  }
  let n = Math.floor(base) + 1;
  while (taken.has(String(n))) n++;
  return String(n);
}
