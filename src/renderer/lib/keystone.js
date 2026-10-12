// Corner-pin (keystone / projection warp) via CSS matrix3d.
// Maps the unit rectangle of size w×h onto 4 destination corners [tl, tr, br, bl] ({x,y} in px).

function adj(m) {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

function multmm(a, b) {
  const c = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j];
    c[3 * i + j] = s;
  }
  return c;
}

function multmv(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function basisToPoints(x1, y1, x2, y2, x3, y3, x4, y4) {
  const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
  const v = multmv(adj(m), [x4, y4, 1]);
  return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

export function cornerPinMatrix(w, h, corners) {
  const [tl, tr, br, bl] = corners;
  const s = basisToPoints(0, 0, w, 0, 0, h, w, h);
  const d = basisToPoints(tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y);
  const t = multmm(d, adj(s));
  for (let i = 0; i < 9; i++) t[i] = t[i] / t[8];
  return `matrix3d(${[t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]].join(',')})`;
}
