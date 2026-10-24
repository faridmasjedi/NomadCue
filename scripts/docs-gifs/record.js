// Records the documentation GIFs by driving the real app: it loads a demo workspace, moves a visible
// cursor, sends real mouse and keyboard events, captures frames and encodes them with ffmpeg.
//   npm run docs:gifs              record every scene
//   npm run docs:gifs -- go cart   record only the named scenes
// Needs ffmpeg on the PATH. Output: docs/assets/gifs/<scene>.gif
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const overlay = require('./overlay');
const scenes = require(process.env.NQ_SCENES || './scenes');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'gifs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'nomadcue-gifs-'));
const MEDIA = path.join(WORK, 'media');
const WIDTH = 1280, HEIGHT = 800; // window content size in CSS pixels
const FRAME_MS = 80;

// Keep the recording away from the user's real settings, and silent.
app.setPath('userData', path.join(WORK, 'userdata'));
app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function makeMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const m = (name) => path.join(MEDIA, name);
  // A soft chord for music, filtered noise for effects, a coloured test pattern for video.
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=40', '-f', 'lavfi', '-i', 'sine=f=277:d=40', '-f', 'lavfi', '-i', 'sine=f=330:d=40',
    '-filter_complex', 'amix=inputs=3,volume=0.6,afade=t=in:d=2,tremolo=f=0.5:d=0.6', m('preshow.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=6:c=brown:a=0.8', '-af', 'afade=t=in:d=0.05,afade=t=out:st=1:d=5', m('thunder.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=660:d=0.4', '-f', 'lavfi', '-i', 'sine=f=523:d=0.6', '-filter_complex', '[0][1]concat=n=2:v=0:a=1', m('doorbell.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-af', 'tremolo=f=20:d=1', m('phone.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=8:c=pink:a=0.5', '-af', 'tremolo=f=9:d=0.7,afade=t=out:st=5:d=3', m('applause.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=30:c=pink:a=0.3', '-af', 'lowpass=f=900', m('rain.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'gradients=s=1280x720:d=20:speed=0.02:c0=0x1a2a6c:c1=0x5b2a86:c2=0x0f3d3e:n=3', '-pix_fmt', 'yuv420p', m('storm.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x223344:s=1280x720:d=1', '-vf', 'drawbox=x=80:y=80:w=1120:h=560:color=0xffcc33@0.8:t=12', '-frames:v', '1', m('slide.png')]);
  return MEDIA;
}

// ---------------------------------------------------------------- driving the app

function driver(win) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code).catch((e) => {
    throw new Error(`page error: ${e?.message || String(e)} in ${code.slice(0, 100)}`);
  });
  let cursor = { x: WIDTH / 2, y: HEIGHT / 2 };

  async function pos(spec) {
    const p = await js(`__rec.find(${JSON.stringify(typeof spec === 'string' ? { sel: spec } : spec)})`);
    if (!p) throw new Error('Not found: ' + JSON.stringify(spec));
    return p;
  }
  async function move(spec, ms = 600) {
    const p = spec.x !== undefined && !spec.sel && !spec.text ? spec : await pos(spec);
    await js(`__rec.move(${p.x}, ${p.y}, ${ms})`);
    cursor = p;
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    await sleep(ms + 60);
    return p;
  }
  async function click(spec, { button = 'left', double = false, ms = 600 } = {}) {
    const p = await move(spec, ms);
    js(`__rec.ripple(${p.x}, ${p.y})`);
    if (button === 'right') {
      // Synthetic right-button presses don't raise `contextmenu`, so dispatch it where the cursor is.
      await js(`document.elementFromPoint(${p.x}, ${p.y}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${p.x}, clientY: ${p.y}, button: 2 }))`);
      await sleep(250);
      return;
    }
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button, clickCount: n });
      wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button, clickCount: n });
      if (double && n === 1) await sleep(60);
    }
    await sleep(250);
  }
  // keyCode uses Electron accelerator names: 'Space', 'Escape', 'Enter', 'Up', 'A'…
  async function key(keyCode, { modifiers = [], label, hold = 900 } = {}) {
    const names = { cmd: '⌘', shift: '⇧', alt: '⌥', control: '⌃' };
    const shown = label || [...modifiers.map((m) => names[m] || m), keyCode === 'Space' ? 'Space' : keyCode === 'Escape' ? 'Esc' : keyCode].join(' ');
    js(`__rec.keys(${JSON.stringify(shown.split(' '))}, ${hold})`);
    const mods = modifiers.map((m) => (m === 'cmd' ? 'meta' : m));
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods });
    if (keyCode === 'Space' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: ' ' });
    if (keyCode === 'Enter' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods });
    await sleep(200);
  }
  async function type(text, perChar = 70) {
    for (const ch of text) {
      if (ch === '\n') { await key('Enter', { hold: 0 }); continue; }
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
      await sleep(perChar);
    }
  }
  // Runs `fn` in the page with the app's own modules: fn({ app, ui, model, menus, settings, demo, media }).
  async function page(fn, arg) {
    const r = path.join(ROOT, 'src', 'renderer');
    const url = (p) => pathToFileURL(p).href;
    return js(`(async () => {
      const mods = {
        app: await import(${JSON.stringify(url(path.join(r, 'app.js')))}),
        model: await import(${JSON.stringify(url(path.join(r, 'lib', 'model.js')))}),
        menus: await import(${JSON.stringify(url(path.join(r, 'menus.js')))}),
        settings: await import(${JSON.stringify(url(path.join(r, 'settings.js')))}),
        demo: await import(${JSON.stringify(url(path.join(__dirname, 'demo.mjs')))}),
        media: ${JSON.stringify(MEDIA)},
      };
      try { return { ok: await (${fn.toString()})(mods, ${JSON.stringify(arg ?? null)}) }; }
      catch (e) { return { err: String((e && e.stack) || e) }; }
    })()`).then((r) => { if (r.err) throw new Error('page: ' + r.err); return r.ok; });
  }
  const ready = () => js(overlay);
  return { win, js, pos, move, click, key, type, page, sleep, ready, driver, WIDTH, HEIGHT, get cursor() { return cursor; } };
}

