/** Travel order and the moving route marker come from the real shuttle state. */
export function metroDisplayRoute(count:number,current:number,next:number,progress=0) {
  const direction=Math.sign(next-current)||1;
  const stops=Array.from({length:count},(_,i)=>direction>0?i:count-1-i);
  const from=stops.indexOf(current),to=stops.indexOf(next);
  return {stops,terminus:stops[count-1],marker:from+(to-from)*Math.max(0,Math.min(1,progress)),direction};
}
