import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export const MOUNTAIN_TUNNEL={start:1590,entry:1630,exit:2130,end:2210,z:510,width:8.15};
export function tunnelFloorAt(x:number) {
  const base=55.0552371058851;
  if(x<=2130)return base+(x-1590)*.002;
  const t=Math.max(0,Math.min(1,(x-2130)/80)),smooth=t*t*(3-2*t);
  return (base+540*.002)*(1-smooth)+51.92128093605147*smooth;
}
export function tunnelApproachTerrain(p:{x:number;z:number},natural:number) {
  if(p.x<1587||p.x>2220||Math.abs(p.z-510)>13||p.x>1630&&p.x<2130)return natural;
  const lateral=Math.max(0,Math.min(1,(13-Math.abs(p.z-510))/6));
  const entrance=Math.max(0,Math.min(1,(p.x-1587)/3));
  const end=Math.max(0,Math.min(1,(2220-p.x)/10));
  const blend=lateral*entrance*end;
  return natural+(tunnelFloorAt(p.x)-.082-natural)*blend;
}
export function onTunnelRoad(p:{x:number;z:number},height:number) {
  return p.x>=1590&&p.x<=2210&&Math.abs(p.z-510)<4.85&&Math.abs(height-(tunnelFloorAt(p.x)-.082))<3;
}

