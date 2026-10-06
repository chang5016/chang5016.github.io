import * as THREE from "three";

type Point = { x: number; z: number };
type Segment = { footprint?: Point[]; a: Point; b: Point; width: number; startWidth?: number; endWidth?: number; startHeight: number; endHeight: number };
type Plane = [number, number, number, number];
type Vertex = number[];

/** Subtract the same road prisms; calculate each prism once, not per triangle. */
export function clearBridgeRailIntrusions(geometry: THREE.BufferGeometry, query: (p: Point, radius: number) => Segment[], ground: (p: Point) => number,
  options: { margin?: number; below?: number; above?: number; designHeight?: boolean } = {}) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const names = Object.keys(source.attributes);
  const attributes = names.map(name=>source.getAttribute(name));
  const sizes = attributes.map(attribute=>attribute.itemSize);
  const offsets = sizes.map((_,i)=>sizes.slice(0,i).reduce((a,b)=>a+b,0));
  const po = offsets[names.indexOf("position")];
  const baseIndex=names.indexOf('terrainBaseY');
  const heightOffset=options.designHeight && baseIndex>=0 ? offsets[baseIndex] : po+1;
  const margin=options.margin??.04,below=options.below??.12,above=options.above??3.2;
  const output: number[][] = names.map(()=>[]);
  const cached = new Map<Segment, { planes: Plane[]; minX: number; maxX: number; minZ: number; maxZ: number }>();
  const roadPrism = (road: Segment) => {
    let prism = cached.get(road); if (prism) return prism;
    const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,length=Math.hypot(dx,dz);
    if(length<.01)return null;
    const tx=dx/length,tz=dz/length,station=-road.a.x*tx-road.a.z*tz;
    const lateral=road.a.x*tz-road.a.z*tx;
    const first=(road.startWidth??road.width)/2-margin,last=(road.endWidth??road.width)/2-margin;
    const widening=(last-first)/length;
    const base=(options.designHeight?0:ground(road.a))+road.startHeight,slope=((options.designHeight?0:ground(road.b))+road.endHeight-base)/length;
    const half=Math.max(first,last)+margin;
    prism={ minX:Math.min(road.a.x,road.b.x)-half,maxX:Math.max(road.a.x,road.b.x)+half,
      minZ:Math.min(road.a.z,road.b.z)-half,maxZ:Math.max(road.a.z,road.b.z)+half,
      planes:[
        [tx,0,tz,station],[-tx,0,-tz,length-station],
        [widening*tx+tz,0,widening*tz-tx,first+widening*station-lateral],
        [widening*tx-tz,0,widening*tz+tx,first+widening*station+lateral],
        [-slope*tx,1,-slope*tz,-base-slope*station+below],
        [slope*tx,-1,slope*tz,above+base+slope*station],
      ] };
    if(road.footprint?.length===4) {
      const centre=road.footprint.reduce((p,q)=>({x:p.x+q.x/4,z:p.z+q.z/4}),{x:0,z:0});
      const boundary=road.footprint.map((a,i)=>{
        const b=road.footprint![(i+1)%4],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1;
        let nx=-dz/length,nz=dx/length;
        if((centre.x-a.x)*nx+(centre.z-a.z)*nz<0){nx=-nx;nz=-nz;}
        // Shrink side edges only. Shrinking each subdivision's end plane
        // leaves upright fragments in the middle of a joined carriageway.
        return [nx,0,nz,-nx*a.x-nz*a.z-(i%2===0?margin:0)] as Plane;
      });
      prism.planes=[...boundary,...prism.planes.slice(4)];
      prism.minX=Math.min(...road.footprint.map(p=>p.x));prism.maxX=Math.max(...road.footprint.map(p=>p.x));
      prism.minZ=Math.min(...road.footprint.map(p=>p.z));prism.maxZ=Math.max(...road.footprint.map(p=>p.z));
    }
    cached.set(road,prism);return prism;
  };
  const distance=(v:Vertex,p:Plane)=>v[po]*p[0]+v[heightOffset]*p[1]+v[po+2]*p[2]+p[3];
  const split=(polygon:Vertex[],plane:Plane)=>{
    const inside:Vertex[]=[],outside:Vertex[]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a,plane),db=distance(b,plane);
      (da>=0?inside:outside).push(a);
      if((da>=0)!==(db>=0)){
        const t=da/(da-db),crossing=a.map((value,k)=>value+(b[k]-value)*t);
        inside.push(crossing);outside.push(crossing);
      }
    }
    return {inside,outside};
  };
  for(let i=0;i<source.getAttribute("position").count;i+=3){
    const triangle:Vertex[]=[];
    for(let j=0;j<3;j++){
      const vertex:number[]=[];
      for(let k=0;k<attributes.length;k++)for(let c=0;c<sizes[k];c++)vertex.push(attributes[k].array[(i+j)*sizes[k]+c]);
      triangle.push(vertex);
    }
    const center={x:(triangle[0][po]+triangle[1][po]+triangle[2][po])/3,z:(triangle[0][po+2]+triangle[1][po+2]+triangle[2][po+2])/3};
    const radius=Math.max(...triangle.map(v=>Math.hypot(v[po]-center.x,v[po+2]-center.z)))+1;
    const minX=Math.min(...triangle.map(v=>v[po])),maxX=Math.max(...triangle.map(v=>v[po]));
    const minZ=Math.min(...triangle.map(v=>v[po+2])),maxZ=Math.max(...triangle.map(v=>v[po+2]));
    let pieces=[triangle];
    for(const road of query(center,radius)){
      const prism=roadPrism(road);
      if(!prism||maxX<prism.minX||minX>prism.maxX||maxZ<prism.minZ||minZ>prism.maxZ)continue;
      const retained:Vertex[][]=[];
      for(const piece of pieces){
        if(prism.planes.some(plane=>piece.every(v=>distance(v,plane)<0))){retained.push(piece);continue;}
        let rest=piece;
        for(const plane of prism.planes){
          if(rest.length<3)break;
          const {inside,outside}=split(rest,plane);
          if(outside.length>=3)retained.push(outside);
          rest=inside;
        }
      }
      pieces=retained;if(!pieces.length)break;
    }
    for(const polygon of pieces)for(let j=1;j<polygon.length-1;j++){
      for(const vertex of [polygon[0],polygon[j],polygon[j+1]])for(let k=0;k<names.length;k++){
        for(let c=0;c<sizes[k];c++)output[k].push(vertex[offsets[k]+c]);
      }
    }
  }
  const result=new THREE.BufferGeometry();
  names.forEach((name,k)=>result.setAttribute(name,new THREE.Float32BufferAttribute(output[k],sizes[k])));
  result.computeVertexNormals();result.computeBoundingSphere();
  source.dispose();geometry.dispose();return result;
}
