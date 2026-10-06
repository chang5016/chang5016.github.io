import type { BuildingBounds, Coordinates } from './game-core';

export type UrbanRect = { left:number; right:number; back:number; front:number };
export type UrbanPaving = UrbanRect & { district:'market'|'business'|'residential' };
type Street = { a:Coordinates; b:Coordinates; width:number };
export const overlapsRect=(a:UrbanRect,b:UrbanRect)=>a.left<b.right&&a.right>b.left&&a.back<b.front&&a.front>b.back;
export const containsRectPoint=(r:UrbanRect,p:Coordinates)=>p.x>=r.left&&p.x<=r.right&&p.z>=r.back&&p.z<=r.front;

/** Cut non-overlapping rectangles; roads and parks remain empty geometry. */
export function subtractUrbanRect(a:UrbanRect,b:UrbanRect):UrbanRect[] {
  if(!overlapsRect(a,b))return[a];
  const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right);
  const back=Math.max(a.back,b.back),front=Math.min(a.front,b.front);
  return [
    {left:a.left,right:a.right,back:a.back,front:back},
    {left:a.left,right:a.right,back:front,front:a.front},
    {left:a.left,right:left,back,front},
    {left:right,right:a.right,back,front},
  ].filter(r=>r.right-r.left>.01&&r.front-r.back>.01);
}

export function planUrbanBlocks(columns:number[],rows:number[],streets:Street[],reserved:UrbanRect[],buildings:BuildingBounds[]) {
  const paving:UrbanPaving[]=[],gardens:UrbanRect[]=[];
  const corridors=streets.filter(s=>Math.abs(s.a.x-s.b.x)<.01||Math.abs(s.a.z-s.b.z)<.01).map(s=>{
    const margin=s.width/2+(s.width>=8?2.05:1.35);
    return {left:Math.min(s.a.x,s.b.x)-margin,right:Math.max(s.a.x,s.b.x)+margin,
      back:Math.min(s.a.z,s.b.z)-margin,front:Math.max(s.a.z,s.b.z)+margin};
  });
  const footprints=buildings.map(b=>({left:b.x-b.halfWidth-2.5,right:b.x+b.halfWidth+2.5,
    back:b.z-b.halfDepth-2.5,front:b.z+b.halfDepth+2.5}));
  for(let row=0;row<rows.length-1;row++)for(let col=0;col<columns.length-1;col++) {
    const block={left:columns[col],right:columns[col+1],back:rows[row],front:rows[row+1]};
    const x=(block.left+block.right)/2,z=(block.back+block.front)/2;
    if(Math.abs(x)>870||Math.abs(z)>690||!footprints.some(b=>overlapsRect(b,block)))continue;
    const district:UrbanPaving['district']=z<-120&&x<260?'market':x>180&&x<560&&z<350?'business':'residential';
    let pieces=[block];
    for(const cut of [...corridors,...reserved]) {
      if(!overlapsRect(block,cut))continue;
      pieces=pieces.flatMap(p=>subtractUrbanRect(p,cut));
    }
    const court=pieces.filter(p=>p.right-p.left>42&&p.front-p.back>34).sort((a,b)=>(b.right-b.left)*(b.front-b.back)-(a.right-a.left)*(a.front-a.back))[0];
    if(court&&district!=='market') {
      const cx=(court.left+court.right)/2,cz=(court.back+court.front)/2;
      const garden=[0,.15,-.15].map(offset=>({left:cx-5.5,right:cx+5.5,
        back:cz+(court.front-court.back)*offset-3.5,front:cz+(court.front-court.back)*offset+3.5}))
        .find(g=>!footprints.some(b=>overlapsRect(b,g)));
      if(garden){gardens.push(garden);pieces=pieces.flatMap(p=>subtractUrbanRect(p,garden));}
    }
    paving.push(...pieces.filter(p=>p.right-p.left>.35&&p.front-p.back>.35).map(p=>({...p,district})));
  }
  return {paving,gardens};
}
