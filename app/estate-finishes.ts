import * as THREE from 'three';

/** Repeatable two-metre architectural samples; geometry supplies metric UVs. */
export function createEstateFinish(wood = false) {
  const loader=new THREE.TextureLoader(), kind=wood?'wood':'travertine';
  const tile=wood?2:1.2;
  const load=(channel:string)=>{
    const texture=loader.load(`/textures/estate/${kind}-${channel}.jpg`);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.repeat.set(2/tile,2/tile);texture.anisotropy=8;
    if(channel==='color')texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  };
  const map=load('color'),normalMap=load('normal'),roughnessMap=load('roughness');
  const material=new THREE.MeshStandardMaterial({map,normalMap,roughnessMap,normalScale:new THREE.Vector2(.6,.6),roughness:1});
  material.addEventListener('dispose',()=>{map.dispose();normalMap.dispose();roughnessMap.dispose();});
  return material;
}

export function createRiverbedFinish() {
  if(typeof document==='undefined')return new THREE.MeshStandardMaterial({color:'#8b826e',roughness:.94,side:THREE.DoubleSide});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');
  if(!c)return new THREE.MeshStandardMaterial({color:'#8b826e',roughness:.94,side:THREE.DoubleSide});
  c.fillStyle='#8b826e';c.fillRect(0,0,512,512);
  let seed=109;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<4600;i++) {
    const x=random()*512,y=random()*512,r=1+random()*4, shade=85+random()*85;
    c.fillStyle='#645e51';c.beginPath();c.ellipse(x+.8,y+1,r*1.3,r,.2,0,Math.PI*2);c.fill();
    c.fillStyle=`rgb(${shade},${shade*.96},${shade*.85})`;c.beginPath();c.ellipse(x,y,r*1.2,r*.83,.2,0,Math.PI*2);c.fill();
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
  const material=new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.045,roughness:.94,side:THREE.DoubleSide});
  material.addEventListener('dispose',()=>map.dispose());return material;
}