export function createMountainTunnel(asphalt:THREE.Material,concrete:THREE.Material) {
  const group=new THREE.Group();group.name='500 metre excavated mountain tunnel and continuous approach road';
  const marks=new THREE.MeshStandardMaterial({color:'#eee8d4',roughness:.8,side:THREE.DoubleSide});
  const joints=new THREE.MeshStandardMaterial({color:'#5d6667',roughness:.97,side:THREE.DoubleSide});
  const drains=new THREE.MeshStandardMaterial({color:'#394249',roughness:.75,metalness:.45,side:THREE.DoubleSide});
  const lamps=new THREE.MeshStandardMaterial({color:'#fff0d2',emissive:'#ffe2ad',emissiveIntensity:1.8});
  const batches=new Map<THREE.Material,number[]>(),uvs=new Map<THREE.Material,number[]>();
  const quad=(a:number[],b:number[],c:number[],d:number[],material:THREE.Material)=>{
    const positions=batches.get(material)??[],uv=uvs.get(material)??[];
    positions.push(...a,...b,...c,...b,...d,...c);
    for(const p of [a,b,c,b,d,c])uv.push(p[0]/3,(p[1]+p[2])/3);
    batches.set(material,positions);uvs.set(material,uv);
  };
  const strip=(x:number,end:number,z:number,width:number,lift:number,material:THREE.Material)=>quad([x,tunnelFloorAt(x)+lift,z-width/2],[end,tunnelFloorAt(end)+lift,z-width/2],[x,tunnelFloorAt(x)+lift,z+width/2],[end,tunnelFloorAt(end)+lift,z+width/2],material);
  for(let x=1590;x<2210;x+=2) {
    strip(x,x+2,510,8.15,0,asphalt);
    if(x>1606)for(const z of [506.3,513.7])strip(x,x+2,z,.12,.015,marks);
    if(x>1610&&x%8<4)strip(x,x+2,510,.12,.015,marks);
  }
  const section=[[-4.9,.02],...Array.from({length:33},(_,i)=>[-4.9*Math.cos(Math.PI*i/32),2.2+3.35*Math.sin(Math.PI*i/32)]),[4.9,.02]];
  for(let x=1630;x<2130;x+=5) {
    for(let i=0;i<section.length-1;i++) {
      const [z,y]=section[i],[zz,yy]=section[i+1];
      quad([x,tunnelFloorAt(x)+y,510+z],[x+5,tunnelFloorAt(x+5)+y,510+z],[x,tunnelFloorAt(x)+yy,510+zz],[x+5,tunnelFloorAt(x+5)+yy,510+zz],concrete);
    }
    for(const side of [-1,1])strip(x,x+5,510+side*4.5,.55,.16,concrete);
    for(const side of [-1,1])strip(x,x+5,510+side*4.19,.10,.025,drains);
    if(x%10===0)for(const side of [-1,1])strip(x,x+1.4,510+side*2.8,.12,4.85,lamps);
    if((x-1630)%25===0)for(let i=0;i<section.length-1;i++){
      const [z,y]=section[i],[zz,yy]=section[i+1];
      quad([x,tunnelFloorAt(x)+y-.006,510+z*.999],[x+.035,tunnelFloorAt(x+.035)+y-.006,510+z*.999],[x,tunnelFloorAt(x)+yy-.006,510+zz*.999],[x+.035,tunnelFloorAt(x+.035)+yy-.006,510+zz*.999],joints);
    }
  }
  // Thick portal collars use the same vault and road datum, with a flared retaining approach.
  for(const [x,direction]of[[1630,-1],[2130,1]])for(const side of[-1,1]){
    const a=[x,tunnelFloorAt(x)+.02,510+side*4.92],b=[x+direction*12,tunnelFloorAt(x+direction*12)+.02,510+side*7.8];
    quad(a,b,[a[0],a[1]+5.8,a[2]],[b[0],b[1]+3.2,b[2]],concrete);
    if(side===1)for(let i=0;i<section.length-1;i++){
      const[z,y]=section[i],[zz,yy]=section[i+1];
      quad([x,tunnelFloorAt(x)+y+.45,510+z*1.085],[x+direction*.8,tunnelFloorAt(x+direction*.8)+y+.45,510+z*1.085],[x,tunnelFloorAt(x)+yy+.45,510+zz*1.085],[x+direction*.8,tunnelFloorAt(x+direction*.8)+yy+.45,510+zz*1.085],concrete);
    }
  }
  // Portal rings share the exact bore section and road datum; no imported asphalt slab.
  for(const x of [1630,2130])for(let i=0;i<section.length-1;i++) {
    const [z,y]=section[i],[zz,yy]=section[i+1];
    quad([x,tunnelFloorAt(x)+y,510+z],[x,tunnelFloorAt(x)+y+.45,510+z*1.085],[x,tunnelFloorAt(x)+yy,510+zz],[x,tunnelFloorAt(x)+yy+.45,510+zz*1.085],concrete);
  }
  for(const [material,positions] of batches) {
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs.get(material)!,2));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  const lights=Array.from({length:3},()=>{const light=new THREE.PointLight('#ffe9c7',16,30,2);light.visible=false;group.add(light);return light;});
  group.userData.tunnelLights=lights;
  group.userData.route={entry:'望岳景觀道路',boreLength:500,exit:'東嶺景觀道路 → 觀景台',continuous:true};
  // Complete downloaded LED/shroud models sit against the vault; shared instances retain native detail.
  if(typeof window!=='undefined')void new GLTFLoader().loadAsync('/models/metro/downloaded/carriage-lighting.glb?v=tunnel89').then(asset=>{
    if(group.userData.disposed||!group.parent)return;
    asset.scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(asset.scene),size=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3());
    asset.scene.traverse(object=>{const source=object as THREE.Mesh;if(!source.isMesh)return;
      const batch=new THREE.InstancedMesh(source.geometry,source.material,50),base=source.matrixWorld.clone(),m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),scale=new THREE.Vector3(1.4/size.x,.07/Math.max(size.y,.02),.22/size.z),offset=new THREE.Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z);
      for(let i=0;i<50;i++){const x=1635+Math.floor(i/2)*20,z=i%2?2.8:-2.8;q.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.asin(z/4.9));m.compose(p.set(x,tunnelFloorAt(x)+4.96,510+z),q,scale).multiply(offset).multiply(base);batch.setMatrixAt(i,m);}
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();batch.castShadow=false;batch.name='Downloaded sealed tunnel luminaires';group.add(batch);
    });
  }).catch(()=>{});
  return group;
}
