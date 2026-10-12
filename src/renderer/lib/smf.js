// Standard MIDI File (type 0/1) parser -> flat, time-sorted event list in seconds.
// Returns { events: [{ time, data: number[] }], duration }

export function parseMidiFile(arrayBuffer) {
  const d = new DataView(arrayBuffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0; let b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32();
  const format = u16();
  const ntracks = u16();
  const division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');

  const raw = []; // { tick, data, tempo? }
  for (let t = 0; t < ntracks && p < d.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0;
    let running = 0;
    while (p < end) {
      tick += vlq();
      let status = d.getUint8(p);
      if (status & 0x80) p++; else status = running;
      if (status === 0xff) {
        const type = d.getUint8(p++);
        const l = vlq();
        if (type === 0x51) raw.push({ tick, tempo: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        p += l;
      } else if (status === 0xf0 || status === 0xf7) {
        const l = vlq();
        const bytes = [0xf0];
        for (let i = 0; i < l; i++) bytes.push(d.getUint8(p + i));
        if (status === 0xf0) raw.push({ tick, data: bytes });
        p += l;
      } else {
        running = status;
        const hi = status & 0xf0;
        const n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        const bytes = [status];
        for (let i = 0; i < n; i++) bytes.push(d.getUint8(p++));
        raw.push({ tick, data: bytes });
      }
    }
    p = end;
  }
  raw.sort((a, b) => a.tick - b.tick || (a.tempo ? -1 : 0));

  let tempo = 500000;
  let lastTick = 0;
  let time = 0;
  const events = [];
  for (const e of raw) {
    time += ((e.tick - lastTick) * tempo) / division / 1e6;
    lastTick = e.tick;
    if (e.tempo) tempo = e.tempo; else events.push({ time, data: e.data });
  }
  return { format, events, duration: time };
}
