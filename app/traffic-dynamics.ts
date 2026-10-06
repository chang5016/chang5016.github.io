import {SCOOTER_DISPLAY_LENGTH,TRAFFIC_MOTORCYCLE_SCALE} from './vehicle-scale';
/** SI-unit traffic dynamics: jerk-limited longitudinal motion and damped chassis. */
export type VehicleClass = 'car' | 'taxi' | 'suv' | 'sports' | 'motorcycle';
export const VEHICLE_SPECS = {
  car: {length:4.69,width:1.9,wheelbase:2.9,track:1.62,radius:.364,travel:.075,acceleration:1.8,braking:3.3,headway:1.6,lateral:2},
  taxi: {length:4.69,width:1.9,wheelbase:2.9,track:1.62,radius:.364,travel:.075,acceleration:1.6,braking:3.3,headway:1.7,lateral:1.9},
  suv: {length:4.93,width:2,wheelbase:2.92,track:1.72,radius:.347,travel:.1,acceleration:1.5,braking:3.4,headway:1.7,lateral:1.8},
  sports: {length:4.527,width:1.94,wheelbase:2.65,track:1.65,radius:.368,travel:.055,acceleration:2.2,braking:3.6,headway:1.5,lateral:2.4},
  motorcycle: {length:SCOOTER_DISPLAY_LENGTH,width:.827336*TRAFFIC_MOTORCYCLE_SCALE,wheelbase:1.46*TRAFFIC_MOTORCYCLE_SCALE,track:0,radius:.31*TRAFFIC_MOTORCYCLE_SCALE,travel:.07*TRAFFIC_MOTORCYCLE_SCALE,acceleration:2,braking:3.3,headway:1.6,lateral:2.1},
} as const;
export type TrafficMotion = {speed:number;acceleration:number;distance:number;pitch:number;pitchRate:number;roll:number;rollRate:number;heave:number;heaveRate:number;steer:number};
export function createTrafficMotion():TrafficMotion {return {speed:0,acceleration:0,distance:0,pitch:0,pitchRate:0,roll:0,rollRate:0,heave:0,heaveRate:0,steer:0};}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function spring(value:number,rate:number,target:number,w:number,dt:number) {
  const x=value-target,c=rate+w*x,e=Math.exp(-w*dt);
  return [target+(x+c*dt)*e,(rate-w*c*dt)*e];
}
export function advanceTrafficMotion(state:TrafficMotion,kind:VehicleClass,dt:number,cruise:number,curvature:number,gap=Infinity,leaderSpeed=0,roadSpeedLimit=Infinity) {
  const s=VEHICLE_SPECS[kind], duration=clamp(dt,0,.25), steps=Math.max(1,Math.ceil(duration*120)), step=duration/steps;
  const target=Math.min(cruise,roadSpeedLimit,Math.sqrt(s.lateral/Math.max(Math.abs(curvature),.0001)));
  let travelled=0;
  for(let i=0;i<steps;i++) {
    let desired=s.acceleration*(1-(state.speed/Math.max(target,.1))**4);
    const remaining=gap-travelled;
    if(Number.isFinite(gap)) {
      const safe=1.4+Math.max(0,state.speed*s.headway+state.speed*(state.speed-leaderSpeed)/(2*Math.sqrt(s.acceleration*s.braking)));
      desired-=s.acceleration*(safe/Math.max(.2,remaining))**2;
    }
    desired=clamp(desired,-7.5,s.acceleration);
    const emergency=remaining<1.8+state.speed*state.speed/10;
    state.acceleration+=clamp(desired-state.acceleration,-(emergency?24:3.6)*step,2.4*step);
    const previous=state.speed;
    state.speed=Math.max(0,state.speed+state.acceleration*step);
    let distance=(previous+state.speed)*.5*step;
    if(leaderSpeed<.1 && Number.isFinite(gap) && distance>Math.max(0,remaining-.45)) {distance=Math.max(0,remaining-.45);state.speed=0;state.acceleration=0;}
    travelled+=distance;
  }
  state.distance-=travelled;
  const lateral=state.speed*state.speed*curvature;
  [state.pitch,state.pitchRate]=spring(state.pitch,state.pitchRate,clamp(state.acceleration*s.travel*.15,-.055,.04),11,duration);
  [state.roll,state.rollRate]=spring(state.roll,state.rollRate,kind==='motorcycle'?clamp(-Math.atan(lateral/9.81),-.32,.32):clamp(lateral*s.travel*.14,-.045,.045),kind==='motorcycle'?8:10,duration);
  [state.heave,state.heaveRate]=spring(state.heave,state.heaveRate,-Math.abs(state.pitch)*.1,12,duration);
  state.steer+=(clamp(-Math.atan(s.wheelbase*curvature),-.52,.52)-state.steer)*(1-Math.exp(-10*duration));
  return travelled;
}
export function ackermannSteering(steer:number,side:number,kind:VehicleClass) {
  const s=VEHICLE_SPECS[kind];if(Math.abs(steer)<.0001||!s.track)return steer;
  const radius=s.wheelbase/Math.tan(Math.abs(steer)),inner=side===-Math.sign(steer);
  return Math.sign(steer)*Math.atan(s.wheelbase/Math.max(.1,radius+(inner?-1:1)*s.track/2));
}
