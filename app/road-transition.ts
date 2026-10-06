export function transitionWidth(distance: number, length: number, middle: number, start: number, end: number) {
  const taper = Math.min(90, length * .45);
  const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  if (distance < taper) return start + (middle - start) * smooth(distance / taper);
  if (distance > length - taper) return end + (middle - end) * smooth((length - distance) / taper);
  return middle;
}
