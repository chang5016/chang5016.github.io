import * as THREE from 'three';
import {createTrafficMotion,type TrafficMotion} from './traffic-dynamics';
const motionKeys=Object.keys(createTrafficMotion()) as Array<keyof TrafficMotion>;

/** Render between physics poses without moving the collision body between ticks. */
export class TrafficPresentation {
  private previousPosition=new THREE.Vector3();
  private previousRotation=new THREE.Quaternion();
  private inverseRotation=new THREE.Quaternion();
  private rotation=new THREE.Quaternion();
  private previousMotion=createTrafficMotion();
  private renderedMotion=createTrafficMotion();
  private previousAxleResidual=0;
  axleResidual=0;
  constructor(private root:THREE.Group,private visual:THREE.Group,motion:TrafficMotion) {this.reset(motion);}
  capture(motion:TrafficMotion) {
    this.previousPosition.copy(this.root.position);this.previousRotation.copy(this.root.quaternion);
    Object.assign(this.previousMotion,motion);this.previousAxleResidual=this.axleResidual;
  }
  reset(motion:TrafficMotion) {
    this.capture(motion);this.visual.position.set(0,0,0);this.visual.quaternion.identity();
  }
  apply(alpha:number,motion:TrafficMotion) {
    const t=Math.max(0,Math.min(1,alpha));
    this.inverseRotation.copy(this.root.quaternion).invert();
    this.visual.position.lerpVectors(this.previousPosition,this.root.position,t).sub(this.root.position).applyQuaternion(this.inverseRotation);
    this.rotation.slerpQuaternions(this.previousRotation,this.root.quaternion,t);
    this.visual.quaternion.copy(this.inverseRotation).multiply(this.rotation);
    for(const key of motionKeys) {
      this.renderedMotion[key]=this.previousMotion[key]+(motion[key]-this.previousMotion[key])*t;
    }
    return {motion:this.renderedMotion,axleResidual:this.previousAxleResidual+(this.axleResidual-this.previousAxleResidual)*t};
  }
}
