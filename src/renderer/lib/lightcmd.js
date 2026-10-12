// Lighting Command Language (one command per line), inspired by text-based console syntax:
//
//   front = 75                 set every parameter of the instrument/group named "front" (intensity)
//   1 = 50                     instruments by number
//   1 thru 6 = full            ranges ("thru"/"through"/"-"), "full" = 100, "out" = 0
//   1 + 3 + 5 = 40             lists
//   wash.red = 100             one parameter
//   wash.color = #ff8800       colour shortcut for instruments with red/green/blue params
//   all = out                  every patched instrument
//
// Values are percentages 0-100. Returns { commands: [{ selector, param, value }], errors: [] }.

const NAMED = { full: 100, out: 0, half: 50, off: 0 };

function parseValue(raw) {
  const v = raw.trim().toLowerCase();
  if (v in NAMED) return NAMED[v];
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return {
      red: (parseInt(v.slice(1, 3), 16) / 255) * 100,
      green: (parseInt(v.slice(3, 5), 16) / 255) * 100,
      blue: (parseInt(v.slice(5, 7), 16) / 255) * 100,
    };
  }
  const n = parseFloat(v.replace('%', ''));
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function parseSelector(raw) {
  const s = raw.trim();
  if (/^all$/i.test(s)) return { all: true };
  const items = [];
  for (const part of s.split(/\s*\+\s*|\s*,\s*/)) {
    const range = /^(\d+)\s*(?:thru|through|-)\s*(\d+)$/i.exec(part);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) items.push(String(i));
    } else if (part) {
      items.push(part);
    }
  }
  return { items };
}

export function parseLightCommands(text) {
  const commands = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const clean = line.replace(/\/\/.*$|#(?![0-9a-f]{6}\b).*$/i, '').trim();
    if (!clean) return;
    const m = /^(.+?)\s*(?:=|@|\bat\b)\s*(.+)$/i.exec(clean);
    if (!m) { errors.push(`Line ${i + 1}: expected "target = value"`); return; }
    let left = m[1].trim();
    let param = null;
    const dot = /^(.*)\.([a-z0-9_]+)$/i.exec(left);
    if (dot && !/^\d+(\.\d+)?$/.test(left)) { left = dot[1]; param = dot[2].toLowerCase(); }
    const value = parseValue(m[2]);
    if (value === null) { errors.push(`Line ${i + 1}: bad value "${m[2]}"`); return; }
    if (param === 'color' && typeof value !== 'object') { errors.push(`Line ${i + 1}: color needs #rrggbb`); return; }
    commands.push({ selector: parseSelector(left), param: param === 'color' ? null : param, value });
  });
  return { commands, errors };
}

// Resolve parsed commands against a patch into a flat { "instrumentId.param": percent } map.
export function resolveLightCommands(commands, patch, groups = []) {
  const out = {};
  const byKey = (key) => {
    const k = String(key).toLowerCase();
    const group = groups.find((g) => g.name.toLowerCase() === k);
    if (group) return patch.filter((p) => group.members.includes(p.id));
    return patch.filter((p) => String(p.number) === key || p.name.toLowerCase() === k || p.id === key);
  };
  for (const cmd of commands) {
    const instruments = cmd.selector.all ? patch : cmd.selector.items.flatMap(byKey);
    for (const inst of instruments) {
      const params = inst.params || ['intensity'];
      if (typeof cmd.value === 'object') {
        for (const [p, v] of Object.entries(cmd.value)) if (params.includes(p)) out[`${inst.id}.${p}`] = v;
      } else if (cmd.param) {
        if (params.includes(cmd.param)) out[`${inst.id}.${cmd.param}`] = cmd.value;
      } else {
        // bare value: intensity if present, otherwise all colour params (so RGB fixtures dim like a dimmer)
        const targets = params.includes('intensity') ? ['intensity'] : params.filter((p) => ['red', 'green', 'blue', 'white', 'amber'].includes(p));
        for (const p of targets) out[`${inst.id}.${p}`] = cmd.value;
      }
    }
  }
  return out;
}

// Fixture types: parameters are mapped to consecutive DMX channels starting at the patched address.
export const FIXTURE_TYPES = {
  dimmer: { label: 'Dimmer', params: ['intensity'] },
  rgb: { label: 'RGB', params: ['red', 'green', 'blue'] },
  rgbw: { label: 'RGBW', params: ['red', 'green', 'blue', 'white'] },
  irgb: { label: 'Intensity + RGB', params: ['intensity', 'red', 'green', 'blue'] },
  irgbw: { label: 'Intensity + RGBW', params: ['intensity', 'red', 'green', 'blue', 'white'] },
  rgbwa: { label: 'RGBWA', params: ['red', 'green', 'blue', 'white', 'amber'] },
  movingHead: { label: 'Moving head (basic)', params: ['pan', 'tilt', 'intensity', 'red', 'green', 'blue'] },
};
