// Pixel rows measured from the existing 627px orthographic facade atlases.
// Separate street-level doors from upper-storey windows before repeating.
const ATLASES = [
  { ground: [474, 627], upper: [[365, 474], [259, 365], [153, 259], [47, 153]] },
  { ground: [490, 627], upper: [[345, 420], [270, 345], [194, 270], [118, 194], [43, 118]] },
  { ground: [431, 627], upper: [[255, 431], [4, 174]] },
  { ground: [539, 627], upper: [[433, 539], [330, 433], [226, 330], [123, 226], [20, 123]] },
];

export function facadeBands(base: number, top: number, groundHeight: number, style: number) {
  const atlas = ATLASES[((style % ATLASES.length) + ATLASES.length) % ATLASES.length];
  const bands: { bottom: number; top: number; lowerV: number; upperV: number; width: number }[] = [];
  let y = base;
  while (y < top - 0.001) {
    const ground = y < groundHeight - 0.001;
    const floor = ground ? -1 : Math.floor((y - groundHeight + 0.001) / 3.3);
    const start = ground ? 0 : groundHeight + floor * 3.3;
    const height = ground ? groundHeight : 3.3;
    const end = Math.min(top, start + height);
    const row = ground ? atlas.ground : atlas.upper[floor % atlas.upper.length];
    const low = 1 - row[1] / 627;
    const span = (row[1] - row[0]) / 627;
    bands.push({ bottom: y, top: end, lowerV: low + (y - start) / height * span,
      upperV: low + (end - start) / height * span, width: height / span });
    y = end;
  }
  return bands;
}
