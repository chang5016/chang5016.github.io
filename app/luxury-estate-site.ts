import {planEstateAccess,type EstateAccessPoint} from './estate-access';
type Point={x:number;z:number};
export type LuxuryEstateSite=Point&{angle:number;floor:number;access:EstateAccessPoint[];entry:Point};
export function estateWorld(site:LuxuryEstateSite,x:number,z:number) {const c=Math.cos(site.angle),s=Math.sin(site.angle);return{x:site.x+c*x+s*z,z:site.z-s*x+c*z};}
const segmentDistance=(p:Point,a:Point,b:Point)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);};
/** Site selection is constrained by existing roads, occupied plots, grade and earthworks. */
export function planLuxuryEstate(roads:Point[],existing:Point[],ground:(p:Point)=>number,clear:(outline:Point[])=>boolean,diagnostics?:Record<string,number>):LuxuryEstateSite|null {
  const reject=(reason:string)=>{if(diagnostics)diagnostics[reason]=(diagnostics[reason]??0)+1;};
  let best:(LuxuryEstateSite&{score:number})|null=null;
  for(let i=2;i<roads.length-1;i+=roads.length>60?8:1) {
    const a=roads[i],b=roads[Math.min(roads.length-1,i+(roads.length>60?10:1))],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<20)continue;
    for(const t of [.12,.25,.5,.75,.88])for(const side of [-1,1])for(const offset of [82,98,114,130,146,162,178,194,210]) {
      const entry={x:a.x+dx*t,z:a.z+dz*t},nx=-dz/length*side,nz=dx/length*side;
      const site:LuxuryEstateSite={x:entry.x+nx*offset,z:entry.z+nz*offset,angle:Math.atan2(nx,nz),floor:0,access:[],entry};
      if(site.x<1390||site.x>1940||existing.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<79)){reject('boundsOrOccupied');continue;}
      const outline=[[-38,-31],[38,-31],[38,31],[-38,31],[-38,-31]].map(([x,z])=>estateWorld(site,x,z));
      if(!clear(outline)){reject('infrastructure');continue;}
      if(roads.slice(1).some((b,j)=>segmentDistance(site,roads[j],b)<52)){reject('roadDistance');continue;}
      const levels=[-38,0,38].flatMap(x=>[-31,0,31].map(z=>ground(estateWorld(site,x,z)))),base=ground(entry),relief=Math.max(...levels)-Math.min(...levels);
      const allowance=.077*(offset-40),minimum=Math.max(...levels)-5.8,maximum=Math.min(...levels)+10.8;
      site.floor=Math.max(base-allowance,minimum,Math.min(base+allowance,maximum,levels[4]+.7));
      if(relief>15||Math.max(...levels)-(site.floor-.2)>6||site.floor-.2-Math.min(...levels)>11){reject('earthworks');continue;}
      const access=planEstateAccess(entry,estateWorld(site,0,-31),site.floor,ground);if(!access){reject('grade');continue;}
      if(access.some((p,k)=>k>3&&roads.slice(1).some((b,j)=>(j<i-2||j>i+10)&&segmentDistance(p,roads[j],b)<8))){reject('accessCrossRoad');continue;}
      if(access.some(p=>existing.some(c=>Math.hypot(p.x-c.x,p.z-c.z)<28))){reject('accessExisting');continue;}
      site.access=access;const score=relief*3+offset*.08;
      if(!best||score<best.score)best={...site,score};
    }
  }
  return best;
}
