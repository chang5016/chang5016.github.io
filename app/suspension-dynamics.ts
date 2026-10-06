/** Metres and metres/second; substeps keep the spring stable across frame rates. */
export function stepDamper(position: number, velocity: number, target: number, seconds: number) {
  const duration = Math.min(.04, Math.max(0, seconds));
  const count = Math.max(1, Math.ceil(duration / .008));
  const dt = duration / count;
  target = Math.min(.08, Math.max(0, target));
  for (let i = 0; i < count; i++) {
    velocity += (196 * (target - position) - 21 * velocity) * dt;
    position += velocity * dt;
    if (position < 0) { position = 0; velocity = Math.max(0, velocity); }
    if (position > .08) { position = .08; velocity = Math.min(0, velocity); }
  }
  return { position, velocity };
}
