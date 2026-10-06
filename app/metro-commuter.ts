import {createVehicle,intersectsBuilding,type VehicleState,type Coordinates,type BuildingBounds} from './game-core';
import {MetroSystem,METRO_STATIONS,METRO_TRACKS,METRO_DOORS,METRO_HALF_WIDTH,METRO_PLATFORM_GAP,METRO_FLOOR,LIFT_HALF,metroPlatform} from './metro-system';
import {createTrafficMotion,advanceTrafficMotion,VEHICLE_SPECS} from './traffic-dynamics';
import {SCOOTER_DISPLAY_LENGTH} from './vehicle-scale';
import {sampleTrafficRoute,advanceTrafficProgress,trafficTravelDistance,trafficCornerSpeed,type TrafficPath} from './traffic-path';
import {smoothTrafficPoints} from './traffic-route';
export type CommuterMode='approach'|'call-up'|'enter-up'|'lift-up'|'to-platform'|'waiting'|'boarding'|'riding'|'alighting'|'call-down'|'enter-down'|'lift-down'|'ground-exit'|'street-loop'|'road';
export type CommuterTraffic=Coordinates&{height:number;heading:number;speed:number;length:number;width:number};
type Context={ground:(p:Coordinates)=>number;obstacles:(p:Coordinates,height:number)=>BuildingBounds[]};
type Service={track:number;destination:number;start:'platform'|'street'};
/** One fixed-step driver, sharing the player's real lifts, doors and carriers. */
export class MetroCommuter {
 state:VehicleState=createVehicle();readonly motion=createTrafficMotion();height:number;mode:CommuterMode='lift-up';readonly history:CommuterMode[]=['lift-up'];
 readonly track:number;destination:number;readonly recurring:boolean;completedTrips=0;private path?:TrafficPath;private progress=0;private pathFloor=0;private neighbors:CommuterTraffic[]=[];
 constructor(readonly id:string,public origin:number,private system:MetroSystem,readonly road:TrafficPath,private context:Context,service?:Service){
  this.track=service?.track??(origin===0?0:1);this.destination=service?.destination??(origin===0?2:0);this.recurring=!!service;
  const lift=system.lifts[origin*2+this.track],track=METRO_TRACKS[this.track];
  this.state={...this.state,x:lift.x,z:lift.z,heading:this.track===0?0:Math.PI};this.height=lift.lower;
  if(service?.start==='platform'){this.state.x=this.doorAt(origin,true);this.state.z=track.z+track.side*(METRO_HALF_WIDTH+METRO_PLATFORM_GAP+3.25);this.height=METRO_FLOOR;this.mode='waiting';}
  else if(service){this.state.x=METRO_STATIONS[origin].x+2.4;this.state.z=-780;this.state.heading=0;this.height=context.ground(this.state)+.06;this.mode='approach';this.plan(this.entrance(origin),lift.lower);}
  this.history[0]=this.mode;system.registerParticipant(id,this.state,this.height);this.state=system.finishParticipant(id,this.state,this.height);
 }
 private doorAt(station:number,entering:boolean){return METRO_STATIONS[station].x+METRO_DOORS[this.recurring?4:5].x+(this.recurring?(entering?1:-1)*METRO_TRACKS[this.track].side*.62:0);}
 private entrance(station:number){const lift=this.system.lifts[station*2+this.track],x=METRO_STATIONS[station].x,outside=lift.z+LIFT_HALF+2.25;return this.track===0?[{x:x+2.4,z:-794},{x:lift.x,z:-794},{x:lift.x,z:outside}]:[{x:x+2.4,z:-794},{x:x+44,z:-794},{x:x+44,z:outside+3},{x:lift.x,z:outside+3},{x:lift.x,z:outside}];}
 private stage(mode:CommuterMode){this.mode=mode;this.history.push(mode);this.path=undefined;this.progress=0;}
 private plan(points:Coordinates[],floor:number){const raw=[{x:this.state.x,z:this.state.z},...points].filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>.002),smoothed=smoothTrafficPoints(raw,5.4);this.path={points:smoothed,width:5.4,laneCentered:true,length:smoothed.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-smoothed[i].x,p.z-smoothed[i].z),0)};this.progress=0;this.pathFloor=floor;}
 private move(dt:number,cruise:number,hero:Coordinates,heroHeight:number){
  if(!this.path)return false;const path=this.path,current=sampleTrafficRoute(path,this.progress,1),before=Math.max(0,this.progress-.6),after=Math.min(path.length,this.progress+.6),a=sampleTrafficRoute(path,before,1),b=sampleTrafficRoute(path,after,1),curvature=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading))/Math.max(.1,trafficTravelDistance(path,before,after,1));
  const spec=VEHICLE_SPECS.motorcycle,fx=Math.sin(current.heading),fz=-Math.cos(current.heading);let gap=Infinity,leader=0;
  const dx=hero.x-current.x,dz=hero.z-current.z,ahead=dx*fx+dz*fz,lateral=Math.abs(dx*fz-dz*fx);if(Math.abs(heroHeight-this.height)<1.4&&ahead>0&&lateral<(spec.width+1.24)/2+.08)gap=ahead-(spec.length+SCOOTER_DISPLAY_LENGTH)/2;
  for(const n of this.neighbors){if(Math.abs(n.height-this.height)>1.4||Math.hypot(n.x-current.x,n.z-current.z)>45)continue;const dx=n.x-current.x,dz=n.z-current.z,along=dx*fx+dz*fz,cross=dx*fz-dz*fx,alignment=Math.cos(n.heading-current.heading);
   if(along>0&&Math.abs(cross)<(spec.width+n.width)/2+.08&&alignment>.55){const g=along-(spec.length+n.length)/2;if(g<gap){gap=g;leader=Math.max(0,n.speed*alignment);}}
   else if(Math.abs(alignment)<.55&&n.speed>.2){const vx=Math.sin(n.heading)*n.speed,vz=-Math.cos(n.heading)*n.speed,t=-cross/(vx*fz-vz*fx),crossing=along+(vx*fx+vz*fz)*t;if(t>0&&t<2.5&&crossing>0&&crossing<Math.max(6,this.motion.speed*2.5)){gap=Math.min(gap,crossing-n.length/2-spec.length/2);leader=0;}}
  }
  const remaining=trafficTravelDistance(path,this.progress,path.length,1),limit=Math.min(Math.sqrt(remaining*3),trafficCornerSpeed(path,this.progress,1,12,1.5,1.6)),oldDistance=this.motion.distance,metres=advanceTrafficMotion(this.motion,'motorcycle',dt,cruise,curvature,gap,leader,limit),nextProgress=advanceTrafficProgress(path,this.progress,1,metres),next=sampleTrafficRoute(path,nextProgress,1);
  if(intersectsBuilding(next,[...this.context.obstacles(next,this.height),...this.system.obstaclesAt(next,this.height)],spec.width/2)){this.motion.distance=oldDistance;this.motion.speed=this.motion.acceleration=this.state.speed=0;return false;}
  this.progress=nextProgress;this.state={...this.state,...next,speed:this.motion.speed,throttle:this.motion.speed>.1?.35:0};this.height=this.pathFloor===METRO_FLOOR?METRO_FLOOR:this.context.ground(next)+.06;
  if(path.length-this.progress<.055){this.state.speed=this.motion.speed=this.motion.acceleration=0;return true;}return false;
 }
 step(dt:number,hero:Coordinates,heroHeight:number,neighbors:CommuterTraffic[]=[]){
  if(this.mode==='road')return;this.neighbors=neighbors;const carried=this.system.carryParticipant(this.id,this.state,this.height);this.state=carried.rider;this.height=carried.height;
  const originStage=['approach','call-up','enter-up','lift-up','to-platform','waiting','boarding','street-loop'].includes(this.mode),station=originStage?this.origin:this.destination,lift=this.system.lifts[station*2+this.track],platform=metroPlatform(station,this.track),track=METRO_TRACKS[this.track],doorX=this.doorAt(station,this.mode!=='riding'&&this.mode!=='alighting'),waitZ=track.z+track.side*(METRO_HALF_WIDTH+METRO_PLATFORM_GAP+3.25),train=this.system.trains[this.track];
  switch(this.mode){
   case 'approach':if(this.move(dt,4.6,hero,heroHeight))this.stage('call-up');break;
   case 'call-up':
    this.system.operateParticipant(this.id,this.state,this.height);
    if(lift.phase==='idle'&&lift.door>.98&&Math.abs(lift.height-lift.lower)<.1){this.stage('enter-up');this.plan([{x:lift.x,z:lift.z}],lift.lower);}break;
   case 'enter-up':if(this.move(dt,1.8,hero,heroHeight)){this.stage('lift-up');this.system.operateParticipant(this.id,this.state,this.height);}break;
   case 'lift-up':
    if(lift.phase==='idle'&&Math.abs(lift.height-lift.lower)<.1)this.system.operateParticipant(this.id,this.state,this.height);
    if(lift.phase==='idle'&&lift.door>.98&&Math.abs(lift.height-METRO_FLOOR)<.1){this.stage('to-platform');const aisle=platform.z+track.side*2.8;this.plan([{x:lift.x,z:aisle},{x:doorX,z:aisle},{x:doorX,z:waitZ}],METRO_FLOOR);}break;
   case 'to-platform':if(this.move(dt,5.2,hero,heroHeight))this.stage('waiting');break;
   case 'waiting':
    this.state.speed=this.motion.speed=0;
    if(this.system.boardingSignal(station,this.track)==='green'&&train.direction===Math.sign(this.destination-this.origin)&&this.system.capacity(train.id)>0){this.stage('boarding');this.plan([{x:doorX,z:track.z+track.side*.65}],METRO_FLOOR);}break;
   case 'boarding':if(this.move(dt,1.8,hero,heroHeight))this.stage('riding');else if(train.phase==='running')this.stage('waiting');break;
   case 'riding':
    this.state.speed=this.motion.speed=0;
    if(this.system.boardingSignal(this.destination,this.track)==='green'){this.stage('alighting');this.plan([{x:doorX,z:waitZ},{x:lift.x,z:platform.z},{x:lift.x,z:lift.z-track.side*(LIFT_HALF+2.25)}],METRO_FLOOR);}break;
   case 'alighting':if(this.move(dt,3.2,hero,heroHeight))this.stage('call-down');break;
   case 'call-down':
    this.system.operateParticipant(this.id,this.state,this.height);
    if(lift.phase==='idle'&&lift.door>.98&&Math.abs(lift.height-METRO_FLOOR)<.1){this.stage('enter-down');this.plan([{x:lift.x,z:lift.z}],METRO_FLOOR);}break;
   case 'enter-down':if(this.move(dt,1.8,hero,heroHeight)){this.stage('lift-down');this.system.operateParticipant(this.id,this.state,this.height);}break;
   case 'lift-down':
    if(lift.phase==='idle'&&lift.door>.98&&Math.abs(lift.height-lift.lower)<.1){this.stage('ground-exit');const x=METRO_STATIONS[station].x,end=this.recurring?{x:x-2.4,z:-794}:sampleTrafficRoute(this.road,8,1);this.plan(this.track===0?[{x:lift.x,z:lift.z+7},{x:lift.x,z:-794},{x:x+4,z:-794},end]:[{x:lift.x,z:lift.z+6.8},{x:x+44,z:lift.z+6.8},{x:x+44,z:-802},{x:x+30,z:-794},{x:x+4,z:-794},end],lift.lower);}break;
   case 'ground-exit':if(this.move(dt,2.8,hero,heroHeight)){
    if(!this.recurring){this.stage('road');this.system.removeParticipant(this.id);return;}
    this.completedTrips++;const from=this.origin;this.origin=this.destination;this.destination=from;this.stage('street-loop');const x=METRO_STATIONS[this.origin].x;this.plan([{x:x-2.4,z:-780},{x:x+2.4,z:-780},...this.entrance(this.origin)],lift.lower);
   }break;
   case 'street-loop':if(this.move(dt,4.6,hero,heroHeight))this.stage('call-up');break;
  }
  this.state=this.system.finishParticipant(this.id,this.state,this.height);
 }
 dispose(){this.system.removeParticipant(this.id);}
}
