// One entry per GIF. `workspace` picks a demo variant (demo.mjs); `run` is what gets recorded.
// `extra` returns more windows to capture (stage output, phone remote), laid over the main window.
const { BrowserWindow } = require('electron');

const rowOf = (num) => ({ row: num });
const colOf = (_d, num, col) => ({ row: num, col });
const item = (text) => ({ sel: '.cm-item', text });

function newWindow(d, opts, url) {
  const win = new BrowserWindow({ show: true, ...opts, webPreferences: { backgroundThrottling: false } });
  return win.loadURL(url).then(() => win);
}

module.exports = {
  go: {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(700);
      await d.key('Space');
      await d.sleep(2200);
      await d.key('Space');
      await d.sleep(4500);
      await d.key('Space');
      await d.sleep(2500);
      await d.key('Space');
      await d.sleep(1500);
    },
  },

  'add-cues': {
    workspace: { variant: 'plain' },
    async before(d) {
      await d.page(({ app: a }) => { const l = a.app.ws.lists[0]; l.cues = l.cues.slice(0, 1); a.render(); });
    },
    async run(d) {
      await d.move({ x: 60, y: 700 }, 0);
      await d.js(`__rec.chip('thunder.wav  ·  rain.wav')`);
      await d.sleep(500);
      await d.js(`document.body.classList.add('dropping')`);
      await d.move({ x: 700, y: 300 }, 1100);
      await d.sleep(300);
      await d.js(`__rec.chip(null); document.body.classList.remove('dropping')`);
      await d.page(({ app: a, media }) => a.addFiles([`${media}/thunder.wav`, `${media}/rain.wav`]));
      await d.sleep(1300);
      await d.click({ sel: '#toolbar .tool', text: 'Light' });
      await d.sleep(700);
      await d.click({ sel: '#inspector .tab', text: 'Levels' });
      await d.sleep(400);
      await d.click({ sel: '#inspector textarea' });
      await d.type('front = 75\nwash.color = #ff8800', 60);
      await d.sleep(1600);
    },
  },

  'context-menu': {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(300);
      await d.click(rowOf('1'), { button: 'right' });
      await d.sleep(600);
      await d.move(item('Then:'), 500);
      await d.sleep(900);
      await d.move(item('Pre-wait'), 400);
      await d.sleep(800);
      await d.move(item('Fades'), 400);
      await d.sleep(900);
      await d.move(item('Move up'), 500);
      await d.sleep(700);
      await d.move(item('Duplicate'), 500);
      await d.sleep(800);
      await d.key('Escape');
      await d.sleep(500);
    },
  },

  transitions: {
    workspace: { variant: 'plain' },
    async run(d) {
      await d.sleep(400);
      await d.click(colOf(d, '2', 'c-cont'));
      await d.sleep(700);
      await d.click(item('Start next when done'));
      await d.sleep(900);
      await d.click(colOf(d, '4', 'c-cont'));
      await d.sleep(700);
      await d.click(item('Start next with this'));
      await d.sleep(900);
      await d.click(colOf(d, '2', 'c-name'));
      await d.sleep(800);
      await d.move({ sel: '#inspector .section', text: 'Timing & transition' }, 600);
      await d.sleep(2200);
    },
  },

  waits: {
    workspace: { variant: 'plain' },
    async run(d) {
      await d.sleep(400);
      await d.click(colOf(d, '1', 'c-post'), { double: true });
      await d.sleep(400);
      await d.type('2');
      await d.key('Enter');
      await d.sleep(1000);
      await d.click(colOf(d, '3', 'c-pre'), { double: true });
      await d.sleep(400);
      await d.type('1.5');
      await d.key('Enter');
      await d.sleep(800);
      await d.click(colOf(d, '1', 'c-name'));
      await d.sleep(2200);
    },
  },

  crossfade: {
    workspace: { variant: 'plain' },
    async run(d) {
      await d.sleep(400);
      await d.click(rowOf('1'), { button: 'right' });
      await d.sleep(500);
      await d.move(item('Fades'), 500);
      await d.sleep(500);
      await d.click(item('Crossfade into next cue (3 s)'));
      await d.sleep(1000);
      await d.click(colOf(d, '1', 'c-name'));
      await d.key('Space');
      await d.sleep(2000);
      await d.key('Space');
      await d.sleep(3800);
    },
  },

  groups: {
    workspace: { variant: 'step' },
    async run(d) {
      await d.sleep(600);
      for (let i = 0; i < 5; i++) {
        await d.key('Space');
        await d.sleep(1500);
      }
      await d.sleep(600);
    },
  },

  audio: {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(300);
      await d.click(rowOf('1'));
      await d.sleep(1600);
      for (const tab of ['Time & Loops', 'Levels', 'Audio Effects']) {
        await d.click({ sel: '#inspector .tab', text: tab }).catch(() => {});
        await d.sleep(1500);
      }
      await d.click({ sel: '#inspector .tab', text: 'Basics' });
      await d.sleep(500);
      await d.key('V');
      await d.sleep(2500);
    },
  },

  video: {
    workspace: { variant: 'video' },
    async extra(d) {
      await d.page(({ app: a }) => a.app.video.openStage(a.app.ws.settings.stages[0]));
      let stage = null;
      for (let i = 0; i < 50 && !stage; i++) { await d.sleep(100); stage = BrowserWindow.getAllWindows().find((w) => w !== d.win); }
      stage.setContentSize(640, 360);
      await d.sleep(800);
      return [{ win: stage, width: 480 }];
    },
    layout: 'W-w-24:H-h-40',
    async run(d) {
      await d.sleep(500);
      await d.key('Space');
      await d.sleep(2500);
      await d.key('Space');
      await d.sleep(2000);
      await d.key('Space');
      await d.sleep(2500);
    },
  },

  lighting: {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(300);
      await d.click('#lightsBtn');
      await d.sleep(800);
      await d.click({ sel: '.dashboard input.mono' });
      await d.type('front = 75\n', 55);
      await d.sleep(500);
      await d.type('2 thru 3 = 40\n', 55);
      await d.sleep(500);
      await d.type('wash.color = #ff8800\n', 55);
      await d.sleep(1200);
      await d.click({ sel: '.dashboard button', text: 'Fade out 3s' });
      await d.sleep(3200);
    },
  },

  cart: {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(300);
      await d.click({ sel: '#lists .list-name', text: 'SFX Cart' });
      await d.sleep(800);
      await d.click({ sel: '.cart-grid .tile', text: 'Doorbell' });
      await d.sleep(900);
      await d.click({ sel: '.cart-grid .tile', text: 'Applause' });
      await d.sleep(900);
      await d.key('F');
      await d.sleep(2200);
    },
  },

  panic: {
    workspace: { variant: 'show' },
    async before(d) {
      await d.page(async ({ app: a }) => { a.go(); await new Promise((r) => setTimeout(r, 300)); a.go(); });
      await d.sleep(4500);
      await d.page(async ({ app: a }) => { a.go(); });
      await d.sleep(800);
    },
    async run(d) {
      await d.sleep(800);
      await d.key('Escape', { hold: 1500 });
      await d.sleep(2800);
    },
  },

  script: {
    workspace: { variant: 'script' },
    async run(d) {
      await d.sleep(300);
      await d.click(rowOf('1'));
      await d.sleep(600);
      await d.click({ sel: '#inspector .tab', text: 'Script' });
      await d.sleep(400);
      await d.click({ sel: '#inspector textarea' });
      await d.type("nq.log('Storm begins');\nnq.start('2');\nawait nq.wait(1);\nnq.light('wash = full', 0.2);", 40);
      await d.sleep(600);
      await d.click(rowOf('1'));
      await d.key('Space');
      await d.sleep(2500);
    },
  },

  settings: {
    workspace: { variant: 'show' },
    async run(d) {
      await d.sleep(300);
      await d.click('#settingsBtn');
      await d.sleep(900);
      for (const tab of ['Audio', 'Video Stages', 'Lighting', 'OSC / Network', 'MIDI', 'Remote']) {
        await d.click({ sel: '.settings-nav .tab', text: tab });
        await d.sleep(1300);
      }
    },
    async after(d) { await d.key('Escape'); },
  },

  remote: {
    workspace: { variant: 'show', remote: true },
    async extra(d) {
      await d.sleep(500);
      const [x, y] = d.win.getPosition();
      const phone = await newWindow(d, { width: 360, height: 700, x: x + 900, y }, 'http://localhost:53199/');
      d.phone = d.driver(phone);
      await d.phone.ready();
      await d.sleep(800);
      return [{ win: phone, width: 300 }];
    },
    layout: 'W-w-24:H-h-30',
    async run(d) {
      const p = d.phone;
      await d.sleep(800);
      await p.click('#go');
      await d.sleep(2500);
      await p.click('#go');
      await d.sleep(3000);
      await p.click({ sel: '.cue button', text: 'Fire', index: 5 });
      await d.sleep(2000);
      await p.click('#panic');
      await d.sleep(2000);
    },
  },
};
