import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {attribute} from 'three/tsl';
import type {Coordinates} from './game-core';
type Jet={x:number;y:number;z:number;started:number;next:number};
type Drop={x:number;y:number;z:number;vx:number;vy:number;vz:number;age:number;life:number;floor:number};
/** Pressurised water at the broken pipe, independent from the tumbling hydrant. */
export class HydrantSpray {
  readonly root=new THREE.Group();
  readonly jets:Jet[]=[];
  private drops:Drop[]=[];
  private mesh:THREE.InstancedMesh;
  private puddles:THREE.InstancedMesh;
  private opacity=new THREE.InstancedBufferAttribute(new Float32Array(640),1).setUsage(THREE.DynamicDrawUsage);
  private cursor=0;
  private matrix=new THREE.Matrix4();
  private p=new THREE.Vector3();
  private q=new THREE.Quaternion();
  private scale=new THREE.Vector3();
  private up=new THREE.Vector3(0,1,0);
  private right=new THREE.Vector3(1,0,0);
  private velocity=new THREE.Vector3();
  constructor(){
    this.root.name='Broken hydrant pressure jets and gravity-driven water droplets';this.root.userData.dynamicWorldObject=true;
    const geometry=new THREE.IcosahedronGeometry(.026,0);geometry.setAttribute('sprayAlpha',this.opacity);
    const material=new MeshBasicNodeMaterial({color:'#c9f1ff',transparent:true,depthWrite:false,toneMapped:false});
    material.opacityNode=attribute('sprayAlpha','float');
    this.mesh=new THREE.InstancedMesh(geometry,material,640);this.mesh.frustumCulled=false;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puddles=new THREE.InstancedMesh(new THREE.CircleGeometry(1,24),new THREE.MeshStandardMaterial({color:'#678c91',transparent:true,opacity:.27,roughness:.12,metalness:.18,depthWrite:false}),24);
    this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.puddles.frustumCulled=false;
    for(let i=0;i<640;i++){this.mesh.setMatrixAt(i,this.matrix.makeScale(0,0,0));this.drops.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,age:10,life:1,floor:0});}
    for(let i=0;i<24;i++)this.puddles.setMatrixAt(i,this.matrix.makeScale(0,0,0));
    this.root.add(this.mesh,this.puddles);this.root.visible=false;
  }
  breakAt(point:Coordinates,floor:number,seconds:number){if(this.jets.length>=24)return;this.jets.push({...point,y:floor+.06,started:seconds,next:seconds});this.root.visible=true;}
  step(dt:number,seconds:number,rider:Coordinates){
    for(const jet of this.jets){
      if(Math.hypot(jet.x-rider.x,jet.z-rider.z)>100){jet.next=seconds;continue;}
      const pressure=Math.max(.55,1-(seconds-jet.started)/300);
      const end=Math.min(seconds,jet.next+.1);
      while(jet.next<end){jet.next+=1/72;const angle=Math.random()*Math.PI*2,spread=.75+Math.random()*1.8;
        const drop=this.drops[this.cursor];Object.assign(drop,{x:jet.x,y:jet.y,z:jet.z,vx:Math.cos(angle)*spread,vy:(9+Math.random()*3.5)*pressure,vz:Math.sin(angle)*spread,age:0,life:2.8,floor:jet.y});this.cursor=(this.cursor+1)%this.drops.length;
      }
    }
    for(const drop of this.drops){drop.age+=dt;if(drop.age>=drop.life)continue;drop.vy-=9.81*dt;drop.x+=drop.vx*dt;drop.y+=drop.vy*dt;drop.z+=drop.vz*dt;if(drop.y<drop.floor){drop.age=drop.life;}}
  }
  render(seconds:number){
    if(!this.jets.length)return;
    for(let i=0;i<this.drops.length;i++){const drop=this.drops[i];if(drop.age>=drop.life){this.mesh.setMatrixAt(i,this.matrix.makeScale(0,0,0));this.opacity.setX(i,0);continue;}
      this.q.setFromUnitVectors(this.up,this.velocity.set(drop.vx,drop.vy,drop.vz).normalize());
      this.matrix.compose(this.p.set(drop.x,drop.y,drop.z),this.q,this.scale.set(.8,Math.max(1,Math.abs(drop.vy)*.6),.8));this.mesh.setMatrixAt(i,this.matrix);this.opacity.setX(i,.42*Math.min(1,(drop.life-drop.age)*3));
    }
    this.jets.forEach((jet,i)=>{const size=Math.min(3.6,.3+(seconds-jet.started)*.10);this.q.setFromAxisAngle(this.right,-Math.PI/2);this.puddles.setMatrixAt(i,this.matrix.compose(this.p.set(jet.x,jet.y-.035,jet.z),this.q,this.scale.set(size,size,1)));});
    this.mesh.instanceMatrix.needsUpdate=true;this.opacity.needsUpdate=true;this.puddles.instanceMatrix.needsUpdate=true;
  }
  dispose(){for(const mesh of[this.mesh,this.puddles]){mesh.dispose();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}this.root.removeFromParent();}
}
