// The workspace every documentation GIF starts from: a small but realistic show using real media files.
export function load(a, { createWorkspace, createCue }, media, opts = {}) {
  const f = (name) => `${media}/${name}`;
  const ws = createWorkspace();
  ws.name = 'The Harbour';
  ws.settings.osc.port = 0; // don't listen on the network while recording
  ws.settings.osc.textPort = 0;
  ws.settings.lighting.enabled = false;
  ws.settings.general.minGoInterval = 0;
  ws.settings.lighting.patch = [
    { id: 'p1', number: 1, name: 'front', type: 'dimmer', universe: 1, address: 1 },
    { id: 'p2', number: 2, name: 'back', type: 'dimmer', universe: 1, address: 2 },
    { id: 'p3', number: 3, name: 'side', type: 'dimmer', universe: 1, address: 3 },
    { id: 'p4', number: 4, name: 'wash', type: 'rgbw', universe: 1, address: 10 },
  ];
  ws.settings.stages[0].width = 640;
  ws.settings.stages[0].height = 360;

  const preshow = createCue('audio', { number: '1', name: 'Preshow music', file: f('preshow.wav'), color: 'blue', notes: 'Wait for the house to open' });
  const rain = createCue('audio', { number: '5', name: 'Rain', file: f('rain.wav'), level: -6 });
  const builders = {
    show: () => [
      preshow,
      createCue('fade', { number: '2', name: 'Fade out preshow', target: preshow.id, duration: 4, level: -60, stopTargetWhenDone: true, continueMode: 'auto-continue', postWait: 1 }),
      createCue('light', { number: '3', name: 'House to half', commands: 'front = 50\nback = 30', duration: 3 }),
      createCue('group', { number: '4', name: 'Storm', mode: 'all', color: 'green', children: [
        createCue('video', { number: '4.1', name: 'Projection: storm', file: f('storm.mp4'), stage: 'stage1' }),
        createCue('audio', { number: '4.2', name: 'Thunder', file: f('thunder.wav'), level: -3 }),
        createCue('light', { number: '4.3', name: 'Lightning wash', commands: 'wash.color = #8899ff', duration: 0.2 }),
      ] }),
      rain,
      createCue('text', { number: '6', name: 'Surtitle: Scene 2', text: 'Scene 2 — The Harbour', duration: 6, color: 'purple' }),
      createCue('stop', { number: '7', name: 'Stop rain', target: rain.id, fadeTime: 3 }),
      createCue('memo', { name: 'Interval — 15 minutes', color: 'yellow', flagged: true }),
    ],
    // Plain cues with no links, for showing how to connect them.
    plain: () => [
      preshow,
      createCue('audio', { number: '2', name: 'Doorbell', file: f('doorbell.wav') }),
      createCue('light', { number: '3', name: 'Lights up', commands: 'front = 80', duration: 2 }),
      createCue('audio', { number: '4', name: 'Thunder', file: f('thunder.wav') }),
      createCue('light', { number: '5', name: 'Blackout', commands: 'all = out', duration: 1 }),
    ],
    step: () => [
      createCue('memo', { number: '1', name: 'Top of scene' }),
      createCue('group', { number: '2', name: 'Phone call (one GO per step)', mode: 'step', color: 'green', children: [
        createCue('audio', { number: '2.1', name: 'Phone ring', file: f('phone.wav') }),
        createCue('light', { number: '2.2', name: 'Lamp on', commands: 'side = 70', duration: 1 }),
        createCue('audio', { number: '2.3', name: 'Doorbell', file: f('doorbell.wav') }),
      ] }),
      createCue('light', { number: '3', name: 'Blackout', commands: 'all = out', duration: 2 }),
    ],
    video: () => [
      createCue('video', { number: '1', name: 'Projection: storm', file: f('storm.mp4'), stage: 'stage1' }),
      createCue('video', { number: '2', name: 'Title slide', file: f('slide.png'), stage: 'stage1', imageDuration: 0 }),
      createCue('text', { number: '3', name: 'Surtitle', text: 'Scene 2 — The Harbour', duration: 0 }),
    ],
    script: () => [
      createCue('script', { number: '1', name: 'Start the storm', code: '' }),
      createCue('audio', { number: '2', name: 'Thunder', file: f('thunder.wav') }),
      createCue('light', { number: '3', name: 'Lightning', commands: 'wash.color = #8899ff', duration: 0.2 }),
    ],
  };
  ws.lists[0].name = 'Main Cue List';
  ws.lists[0].cues = builders[opts.variant || 'show']();
  ws.lists.push({ id: 'cart1', name: 'SFX Cart', kind: 'cart', cues: [
    createCue('audio', { number: 'S1', name: 'Doorbell', file: f('doorbell.wav'), hotkey: 'd', color: 'orange' }),
    createCue('audio', { number: 'S2', name: 'Phone ring', file: f('phone.wav'), hotkey: 'f', color: 'red' }),
    createCue('audio', { number: 'S3', name: 'Applause', file: f('applause.wav'), color: 'green' }),
    createCue('audio', { number: 'S4', name: 'Thunder', file: f('thunder.wav'), color: 'purple' }),
    createCue('audio', { number: 'S5', name: 'Rain', file: f('rain.wav'), color: 'blue' }),
  ] });
  if (opts.remote) Object.assign(ws.settings.remote, { enabled: true, port: 53199, passcode: '' });
  a.loadWorkspace(ws, null);
  a.select(null);
  return true;
}
