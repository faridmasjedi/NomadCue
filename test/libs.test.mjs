import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseLightCommands, resolveLightCommands } from '../src/renderer/lib/lightcmd.js';
import { parseMidiFile } from '../src/renderer/lib/smf.js';
import { buildMidiMessage, buildMscMessage, parseMscMessage, normalizeWorkspace, createCue, cueAfterSequence, cloneCue, neverEnds } from '../src/renderer/lib/model.js';
import { parseTime, formatTime, dbToGain, nextCueNumber } from '../src/renderer/lib/util.js';
const require = createRequire(import.meta.url);
const { encodeMessage, decodeMessage, parseOscString } = require('../src/main/osc.js');
const { artDmxPacket, sacnPacket } = require('../src/main/dmx.js');

test('OSC round trip', () => {
  const buf = encodeMessage('/cue/3/start', [1, 2.5, 'hi', true]);
  const [m] = decodeMessage(buf);
  assert.equal(m.address, '/cue/3/start');
  assert.equal(m.args[0], 1); assert.equal(m.args[1], 2.5); assert.equal(m.args[2], 'hi'); assert.equal(m.args[3], true);
  const p = parseOscString('/foo 1 2.5 "a b" x');
  assert.deepEqual(p.args.map((a) => a.value), [1, 2.5, 'a b', 'x']);
});

test('Art-Net and sACN packets', () => {
  const data = new Array(512).fill(0); data[0] = 255;
  const a = artDmxPacket(0, data, 1);
  assert.equal(a.length, 530); assert.equal(a.toString('ascii', 0, 7), 'Art-Net'); assert.equal(a[18], 255);
  const s = sacnPacket(1, data, 1, Buffer.alloc(16), 'x');
  assert.equal(s.length, 638); assert.equal(s[126], 255); assert.equal(s.readUInt16BE(113), 1);
});

test('lighting command language', () => {
  const patch = [
    { id: 'a', number: 1, name: 'front', params: ['intensity'] },
    { id: 'b', number: 2, name: 'back', params: ['intensity'] },
    { id: 'c', number: 3, name: 'wash', params: ['red', 'green', 'blue'] },
  ];
  const { commands, errors } = parseLightCommands('1 thru 2 = full\nwash.color = #ff0000\n# comment\nback = 25');
  assert.deepEqual(errors, []);
  const r = resolveLightCommands(commands, patch);
  assert.equal(r['a.intensity'], 100); assert.equal(r['b.intensity'], 25);
  assert.equal(r['c.red'], 100); assert.equal(r['c.green'], 0);
  assert.equal(parseLightCommands('nonsense').errors.length, 1);
});

test('MIDI file parser', () => {
  const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00];
  const { events, duration } = parseMidiFile(new Uint8Array(bytes).buffer);
  assert.equal(events.length, 2);
  assert.ok(Math.abs(duration - 0.5) < 1e-9);
});

test('MIDI/MSC messages', () => {
  assert.deepEqual(buildMidiMessage({ msgType: 'noteOn', channel: 2, number: 60, value: 100 }), [0x91, 60, 100]);
  const msc = buildMscMessage({ mscDeviceId: 1, mscFormat: 1, mscCommand: 'go', mscCue: '12.5', mscList: '' });
  assert.deepEqual(parseMscMessage(msc), { deviceId: 1, format: 1, command: 'go', cue: '12.5' });
});

test('utils', () => {
  assert.equal(parseTime('1:02.5'), 62.5);
  assert.equal(formatTime(62.5), '01:02.50');
  assert.equal(dbToGain(-60), 0); assert.equal(dbToGain(0), 1);
  assert.equal(nextCueNumber(['1', '2', '3'], '1'), '4');
});

test('model helpers', () => {
  const ws = normalizeWorkspace({ lists: [{ name: 'x', cues: [{ type: 'audio', number: '1' }] }] });
  assert.equal(ws.lists[0].cues[0].level, 0);
  assert.equal(ws.settings.osc.port, 53000);
  const a = createCue('memo', { continueMode: 'auto-continue' }); const b = createCue('memo'); const c = createCue('memo');
  assert.equal(cueAfterSequence([a, b, c], a.id), c);
  const g = createCue('group', { children: [createCue('memo')] });
  g.children.push(createCue('start', { target: g.children[0].id }));
  const copy = cloneCue(g);
  assert.notEqual(copy.id, g.id); assert.equal(copy.children[1].target, copy.children[0].id);
});

test('neverEnds detects cues that can never auto-follow', () => {
  assert.equal(neverEnds(createCue('text', { duration: 0 })), true);
  assert.equal(neverEnds(createCue('text', { duration: 5 })), false);
  assert.equal(neverEnds(createCue('audio', { loops: 0 })), true);
  assert.equal(neverEnds(createCue('audio', { loops: 2 })), false);
  assert.equal(neverEnds(createCue('video', { file: '/a.png', imageDuration: 0 })), true);
  assert.equal(neverEnds(createCue('video', { file: '/a.mp4' })), false);
  assert.equal(neverEnds(createCue('camera')), true);
  assert.equal(neverEnds(createCue('light')), false);
  assert.equal(neverEnds(createCue('group', { mode: 'all', children: [createCue('mic')] })), true);
});
