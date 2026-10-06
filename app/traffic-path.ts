type Point = {x:number;z:number};
export type TrafficPath = {
  points:Point[]; width:number; length:number;
  heightAt?:(distance:number)=>number;
  laneCentered?:boolean;
  district?:'city'|'highway'|'mountain';
  preferredExit?:TrafficPath;
  endpointTangents?:{start:Point;end:Point};
  destination?:{route:TrafficPath;direction:1|-1;progress:number};
};
type Stations = {distance:Float64Array;tx:Float64Array;tz:Float64Array;closed:boolean};
const stations = new WeakMap<TrafficPath,Stations>();
export function trafficStations(route:TrafficPath) {
  let cached=stations.get(route);if(cached)return cached;
  const n=route.points.length,distance=new Float64Array(n),tx=new Float64Array(n),tz=new Float64Array(n);
  const closed=n>2&&Math.hypot(route.points[0].x-route.points[n-1].x,route.points[0].z-route.points[n-1].z)<.5;
  for(let i=0;i<n;i++) {
    if(i)distance[i]=distance[i-1]+Math.hypot(route.points[i].x-route.points[i-1].x,route.points[i].z-route.points[i-1].z);
    const p=route.points[i],a=route.points[i===0&&closed?n-2:Math.max(0,i-1)],b=route.points[i===n-1&&closed?1:Math.min(n-1,i+1)];
    const la=Math.hypot(p.x-a.x,p.z-a.z)||1,lb=Math.hypot(b.x-p.x,b.z-p.z)||1;
    let vx=(p.x-a.x)/la+(b.x-p.x)/lb,vz=(p.z-a.z)/la+(b.z-p.z)/lb;
    const endpoint=route.endpointTangents&&(i===0?route.endpointTangents.start:i===n-1?route.endpointTangents.end:undefined);
    if(endpoint){vx=endpoint.x;vz=endpoint.z;}
    const length=Math.hypot(vx,vz)||1;tx[i]=vx/length;tz[i]=vz/length;
  }
  cached={distance,tx,tz,closed};stations.set(route,cached);return cached;
}
type Lane = {
  station:Float64Array;x:Float64Array;z:Float64Array;arc:Float64Array;
  x1:Float64Array;x2:Float64Array;x3:Float64Array;
  z1:Float64Array;z2:Float64Array;z3:Float64Array;curvature:Float64Array;hasCurves:boolean;closed:boolean;
};
const lanes=new WeakMap<TrafficPath,Map<number,Lane>>();
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
function interval(stations:Float64Array,distance:number) {
  let low=0,high=stations.length-2;
  while(low<high){const middle=(low+high)>>1;if(stations[middle+1]<distance)low=middle+1;else high=middle;}
  return low;
}
function laneSpeed(lane:Lane,i:number,t:number) {
  return Math.hypot(lane.x1[i]+t*(2*lane.x2[i]+3*t*lane.x3[i]),lane.z1[i]+t*(2*lane.z2[i]+3*t*lane.z3[i]));
}
/** Arc length of a cubic segment. Integrating the derivative keeps inversion continuous. */
function partialLength(lane:Lane,i:number,t:number) {
  const h=t/2;
  return h*(.5688888888888889*laneSpeed(lane,i,h)
    +.4786286704993665*(laneSpeed(lane,i,h*(1-.5384693101056831))+laneSpeed(lane,i,h*(1+.5384693101056831)))
    +.2369268850561891*(laneSpeed(lane,i,h*(1-.9061798459386640))+laneSpeed(lane,i,h*(1+.9061798459386640))));
}
/** Compile a smooth physical lane once, independently of the render frame rate. */
function trafficLane(route:TrafficPath,direction:1|-1) {
  let entries=lanes.get(route);if(!entries){entries=new Map();lanes.set(route,entries);}
  const cached=entries.get(direction);if(cached)return cached;
  const original=trafficStations(route),dense:Point[]=[],distance:number[]=[];
  const offset=(route.laneCentered?0:Math.min(2.75,Math.max(1.65,route.width*.22)))*direction;
  // Bound adjacent knot spacing before calculating tangents. Otherwise a short
  // corner next to a long block pulls the entire block sideways.
  for(let i=0;i<route.points.length-1;i++) {
    const a=route.points[i],b=route.points[i+1],span=original.distance[i+1]-original.distance[i];
    if(span<1e-8)continue;
    const count=Math.max(1,Math.ceil(span));
    const x1=original.tx[i]*span,z1=original.tz[i]*span;
    const x2=3*(b.x-a.x)-(2*original.tx[i]+original.tx[i+1])*span,z2=3*(b.z-a.z)-(2*original.tz[i]+original.tz[i+1])*span;
    const x3=2*(a.x-b.x)+(original.tx[i]+original.tx[i+1])*span,z3=2*(a.z-b.z)+(original.tz[i]+original.tz[i+1])*span;
    for(let j=0;j<count;j++) {
      const t=j/count,dx=x1+t*(2*x2+3*t*x3),dz=z1+t*(2*z2+3*t*z3),length=Math.hypot(dx,dz)||1;
      dense.push({x:a.x+t*(x1+t*(x2+t*x3))-dz/length*offset,z:a.z+t*(z1+t*(z2+t*z3))+dx/length*offset});
      distance.push(original.distance[i]+span*t);
    }
  }
  const last=route.points.length-1,end=route.points[last];
  dense.push(original.closed?dense[0]:{x:end.x-original.tz[last]*offset,z:end.z+original.tx[last]*offset});distance.push(route.length);
  const n=dense.length,station=Float64Array.from(distance),x=new Float64Array(n),z=new Float64Array(n),mx=new Float64Array(n),mz=new Float64Array(n);
  for(let i=0;i<n;i++){x[i]=dense[i].x;z[i]=dense[i].z;}
  for(let i=0;i<n;i++) {
    const before=i===0&&original.closed?n-2:Math.max(0,i-1),after=i===n-1&&original.closed?1:Math.min(n-1,i+1);
    const da=i===0&&original.closed?route.length-station[before]:station[i]-station[before];
    const db=i===n-1&&original.closed?station[after]:station[after]-station[i];
    if(da<1e-8){mx[i]=(x[after]-x[i])/Math.max(db,1e-8);mz[i]=(z[after]-z[i])/Math.max(db,1e-8);}
    else if(db<1e-8){mx[i]=(x[i]-x[before])/da;mz[i]=(z[i]-z[before])/da;}
    else {
      mx[i]=((x[i]-x[before])/da*db+(x[after]-x[i])/db*da)/(da+db);
      mz[i]=((z[i]-z[before])/da*db+(z[after]-z[i])/db*da)/(da+db);
    }
    const endpoint=route.endpointTangents&&(i===0?route.endpointTangents.start:i===n-1?route.endpointTangents.end:undefined);
    if(endpoint){const length=Math.hypot(mx[i],mz[i]);mx[i]=endpoint.x*length;mz[i]=endpoint.z*length;}
  }
  const lane:Lane={station,x,z,arc:new Float64Array(n),x1:new Float64Array(n-1),x2:new Float64Array(n-1),x3:new Float64Array(n-1),z1:new Float64Array(n-1),z2:new Float64Array(n-1),z3:new Float64Array(n-1),curvature:new Float64Array(n-1),hasCurves:false,closed:original.closed};
  for(let i=0;i<n-1;i++) {
    const span=station[i+1]-station[i],dx=x[i+1]-x[i],dz=z[i+1]-z[i];
    lane.x1[i]=mx[i]*span;lane.x2[i]=3*dx-(2*mx[i]+mx[i+1])*span;lane.x3[i]=-2*dx+(mx[i]+mx[i+1])*span;
    lane.z1[i]=mz[i]*span;lane.z2[i]=3*dz-(2*mz[i]+mz[i+1])*span;lane.z3[i]=-2*dz+(mz[i]+mz[i+1])*span;
    lane.arc[i+1]=lane.arc[i]+partialLength(lane,i,1);
    for(let j=0;j<=8;j++) {
      const t=j/8,vx=lane.x1[i]+t*(2*lane.x2[i]+3*t*lane.x3[i]),vz=lane.z1[i]+t*(2*lane.z2[i]+3*t*lane.z3[i]);
      const ax=2*lane.x2[i]+6*t*lane.x3[i],az=2*lane.z2[i]+6*t*lane.z3[i];
      lane.curvature[i]=Math.max(lane.curvature[i],Math.abs(vx*az-vz*ax)/Math.max(1e-12,Math.hypot(vx,vz)**3));
    }
    if(lane.curvature[i]>.0001)lane.hasCurves=true;
  }
  entries.set(direction,lane);return lane;
}
function distanceAt(lane:Lane,progress:number):number {
  const last=lane.station.length-1,length=lane.station[last];
  if(lane.closed&&(progress<0||progress>=length)) {
    const cycles=Math.floor(progress/length);
    return cycles*lane.arc[last]+distanceAt(lane,progress-cycles*length);
  }
  if(progress<=0)return progress;if(progress>=length)return lane.arc[last]+progress-length;
  const i=interval(lane.station,progress),t=(progress-lane.station[i])/(lane.station[i+1]-lane.station[i]);
  return lane.arc[i]+partialLength(lane,i,t);
}
/** Convert physical metres to the road's terrain/profile station, including lane curvature. */
export function advanceTrafficProgress(route:TrafficPath,progress:number,direction:1|-1,metres:number) {
  const lane=trafficLane(route,direction),last=lane.arc.length-1,total=lane.arc[last];
  let distance=distanceAt(lane,progress)+metres*direction;
  if(lane.closed)distance=((distance%total)+total)%total;
  else {if(distance<=0)return distance;if(distance>=total)return route.length+distance-total;}
  const i=interval(lane.arc,distance),target=distance-lane.arc[i],length=lane.arc[i+1]-lane.arc[i];
  let t=clamp01(target/Math.max(length,1e-8));
  for(let iteration=0;iteration<4;iteration++) {
    const error=partialLength(lane,i,t)-target;if(Math.abs(error)<1e-8)break;
    t=clamp01(t-error/Math.max(laneSpeed(lane,i,t),1e-8));
  }
  return lane.station[i]+t*(lane.station[i+1]-lane.station[i]);
}
export function trafficTravelDistance(route:TrafficPath,from:number,to:number,direction:1|-1) {
  const lane=trafficLane(route,direction);return Math.abs(distanceAt(lane,to)-distanceAt(lane,from));
}
/** Brake before a curve, using cached geometric bounds rather than reacting at its apex. */
export function trafficCornerSpeed(route:TrafficPath,progress:number,direction:1|-1,lookahead:number,lateral:number,braking:number) {
  const lane=trafficLane(route,direction);if(!lane.hasCurves)return Infinity;
  const count=lane.arc.length-1,total=lane.arc[count],current=distanceAt(lane,progress);
  let i=interval(lane.arc,current),cycle=0,limitSquared=Infinity;
  for(let visited=0;visited<count&&i>=0&&i<count;visited++,i+=direction) {
    const distance=direction===1?lane.arc[i]+cycle-current:current-(lane.arc[i+1]+cycle);
    if(distance>lookahead)break;
    if(lane.curvature[i]>.0001)limitSquared=Math.min(limitSquared,lateral/lane.curvature[i]+2*braking*Math.max(0,distance-2.5));
    if(lane.closed&&i+direction>=count){i=-1;cycle+=total;}
    else if(lane.closed&&i+direction<0){i=count;cycle-=total;}
  }
  return Math.sqrt(limitSquared);
}
/** Position and heading come from the same continuous lane curve. */
export function sampleTrafficRoute(route:TrafficPath,progress:number,direction:1|-1) {
  const lane=trafficLane(route,direction);
  const d=lane.closed?((progress%route.length)+route.length)%route.length:Math.max(0,Math.min(route.length,progress));
  const i=interval(lane.station,d),t=clamp01((d-lane.station[i])/(lane.station[i+1]-lane.station[i]));
  const dx=lane.x1[i]+t*(2*lane.x2[i]+3*t*lane.x3[i]),dz=lane.z1[i]+t*(2*lane.z2[i]+3*t*lane.z3[i]);
  return {x:lane.x[i]+t*(lane.x1[i]+t*(lane.x2[i]+t*lane.x3[i])),z:lane.z[i]+t*(lane.z1[i]+t*(lane.z2[i]+t*lane.z3[i])),heading:Math.atan2(dx*direction,-dz*direction)};
}
export type TrafficConnection = {startAt:number;route:TrafficPath};
/** Join real adjoining road sections with a short lane-centred tangent curve. */
export function findTrafficConnection(source:TrafficPath,direction:1|-1,routes:TrafficPath[],height:(r:TrafficPath,d:number,dir:1|-1)=>number):TrafficConnection|null {
  const endDistance=direction===1?source.length:0,end=source.points[direction===1?source.points.length-1:0];
  const pose=sampleTrafficRoute(source,endDistance,direction),fx=Math.sin(pose.heading),fz=-Math.cos(pose.heading);
  const endHeight=height(source,endDistance,direction);
  let best:{route:TrafficPath;direction:1|-1;progress:number;score:number}|undefined;
  for(const candidate of routes) {
    if(candidate===source||candidate.destination)continue;
    const s=trafficStations(candidate);
    for(let i=0;i<candidate.points.length-1;i++) {
      const a=candidate.points[i],b=candidate.points[i+1],dx=b.x-a.x,dz=b.z-a.z,square=dx*dx+dz*dz;
      if(square<.01)continue;
      const t=Math.max(0,Math.min(1,((end.x-a.x)*dx+(end.z-a.z)*dz)/square));
      if(Math.hypot(a.x+dx*t-end.x,a.z+dz*t-end.z)>.75)continue;
      const progress=s.distance[i]+Math.sqrt(square)*t;
      for(const dir of [1,-1] as const) {
        if(!s.closed&&(dir===1?candidate.length-progress:progress)<12)continue;
        const next=sampleTrafficRoute(candidate,progress,dir),alignment=fx*Math.sin(next.heading)-fz*Math.cos(next.heading);
        if(alignment<-.1||Math.abs(height(candidate,progress,dir)-endHeight)>.45)continue;
        const score=alignment-Math.abs(source.width-candidate.width)*.015;
        if(!best||score>best.score)best={route:candidate,direction:dir,progress,score};
      }
    }
  }
  if(!best)return null;
  const startAt=direction===1?Math.max(0,source.length-10):Math.min(10,source.length);
  const finish=best.progress+best.direction*10,a=sampleTrafficRoute(source,startAt,direction),b=sampleTrafficRoute(best.route,finish,best.direction);
  const span=Math.hypot(b.x-a.x,b.z-a.z),control=span*.36;
  const c={x:a.x+Math.sin(a.heading)*control,z:a.z-Math.cos(a.heading)*control};
  const e={x:b.x-Math.sin(b.heading)*control,z:b.z+Math.cos(b.heading)*control};
  const points=Array.from({length:25},(_,i)=>{const t=i/24,u=1-t;return{x:u*u*u*a.x+3*u*u*t*c.x+3*u*t*t*e.x+t*t*t*b.x,z:u*u*u*a.z+3*u*u*t*c.z+3*u*t*t*e.z+t*t*t*b.z};});
  const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0);
  const destination={route:best.route,direction:best.direction,progress:finish};
  const route:TrafficPath={points,width:Math.min(source.width,best.route.width),length,laneCentered:true,endpointTangents:{start:{x:Math.sin(a.heading),z:-Math.cos(a.heading)},end:{x:Math.sin(b.heading),z:-Math.cos(b.heading)}},heightAt:d=>{
    const t=Math.max(0,Math.min(1,d/length)),h0=height(source,startAt,direction),h1=height(destination.route,finish,destination.direction);
    return h0+(h1-h0)*t;
  },destination};
  return{startAt,route};
}
