// Stage (video output) window: renders video/image/camera/text layers with geometry, opacity, blend modes,
// CSS video effects, crop masks, corner-pin warp and edge blending.
import { cornerPinMatrix } from '../renderer/lib/keystone.js';
import { ease, dbToGain } from '../renderer/lib/util.js';

const bridge = window.stageBridge;
const surface = document.getElementById('surface');
const layers = new Map();
let config = { id: new URLSearchParams(location.search).get('id') };
let seq = 0;

function filterString(f = {}) {
  const parts = [];
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  if (f.brightness !== undefined && f.brightness != 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== undefined && f.contrast != 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== undefined && f.saturate != 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  return parts.join(' ') || 'none';
}

function applyProps(L) {
  const p = L.props;
  const el = L.el;
  el.style.opacity = String(p.opacity);
  el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.scale}) rotate(${p.rotation}deg)`;
  el.style.mixBlendMode = p.blend || 'normal';
  el.style.filter = filterString(p.filters);
  const [t, r, b, l] = p.crop || [0, 0, 0, 0];
  el.style.clipPath = t || r || b || l ? `inset(${t}% ${r}% ${b}% ${l}%)` : 'none';
  if (L.media && L.media.style) L.media.style.objectFit = p.fit || 'contain';
  if (L.media && L.media.tagName === 'VIDEO' && L.volume !== undefined) L.media.volume = Math.min(1, dbToGain(L.volume));
}

function emit(type, layerId, extra = {}) { bridge.emit({ type, layerId, stageId: config.id, ...extra }); }

function play(cmd) {
  remove(cmd.layerId);
  const el = document.createElement('div');
  el.className = 'layer';
  el.style.zIndex = String((cmd.props.layer || 0) * 1000 + (++seq % 1000));
  const L = { id: cmd.layerId, el, props: { ...cmd.props }, kind: cmd.kind, volume: cmd.volume };
  const targetOpacity = L.props.opacity;
  if (cmd.props.fadeIn > 0) L.props.opacity = 0;

  if (cmd.kind === 'video') {
    const v = document.createElement('video');
    v.src = cmd.src;
    v.playsInline = true;
    v.preload = 'auto';
    v.playbackRate = cmd.rate || 1;
    L.media = v;
    L.startTime = cmd.startTime || 0;
    L.endTime = cmd.endTime || 0;
    L.loopsLeft = cmd.loops === 0 ? Infinity : Math.max(1, cmd.loops || 1);
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = L.startTime;
      emit('meta', L.id, { duration: v.duration });
      v.play().catch((e) => emit('error', L.id, { message: e.message }));
    });
    v.addEventListener('ended', () => passEnded(L));
    v.addEventListener('error', () => emit('error', L.id, { message: 'Cannot play ' + decodeURIComponent(cmd.src.split('/').pop()) }));
    el.appendChild(v);
  } else if (cmd.kind === 'image') {
    const img = document.createElement('img');
    img.src = cmd.src;
    img.onerror = () => emit('error', L.id, { message: 'Cannot load image' });
    L.media = img;
    if (cmd.imageDuration > 0) L.timer = setTimeout(() => emit('ended', L.id), cmd.imageDuration * 1000);
    el.appendChild(img);
  } else if (cmd.kind === 'camera') {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true;
    if (cmd.mirror) v.style.transform = 'scaleX(-1)';
    L.media = v;
    navigator.mediaDevices.getUserMedia({ video: cmd.deviceId ? { deviceId: { exact: cmd.deviceId } } : true, audio: false })
      .then((stream) => { L.stream = stream; if (!layers.has(L.id)) { stream.getTracks().forEach((t) => t.stop()); return; } v.srcObject = stream; v.play(); })
      .catch((e) => emit('error', L.id, { message: 'Camera: ' + e.message }));
    el.appendChild(v);
  } else if (cmd.kind === 'text') {
    const t = document.createElement('div');
    t.className = 'text';
    const s = cmd.style || {};
    t.textContent = cmd.text;
    Object.assign(t.style, { fontFamily: s.fontFamily, fontSize: s.fontSize + 'px', fontWeight: s.fontWeight, color: s.color, background: s.background, textAlign: s.align });
    el.style.justifyContent = s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center';
    el.appendChild(t);
  }
  layers.set(L.id, L);
  applyProps(L);
  surface.appendChild(el);
  if (cmd.props.fadeIn > 0) animate(L, { opacity: targetOpacity }, cmd.props.fadeIn, 'scurve');
}

function passEnded(L) {
  const v = L.media;
  if (L.loopsLeft > 1 && !L.devamped) {
    if (L.loopsLeft !== Infinity) L.loopsLeft--;
    v.currentTime = L.startTime;
    v.play();
  } else {
    emit('ended', L.id);
  }
}

// Precise slice end-points (endTime) & loop points
function tick() {
  for (const L of layers.values()) {
    if (L.kind === 'video' && L.endTime > 0 && L.media && !L.media.paused && L.media.currentTime >= L.endTime) {
      if (L.loopsLeft > 1 && !L.devamped) passEnded(L);
      else if (!L.endSent) { L.endSent = true; L.media.pause(); emit('ended', L.id); }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function animate(L, to, seconds, curve) {
  if (L.anim) cancelAnimationFrame(L.anim.raf);
  const from = { ...L.props, volume: L.volume, rate: L.media?.playbackRate };
  const start = performance.now();
  const step = () => {
    const t = seconds > 0 ? Math.min(1, (performance.now() - start) / (seconds * 1000)) : 1;
    const k = ease(curve, t);
    for (const key of Object.keys(to)) {
      const v = from[key] + (to[key] - from[key]) * k;
      if (key === 'volume') L.volume = v;
      else if (key === 'rate') { if (L.media && L.media.playbackRate !== undefined) L.media.playbackRate = Math.max(0.0625, v); }
      else L.props[key] = v;
    }
    applyProps(L);
    if (t < 1) L.anim.raf = requestAnimationFrame(step); else L.anim = null;
  };
  L.anim = { raf: requestAnimationFrame(step) };
}

function remove(id) {
  const L = layers.get(id);
  if (!L) return;
  clearTimeout(L.timer);
  if (L.anim) cancelAnimationFrame(L.anim.raf);
  if (L.media && L.media.tagName === 'VIDEO') { L.media.pause(); L.media.removeAttribute('src'); L.media.load(); }
  L.stream?.getTracks().forEach((t) => t.stop());
  L.el.remove();
  layers.delete(id);
}

bridge.onCmd((cmd) => {
  const L = layers.get(cmd.layerId);
  switch (cmd.cmd) {
    case 'play': play(cmd); break;
    case 'pause': if (L?.media?.pause) L.media.pause(); clearTimeout(L?.timer); break;
    case 'resume': if (L?.media?.play) L.media.play(); break;
    case 'devamp': if (L) L.devamped = true; break;
    case 'fade': if (L) animate(L, cmd.to, cmd.duration, cmd.curve); break;
    case 'stop': if (L) { if (cmd.fade > 0) animate(L, { opacity: 0, volume: -60 }, cmd.fade, 'scurve'); else remove(cmd.layerId); } break;
    case 'remove': remove(cmd.layerId); break;
    case 'clear': for (const id of [...layers.keys()]) remove(id); break;
    case 'identify': identify(cmd.on); break;
    default: break;
  }
});

function identify(on) {
  const el = document.getElementById('ident');
  el.style.display = on ? 'flex' : 'none';
  document.getElementById('identName').textContent = config.name || config.id;
  document.getElementById('identSize').textContent = `${window.innerWidth} × ${window.innerHeight}`;
}

function applyConfig() {
  document.title = `NomadCue Stage — ${config.name || config.id}`;
  document.body.style.background = config.background || '#000';
  const w = window.innerWidth;
  const h = window.innerHeight;
  surface.style.width = w + 'px';
  surface.style.height = h + 'px';
  if (config.warp && Array.isArray(config.corners) && config.corners.length === 4) {
    const pts = config.corners.map((c) => ({ x: c.x * w, y: c.y * h }));
    surface.style.transform = cornerPinMatrix(w, h, pts);
  } else {
    surface.style.transform = 'none';
  }
  document.querySelectorAll('.blend').forEach((e) => e.remove());
  const addBlend = (side, px) => {
    if (!px) return;
    const b = document.createElement('div');
    b.className = 'blend';
    b.style[side] = '0';
    b.style.width = px + 'px';
    b.style.background = `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, rgba(0,0,0,1), rgba(0,0,0,0))`;
    surface.appendChild(b);
  };
  addBlend('left', Number(config.blendLeft));
  addBlend('right', Number(config.blendRight));
}

bridge.onConfig((c) => { config = c; applyConfig(); });
window.addEventListener('resize', applyConfig);
document.addEventListener('dblclick', () => { document.body.style.cursor = document.body.style.cursor === 'default' ? 'none' : 'default'; });
