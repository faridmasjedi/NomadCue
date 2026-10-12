// DMX-over-Ethernet output: Art-Net 4 (ArtDmx) and sACN / E1.31.
// Unlimited universes and addresses — no license gate.
const dgram = require('dgram');
const crypto = require('crypto');

function artDmxPacket(universe, data, sequence) {
  const header = Buffer.alloc(18);
  header.write('Art-Net\0', 0, 'ascii');
  header.writeUInt16LE(0x5000, 8); // OpDmx
  header.writeUInt16BE(14, 10); // protocol version
  header.writeUInt8(sequence & 0xff, 12);
  header.writeUInt8(0, 13); // physical
  header.writeUInt16LE(universe & 0x7fff, 14); // SubUni + Net
  header.writeUInt16BE(512, 16);
  const payload = Buffer.alloc(512);
  Buffer.from(data).copy(payload, 0, 0, 512);
  return Buffer.concat([header, payload]);
}

function sacnPacket(universe, data, sequence, cid, sourceName, priority = 100) {
  const buf = Buffer.alloc(638);
  // Root layer
  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  Buffer.from('ASC-E1.17\0\0\0', 'ascii').copy(buf, 4);
  buf.writeUInt16BE(0x7000 | (638 - 16), 16);
  buf.writeUInt32BE(0x00000004, 18);
  cid.copy(buf, 22);
  // Framing layer
  buf.writeUInt16BE(0x7000 | (638 - 38), 38);
  buf.writeUInt32BE(0x00000002, 40);
  Buffer.from(sourceName.slice(0, 63), 'utf8').copy(buf, 44);
  buf.writeUInt8(priority, 108);
  buf.writeUInt16BE(0, 109); // sync address
  buf.writeUInt8(sequence & 0xff, 111);
  buf.writeUInt8(0, 112); // options
  buf.writeUInt16BE(universe, 113);
  // DMP layer
  buf.writeUInt16BE(0x7000 | (638 - 115), 115);
  buf.writeUInt8(0x02, 117);
  buf.writeUInt8(0xa1, 118);
  buf.writeUInt16BE(0x0000, 119);
  buf.writeUInt16BE(0x0001, 121);
  buf.writeUInt16BE(513, 123);
  buf.writeUInt8(0, 125); // start code
  Buffer.from(data).copy(buf, 126, 0, 512);
  return buf;
}

class DmxOutput {
  constructor() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', (e) => console.error('[dmx]', e.message));
    this.socket.bind(() => {
      try { this.socket.setBroadcast(true); } catch (_) {}
    });
    this.seq = new Map();
    this.cid = crypto.randomBytes(16);
    this.config = { protocol: 'artnet', host: '255.255.255.255', universeOffset: 0, enabled: true };
  }

  configure(cfg) {
    this.config = { ...this.config, ...cfg };
  }

  // frames: { [universe]: number[512] }  (universe numbering starts at 1 in the UI)
  send(frames) {
    if (!this.config.enabled) return;
    for (const [u, data] of Object.entries(frames)) {
      const universe = Number(u) + Number(this.config.universeOffset || 0);
      const s = ((this.seq.get(universe) || 0) % 255) + 1;
      this.seq.set(universe, s);
      if (this.config.protocol === 'sacn') {
        const pkt = sacnPacket(universe, data, s, this.cid, 'NomadCue');
        const host = this.config.host && this.config.host !== '255.255.255.255'
          ? this.config.host
          : `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
        this.socket.send(pkt, 5568, host);
      } else {
        // Art-Net port-addresses are 0-based; UI universe 1 => Art-Net 0
        const pkt = artDmxPacket(Math.max(0, universe - 1), data, s);
        this.socket.send(pkt, 6454, this.config.host || '255.255.255.255');
      }
    }
  }
}

module.exports = { DmxOutput, artDmxPacket, sacnPacket };
