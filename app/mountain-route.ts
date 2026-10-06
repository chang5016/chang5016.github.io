type Point={x:number;z:number};
/** Circular-feeling, tangent-continuous fillets instead of kinked zig-zag road pieces. */
export function filletedMountainRoad(anchors:readonly Point[],spacing=5):Point[]{
  const out:Point[]=[{...anchors[0]}];
  const line=(to:Point)=>{const from=out[out.length-1],n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/spacing));for(let i=1;i<=n;i++)out.push({x:from.x+(to.x-from.x)*i/n,z:from.z+(to.z-from.z)*i/n});};
  for(let i=1;i<anchors.length-1;i++){
    const a=anchors[i-1],b=anchors[i],c=anchors[i+1],ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),cut=Math.min(42,ab*.42,bc*.42);
    const entry={x:b.x+(a.x-b.x)*cut/ab,z:b.z+(a.z-b.z)*cut/ab},exit={x:b.x+(c.x-b.x)*cut/bc,z:b.z+(c.z-b.z)*cut/bc};line(entry);
    const n=Math.max(6,Math.ceil(cut*2/spacing));for(let j=1;j<=n;j++){const t=j/n,q=1-t;out.push({x:q*q*entry.x+2*q*t*b.x+t*t*exit.x,z:q*q*entry.z+2*q*t*b.z+t*t*exit.z});}
  }
  line(anchors[anchors.length-1]);return out;
}
export const MOUNTAIN_ROAD_ANCHORS=[{x:1200,z:460},{x:1270,z:460},{x:1350,z:390},{x:1440,z:390},{x:1490,z:470},{x:1480,z:560},{x:1380,z:650},{x:1420,z:735},{x:1550,z:750},{x:1650,z:680},{x:1620,z:600},{x:1550,z:560},{x:1530,z:510},{x:1590,z:510}] as const;
export const MOUNTAIN_VALLEY_ANCHORS=[{x:2210,z:510},{x:2250,z:510},{x:2290,z:550},{x:2290,z:650},{x:2240,z:725},{x:2170,z:750},{x:2110,z:710},{x:2070,z:785},{x:2190,z:845},{x:2150,z:930},{x:2010,z:920},{x:1920,z:850},{x:1880,z:760}] as const;
export const MOUNTAIN_ROAD_POINTS=filletedMountainRoad(MOUNTAIN_ROAD_ANCHORS);
export const MOUNTAIN_VALLEY_POINTS=filletedMountainRoad(MOUNTAIN_VALLEY_ANCHORS);
