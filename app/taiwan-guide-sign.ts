import * as THREE from "three";

/** Game destinations on a Taiwan-style green direction panel, not a real route number. */
export function createTaiwanGuideSign(destination: string, english: string, arrow: "left" | "right" | "ahead", highway = true) {
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#006747"; ctx.fillRect(0,0,1024,512);
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 12;
  ctx.beginPath();ctx.roundRect(14,14,996,484,18);ctx.stroke();
  ctx.fillStyle="#ffffff";ctx.textBaseline="middle";
  ctx.font='600 48px "Noto Sans TC", "Microsoft JhengHei", sans-serif';ctx.fillText(highway ? '出口 EXIT' : '往',54,79);
  ctx.font='700 106px "Noto Sans TC", "Microsoft JhengHei", sans-serif';ctx.fillText(destination,54,214,740);
  ctx.font='500 46px Arial, sans-serif';ctx.fillText(english,57,305,735);
  // A broad, legible directional arrow rather than a font-dependent arrow glyph.
  ctx.save();ctx.translate(876,358);ctx.rotate(arrow==='left' ? -Math.PI/4 : arrow==='right' ? Math.PI/4 : 0);
  ctx.beginPath();ctx.moveTo(-14,76);ctx.lineTo(14,76);ctx.lineTo(14,-12);ctx.lineTo(48,-12);ctx.lineTo(0,-68);ctx.lineTo(-48,-12);ctx.lineTo(-14,-12);ctx.closePath();ctx.fill();ctx.restore();
  ctx.font='500 38px "Noto Sans TC", sans-serif';ctx.fillText(highway ? '交流道' : '山區道路',57,428);
  const texture = new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const face = new THREE.MeshStandardMaterial({map:texture,roughness:.5,metalness:.08,emissive:'#ffffff',emissiveMap:texture,emissiveIntensity:.18});
  face.addEventListener('dispose',()=>texture.dispose());
  const steel = new THREE.MeshStandardMaterial({color:'#8e999e',metalness:.75,roughness:.4});
  const group = new THREE.Group();group.name=`Taiwan bilingual guide sign · ${destination}`;
  const width=highway?6.6:3.8,height=width/2,centerY=highway?7.5:3.5;
  const backing=new THREE.Mesh(new THREE.BoxGeometry(width+.12,height+.12,.15),steel);backing.position.y=centerY;group.add(backing);
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),face);panel.position.set(0,centerY,.081);group.add(panel);
  const postXs=highway?[-11,11]:[-1.1,1.1];
  for(const x of postXs){const post=new THREE.Mesh(new THREE.CylinderGeometry(.13,.16,centerY+.25,12),steel);post.position.set(x,(centerY+.25)/2,-.2);group.add(post);}
  if(highway){const arm=new THREE.Mesh(new THREE.BoxGeometry(22.4,.22,.3),steel);arm.position.set(0,centerY+.15,-.2);group.add(arm);}
  return {group,materials:[face,steel]};
}
