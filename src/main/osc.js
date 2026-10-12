// Minimal OSC 1.0 encoder/decoder (no dependencies).
// Supports int32 (i), float32 (f), string (s), blob (b), true (T), false (F), nil (N) and bundles.

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function encodeString(str) {
  const b = Buffer.from(String(str) + '\0', 'utf8');
  return Buffer.concat([b, Buffer.alloc(pad4(b.length))]);
}

function encodeArg(arg) {
  if (arg && typeof arg === 'object' && 'type' in arg) {
    const { type, value } = arg;
    switch (type) {
      case 'i': { const b = Buffer.alloc(4); b.writeInt32BE(value | 0); return ['i', b]; }
      case 'f': { const b = Buffer.alloc(4); b.writeFloatBE(Number(value)); return ['f', b]; }
      case 's': return ['s', encodeString(value)];
      case 'b': {
        const data = Buffer.from(value);
        const len = Buffer.alloc(4); len.writeInt32BE(data.length);
        return ['b', Buffer.concat([len, data, Buffer.alloc(pad4(data.length))])];
      }
      case 'T': return ['T', Buffer.alloc(0)];
      case 'F': return ['F', Buffer.alloc(0)];
      case 'N': return ['N', Buffer.alloc(0)];
      default: throw new Error('Unsupported OSC type ' + type);
    }
  }
  if (typeof arg === 'number') {
    return Number.isInteger(arg) ? encodeArg({ type: 'i', value: arg }) : encodeArg({ type: 'f', value: arg });
  }
  if (typeof arg === 'boolean') return encodeArg({ type: arg ? 'T' : 'F' });
  if (arg === null || arg === undefined) return encodeArg({ type: 'N' });
  if (Buffer.isBuffer(arg)) return encodeArg({ type: 'b', value: arg });
  return encodeArg({ type: 's', value: arg });
}

function encodeMessage(address, args = []) {
  const parts = args.map(encodeArg);
  const tags = ',' + parts.map((p) => p[0]).join('');
  return Buffer.concat([encodeString(address), encodeString(tags), ...parts.map((p) => p[1])]);
}

function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString('utf8', offset, end);
  const len = end - offset + 1;
  return [str, offset + len + pad4(len)];
}

function decodeMessage(buf, offset = 0, length = buf.length) {
  const stop = offset + length;
  let address;
  [address, offset] = readString(buf, offset);
  if (address === '#bundle') {
    offset += 8; // timetag (executed immediately)
    const elements = [];
    while (offset < stop) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      elements.push(...decodeMessage(buf, offset, size));
      offset += size;
    }
    return elements;
  }
  if (offset >= stop) return [{ address, args: [] }];
  let tags;
  [tags, offset] = readString(buf, offset);
  const args = [];
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i': args.push(buf.readInt32BE(offset)); offset += 4; break;
      case 'f': args.push(buf.readFloatBE(offset)); offset += 4; break;
      case 'd': args.push(buf.readDoubleBE(offset)); offset += 8; break;
      case 'h': args.push(Number(buf.readBigInt64BE(offset))); offset += 8; break;
      case 's': case 'S': { let s; [s, offset] = readString(buf, offset); args.push(s); break; }
      case 'b': {
        const n = buf.readInt32BE(offset); offset += 4;
        args.push(buf.subarray(offset, offset + n)); offset += n + pad4(n); break;
      }
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      default: break;
    }
  }
  return [{ address, args }];
}

// Parses "/foo/bar 1 2.5 hello "quoted string"" into an address and typed args.
function parseOscString(line) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) tokens.push(m[1] !== undefined ? { quoted: m[1] } : m[2]);
  const address = typeof tokens[0] === 'string' ? tokens.shift() : '/';
  const args = tokens.map((t) => {
    if (typeof t === 'object') return { type: 's', value: t.quoted };
    if (/^-?\d+$/.test(t)) return { type: 'i', value: parseInt(t, 10) };
    if (/^-?\d*\.\d+$/.test(t)) return { type: 'f', value: parseFloat(t) };
    if (t === 'true') return { type: 'T' };
    if (t === 'false') return { type: 'F' };
    return { type: 's', value: t };
  });
  return { address, args };
}

module.exports = { encodeMessage, decodeMessage, parseOscString };