// ---------------------------------------------------------------- capture + encode

function startCapture(sources) {
  const frames = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t = Date.now();
      const shots = [];
      for (const s of sources) {
        if (s.win.isDestroyed()) { shots.push(null); continue; }
        const img = await s.win.webContents.capturePage(s.rect);
        shots.push(img.isEmpty() ? null : img.resize({ width: s.width, quality: 'best' }).toPNG());
      }
      frames.push({ t, shots });
      const left = FRAME_MS - (Date.now() - t);
      if (left > 0) await sleep(left);
    }
  })();
  return async () => { running = false; await loop; frames.push({ t: Date.now(), shots: frames[frames.length - 1]?.shots }); return frames; };
}

function encode(name, frames, sources, layout) {
  const dir = path.join(WORK, 'frames-' + name);
  fs.mkdirSync(dir, { recursive: true });
  const inputs = [];
  sources.forEach((src, si) => {
    let last = null;
    const list = [];
    frames.forEach((f, i) => {
      const png = f.shots[si] || last;
      if (!png) return;
      last = png;
      const file = path.join(dir, `s${si}-${String(i).padStart(5, '0')}.png`);
      fs.writeFileSync(file, png);
      const next = frames[i + 1];
      list.push(`file '${file}'`, `duration ${((next ? next.t : f.t + FRAME_MS) - f.t) / 1000}`);
    });
    const listFile = path.join(dir, `s${si}.txt`);
    fs.writeFileSync(listFile, list.join('\n') + '\n');
    inputs.push('-f', 'concat', '-safe', '0', '-i', listFile);
  });
  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, name + '.gif');
  // A second source (stage output or phone) is laid over the main window in a framed corner.
  const base = sources.length > 1
    ? `[1:v]pad=iw+8:ih+8:4:4:color=0x888888[o];[0:v][o]overlay=${layout || 'W-w-24:H-h-48'},fps=12.5`
    : '[0:v]fps=12.5';
  ffmpeg([...inputs, '-filter_complex',
    `${base},split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    out]);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------- main

app.on('browser-window-created', (_e, win) => {
  if (!global.__controlWin) {
    global.__controlWin = win;
    win.setContentSize(WIDTH, HEIGHT);
    win.center();
  }
});

require('../../src/main/main.js');

app.whenReady().then(async () => {
  makeMedia();
  while (!global.__controlWin) await sleep(50);
  const win = global.__controlWin;
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  const d = driver(win);
  await d.js('window.__nqReady');
  await d.ready();

  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-') && scenes[a]);
  const names = wanted.length ? wanted : Object.keys(scenes);
  for (const name of names) {
    const scene = scenes[name];
    console.log(`[gifs] ${name}…`);
    try {
      await d.page(({ demo, app: a, model, media }, opts) => demo.load(a, model, media, opts), scene.workspace || {});
      // The inspector remembers its last tab; start every scene on Basics.
      await d.page(async ({ app: a }) => {
        a.select(a.app.ws.lists[0].cues[0].id);
        [...document.querySelectorAll('#inspector .tab')].find((t) => t.textContent === 'Basics')?.click();
        a.select(null);
        document.activeElement?.blur();
      });
      await d.js(`document.querySelectorAll('.modal-overlay').forEach((m) => m.remove())`);
      await d.move({ x: WIDTH / 2 + 200, y: HEIGHT / 2 + 150 }, 0);
      if (scene.before) await scene.before(d);
      await sleep(400);
      const extra = scene.extra ? await scene.extra(d) : [];
      const sources = [{ win, width: scene.crop ? scene.crop.width : WIDTH, rect: scene.crop }, ...extra];
      const stop = startCapture(sources);
      await scene.run(d);
      const frames = await stop();
      const out = encode(name, frames, sources, scene.layout);
      console.log(`[gifs] ${name}: ${frames.length} frames → ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
      if (scene.after) await scene.after(d);
    } catch (e) {
      console.error(`[gifs] ${name} FAILED:`, e && (e.stack || e.message) || e);
      process.exitCode = 1;
    }
    for (const w of BrowserWindow.getAllWindows()) if (w !== win && !w.isDestroyed()) w.destroy();
    await d.page(({ app: a }) => { a.app.engine.hardStop(); });
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
