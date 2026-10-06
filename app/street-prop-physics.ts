import * as THREE from 'three';
import type * as Rapier from '@dimforge/rapier3d-compat';
import type { BuildingBounds, Coordinates, VehicleState } from './game-core';
import type { StreetPropKind, StreetPropPlacement } from './street-props';
import {HydrantSpray} from './hydrant-spray';

let runtime: Promise<typeof Rapier> | undefined;
function physicsRuntime() {
  return runtime ??= import('@dimforge/rapier3d-compat').then(async module => { await module.init(); return module; });
}
type Slot = { mesh: THREE.InstancedMesh; index: number };
type Prop = {
  placement: StreetPropPlacement; slots: Slot[]; bounds: THREE.Box3; centre: THREE.Vector3;
  position: THREE.Vector3; previous: THREE.Vector3; rotation: THREE.Quaternion; previousRotation: THREE.Quaternion;
  body?: Rapier.RigidBody; groundBody?: Rapier.RigidBody; floor?: number; lastHit: number; quiet: number; dirty: boolean;
};

/** Wake only struck furnishings. Keep every original PBR surface in its shared batch. */
export class StreetPropPhysics {
  readonly ready: Promise<void>;
  readonly props: Prop[] = [];
  readonly brokenHydrants=new Set<StreetPropPlacement>();
  readonly spray=new HydrantSpray();
  private api?: typeof Rapier;
  private world?: Rapier.World;
  private scooter?: Rapier.RigidBody;
  private disposed = false;
  private seconds = 0;
  private lastScooter?: THREE.Vector3;
  private readonly transform = new THREE.Matrix4();
  private readonly centreOffset = new THREE.Vector3();
  private readonly visualPosition = new THREE.Vector3();
  private readonly visualRotation = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1,1,1);

  constructor(instances: THREE.Group, templates: Map<StreetPropKind, THREE.Object3D>,
    private readonly ground: (point: Coordinates) => number,
    private readonly obstacles?: (point: Coordinates, height: number) => BuildingBounds[]) {
    const indexed = new Map<StreetPropPlacement, Prop>();
    instances.add(this.spray.root);
    instances.userData.dynamicWorldObject = true;
    instances.traverse(object => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const placements = mesh.userData.terrainInstances as StreetPropPlacement[];
      if(!placements)return;
      placements.forEach((placement,index) => {
        let prop = indexed.get(placement);
        if (!prop) {
          const bounds = new THREE.Box3().setFromObject(templates.get(placement.kind)!);
          const centre = placement.kind === 'planter' ? new THREE.Vector3(0,.18,0) : bounds.getCenter(new THREE.Vector3());
          mesh.getMatrixAt(index,this.transform);
          const root = new THREE.Vector3(), rotation = new THREE.Quaternion();
          this.transform.decompose(root,rotation,new THREE.Vector3());
          const position=root.add(centre.clone().applyQuaternion(rotation));
          prop={placement,slots:[],bounds,centre,position,previous:position.clone(),rotation,previousRotation:rotation.clone(),lastHit:-10,quiet:0,dirty:false};
          indexed.set(placement,prop);this.props.push(prop);
        }
        prop.slots.push({mesh,index});
      });
    });
    this.ready=physicsRuntime().then(api => {
      if(this.disposed)return;
      this.api=api;this.world=new api.World({x:0,y:-9.81,z:0});
      this.world.timestep=1/60;
      this.scooter=this.world.createRigidBody(api.RigidBodyDesc.kinematicPositionBased());
      this.world.createCollider(api.ColliderDesc.roundCuboid(.48,.58,1.27,.06).setFriction(.6),this.scooter);
    });
  }

  private wake(prop: Prop) {
    const api=this.api!,world=this.world!;
    if(prop.body){prop.body.wakeUp();prop.quiet=0;return;}
    for(const slot of prop.slots){
      slot.mesh.userData.struckStreetProps??=new WeakSet();
      slot.mesh.userData.struckStreetProps.add(prop.placement);
    }
    prop.body=world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(prop.position.x,prop.position.y,prop.position.z)
      .setRotation(prop.rotation).setCcdEnabled(true).setLinearDamping(.55).setAngularDamping(1.2));
    const half=prop.bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
    const collider=prop.placement.kind==='planter' ? api.ColliderDesc.cylinder(.18,.25)
      : api.ColliderDesc.roundCuboid(Math.max(.05,half.x-.025),Math.max(.05,half.y-.025),Math.max(.05,half.z-.025),.025);
    world.createCollider(collider.setMass(prop.placement.kind==='planter'?18:prop.placement.kind==='hydrant'?28:48).setFriction(.72).setRestitution(.1),prop.body);
    if(prop.placement.kind==='planter') {
      const top=prop.bounds.max.y-.08;
      world.createCollider(api.ColliderDesc.capsule(Math.max(.02,(top-.4)/2),.035)
        .setTranslation(0,(top+.4)/2-prop.centre.y,0).setMass(.2).setFriction(.5),prop.body);
    }
    const p=prop.placement,floor=this.ground(p)+p.y;
    const normal=new THREE.Vector3((this.ground({x:p.x-.4,z:p.z})-this.ground({x:p.x+.4,z:p.z}))/.8,1,
      (this.ground({x:p.x,z:p.z-.4})-this.ground({x:p.x,z:p.z+.4}))/.8).normalize();
    const base=world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(p.x,floor-.1,p.z));
    prop.groundBody=base;prop.floor=floor;
    world.createCollider(api.ColliderDesc.cuboid(12,.1,12).setRotation(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal)).setFriction(.8),base);
    for(const wall of (this.obstacles?.(p,floor)??[]).slice(0,16)) {
      const outline=wall.outline??[{x:wall.x-wall.halfWidth,z:wall.z-wall.halfDepth},{x:wall.x+wall.halfWidth,z:wall.z-wall.halfDepth},
        {x:wall.x+wall.halfWidth,z:wall.z+wall.halfDepth},{x:wall.x-wall.halfWidth,z:wall.z+wall.halfDepth}];
      const vertices=new Float32Array(outline.flatMap(q=>[q.x-p.x,.1,q.z-p.z,q.x-p.x,4.1,q.z-p.z]));
      const hull=api.ColliderDesc.convexHull(vertices);if(hull)world.createCollider(hull.setFriction(.7),base);
    }
  }

  private crossed(prop: Prop, before: VehicleState, after: VehicleState) {
    const root=prop.position.clone().sub(prop.centre.clone().applyQuaternion(prop.rotation));
    const c=Math.cos(prop.placement.angle),s=Math.sin(prop.placement.angle);
    const half=prop.placement.kind==='planter'?{x:.25,z:.25}:{x:prop.bounds.getSize(new THREE.Vector3()).x/2,z:prop.bounds.getSize(new THREE.Vector3()).z/2};
    for(const offset of [-1.2,0,1.2]) {
      const a={x:before.x+Math.sin(before.heading)*offset-root.x,z:before.z-Math.cos(before.heading)*offset-root.z};
      const b={x:after.x+Math.sin(after.heading)*offset-root.x,z:after.z-Math.cos(after.heading)*offset-root.z};
      const first=[a.x*c-a.z*s,a.x*s+a.z*c],last=[b.x*c-b.z*s,b.x*s+b.z*c];
      let low=0,high=1;
      for(let axis=0;axis<2;axis++) {
        const extent=(axis===0?half.x:half.z)+.54,delta=last[axis]-first[axis];
        if(Math.abs(delta)<1e-8){if(Math.abs(first[axis])>extent){high=-1;break;}}
        else {const x=(-extent-first[axis])/delta,y=(extent-first[axis])/delta;low=Math.max(low,Math.min(x,y));high=Math.min(high,Math.max(x,y));}
      }
      if(low<=high)return true;
    }
    return false;
  }

  step(before: VehicleState, after: VehicleState, beforeHeight: number, height: number, dt: number) {
    if(!this.world||!this.api||!this.scooter||this.disposed)return null;
    this.seconds+=dt;
    const speed=Math.max(Math.abs(before.speed),Math.abs(after.speed)),travel=Math.hypot(after.x-before.x,after.z-before.z);
    const genuineTravel=travel<Math.max(2,speed*dt*3);
    let impact: {kind: StreetPropKind;strength:number}|null=null;
    if(speed>.9&&genuineTravel&&Math.abs(beforeHeight-height)<.6) {
      let awake=this.props.filter(prop=>prop.body&&!prop.body.isSleeping()).length;
      for(const prop of this.props) {
        const floor=prop.position.y-prop.centre.y;
        if(Math.abs(height-floor)>.85||Math.hypot(after.x-prop.position.x,after.z-prop.position.z)>5+travel||this.seconds-prop.lastHit<.5)continue;
        if(!this.crossed(prop,before,after)||(!prop.body&&awake>=20))continue;
        if(prop.placement.kind==='hydrant'&&!prop.body){
          if(speed<2.8)continue;
          this.brokenHydrants.add(prop.placement);this.spray.breakAt(prop.placement,floor,this.seconds);
        }
        this.wake(prop);awake++;prop.lastHit=this.seconds;prop.quiet=0;prop.dirty=true;
        const impulse=prop.body!.mass()*Math.min(4.5,speed*.34),sign=after.speed<0?-1:1;
        const direction={x:Math.sin(after.heading)*sign,z:-Math.cos(after.heading)*sign};
        prop.body!.applyImpulseAtPoint({x:direction.x*impulse,y:impulse*.09,z:direction.z*impulse},
          {x:prop.position.x-direction.x*.2,y:prop.position.y+.24,z:prop.position.z-direction.z*.2},true);
        impact={kind:prop.placement.kind,strength:Math.min(1,speed/10)};
      }
    }
    this.spray.step(dt,this.seconds,after);
    const target=new THREE.Vector3(after.x,height+.70,after.z);
    const teleport=!this.lastScooter||this.lastScooter.distanceTo(target)>Math.max(2,speed*dt*3);
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-after.heading);
    if(teleport){this.scooter.setTranslation(target,true);this.scooter.setRotation(rotation,true);}
    this.scooter.setNextKinematicTranslation(target);this.scooter.setNextKinematicRotation(rotation);this.lastScooter=target;
    const moving=this.props.filter(prop=>prop.body&&!prop.body.isSleeping());
    const closeSleeping=this.props.some(prop=>prop.body&&Math.abs(height-prop.position.y+prop.centre.y)<2&&Math.hypot(after.x-prop.position.x,after.z-prop.position.z)<4);
    if(!moving.length&&!closeSleeping)return impact;
    for(const prop of moving){prop.previous.copy(prop.position);prop.previousRotation.copy(prop.rotation);}
    this.world.timestep=Math.max(.001,Math.min(.04,dt));this.world.step();
    for(const prop of this.props) {
      if(!prop.body||(!prop.dirty&&prop.body.isSleeping()))continue;
      const velocity=prop.body.linvel(),angular=prop.body.angvel(),linearLength=Math.hypot(velocity.x,velocity.y,velocity.z),angularLength=Math.hypot(angular.x,angular.y,angular.z);
      if(linearLength>8)prop.body.setLinvel({x:velocity.x*8/linearLength,y:velocity.y*8/linearLength,z:velocity.z*8/linearLength},true);
      if(angularLength>12)prop.body.setAngvel({x:angular.x*12/angularLength,y:angular.y*12/angularLength,z:angular.z*12/angularLength},true);
      const p=prop.body.translation(),q=prop.body.rotation();prop.position.set(p.x,p.y,p.z);prop.rotation.set(q.x,q.y,q.z,q.w);prop.dirty=true;
      prop.quiet=linearLength<.06&&angularLength<.07?prop.quiet+dt:0;
      if(prop.quiet>.8)prop.body.sleep();
    }
    return impact;
  }

  render(alpha: number) {
    this.spray.render(this.seconds);
    const dirty=new Set<THREE.InstancedMesh>();
    for(const prop of this.props) {
      if(!prop.body||!prop.dirty)continue;
      this.visualPosition.lerpVectors(prop.previous,prop.position,alpha);
      this.visualRotation.slerpQuaternions(prop.previousRotation,prop.rotation,alpha);
      this.visualPosition.sub(this.centreOffset.copy(prop.centre).applyQuaternion(this.visualRotation));
      this.transform.compose(this.visualPosition,this.visualRotation,this.one);
      for(const slot of prop.slots){slot.mesh.setMatrixAt(slot.index,this.transform);dirty.add(slot.mesh);}
      if(prop.body.isSleeping()){prop.previous.copy(prop.position);prop.previousRotation.copy(prop.rotation);prop.dirty=false;}
    }
    for(const mesh of dirty){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}
  }

  syncTerrain() {
    for(const prop of this.props){
      if(prop.body){
        const floor=this.ground(prop.placement)+prop.placement.y;
        if(prop.groundBody&&Math.abs(floor-prop.floor!)>.002){
          prop.groundBody.setTranslation({x:prop.placement.x,y:floor-.1,z:prop.placement.z},true);
          prop.floor=floor;prop.quiet=0;prop.body.wakeUp();prop.dirty=true;
        }
      }else{
        const slot=prop.slots[0];slot.mesh.getMatrixAt(slot.index,this.transform);
        this.transform.decompose(prop.position,prop.rotation,new THREE.Vector3());
        prop.position.add(this.centreOffset.copy(prop.centre).applyQuaternion(prop.rotation));
        prop.previous.copy(prop.position);prop.previousRotation.copy(prop.rotation);
      }
    }
  }

  dispose() {this.disposed=true;this.spray.dispose();this.world?.free();this.world=undefined;this.scooter=undefined;}
}
