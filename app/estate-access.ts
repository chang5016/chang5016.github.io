type Point={x:number;z:number};
export type EstateAccessPoint=Point & {height:number;width:number};

/** Shared visible-road / collision profile, with level junction and gate landings. */
export function planEstateAccess(start:Point, gate:Point, floor:number, ground:(p:Point)=>number):EstateAccessPoint[]|null {
  const length=Math.hypot(gate.x-start.x,gate.z-start.z);
  const base=ground(start)+.082, firstLanding=6, lastLanding=3;
  const climb=length-firstLanding-lastLanding;
  if(climb<10 || 1.5*Math.abs(floor-base)/climb>.12)return null;
  const count=Math.ceil(length/2), result:EstateAccessPoint[]=[];
  for(let i=0;i<=count;i++) {
    const distance=length*i/count,t=distance/length;
    const blend=Math.max(0,Math.min(1,(distance-firstLanding)/climb));
    const height=base+(floor-base)*blend*blend*(3-2*blend);
    const point={x:start.x+(gate.x-start.x)*t,z:start.z+(gate.z-start.z)*t};
    // Bound earthworks; the caller grades the terrain to this shared road profile.
    if(distance>6 && Math.abs(height-.18-ground(point))>7.5)return null;
    result.push({...point,height,width:6.4+2.4*(1-Math.min(1,distance/6))**2});
  }
  return result;
}

export type EstateGrade={x:number;z:number;angle:number;floor:number;access:EstateAccessPoint[];halfWidth?:number;halfDepth?:number;padDepth?:number;pool?:{x:number;z:number;halfWidth:number;halfDepth:number;depth:number}};
export function estateGroundAt(point:Point,natural:number,estates:EstateGrade[]) {
  let height=natural;
  for(const estate of estates) {
    const dx=point.x-estate.x,dz=point.z-estate.z;
    if(Math.abs(dx)>140||Math.abs(dz)>140)continue;
    const c=Math.cos(estate.angle),s=Math.sin(estate.angle);
    const lx=c*dx-s*dz,lz=s*dx+c*dz;
    const outside=Math.max(Math.abs(lx)-(estate.halfWidth??17),Math.abs(lz)-(estate.halfDepth??15),0);
    if(outside<7) {const t=1-outside/7;const influence=t*t*(3-2*t);height+=(estate.floor-(estate.padDepth??1.65)-height)*influence;}
    if(estate.pool&&Math.abs(lx-estate.pool.x)<estate.pool.halfWidth&&Math.abs(lz-estate.pool.z)<estate.pool.halfDepth)height=Math.min(height,estate.floor-estate.pool.depth);
    const first=estate.access[0],last=estate.access[estate.access.length-1];
    const ax=last.x-first.x,az=last.z-first.z,length=Math.hypot(ax,az);
    const progress=((point.x-first.x)*ax+(point.z-first.z)*az)/(length*length);
    if(progress<=0||progress>=1)continue;
    const across=Math.abs((point.x-first.x)*az-(point.z-first.z)*ax)/length;
    if(across>=10||progress*length<5)continue;
    const sample=progress*(estate.access.length-1),i=Math.min(estate.access.length-2,Math.floor(sample)),t=sample-i;
    const road=estate.access[i].height*(1-t)+estate.access[i+1].height*t-.18;
    const blend=Math.max(0,Math.min(1,(10-across)/3))*Math.min(1,(progress*length-5)/2);
    height+=(road-height)*blend;
  }
  return height;
}
