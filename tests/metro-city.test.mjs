import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withDownloadedMetroFiles } from './downloaded-metro-loader.mjs';
import { RealWorldMap, authoredExpresswayPlan } from '../app/real-world-map.ts';
import { MetroScene } from '../app/metro-scene.ts';
import { MetroSystem, METRO_FLOOR, METRO_STATIONS, METRO_DOORS, METRO_HALF_WIDTH, METRO_PLATFORM_HALF, LIFT_HALF, metroPlatform, metroConcourse, metroStreetApproach } from '../app/metro-system.ts';
import { createVehicle, EMPTY_INPUT, intersectsBuilding, stepVehicle, coordinatesFromLocation } from '../app/game-core.ts';
import { createVerticalVehicle, stepVerticalVehicle } from '../app/vehicle-vertical-physics.ts';

test('six downloaded lift return journeys, graded entrances and complete imported stations fit the actual city', async () => withDownloadedMetroFiles(async () => {
  const scene = new THREE.Scene(), world = new RealWorldMap(scene, 1);
  const metro = new MetroSystem(point => world.elevationAt(point), (point, radius) => world.transportSupportClears(point, radius));
  let visuals;
  try {
    visuals = new MetroScene(scene, metro, point => world.elevationAt(point));
    await visuals.ready;
    assert.equal(visuals.root.userData.downloadedMetroLoaded, true); assert.ok(visuals.trains.every(train => train.cars.length === 2));
    scene.updateMatrixWorld(true);
    const overlaps=(a,b)=> {
      for(const polygon of [a,b])for(let i=0;i<polygon.length;i++) {
        const p=polygon[i],q=polygon[(i+1)%polygon.length],axis={x:-(q.z-p.z),z:q.x-p.x};
        const projection=points=>points.map(v=>v.x*axis.x+v.z*axis.z),pa=projection(a),pb=projection(b);
        if(Math.max(...pa)<=Math.min(...pb)||Math.max(...pb)<=Math.min(...pa))return false;
      }
      return true;
    };
    for(let station=0;station<3;station++) {
      const h=metroConcourse(station),corners=[{x:h.x-h.halfWidth,z:h.z-h.halfDepth},{x:h.x+h.halfWidth,z:h.z-h.halfDepth},{x:h.x+h.halfWidth,z:h.z+h.halfDepth},{x:h.x-h.halfWidth,z:h.z+h.halfDepth}];
      for(const road of world.elevatedSegments) {
        const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,length=Math.hypot(dx,dz);if(length<.001)continue;
        const normal={x:-dz/length,z:dx/length};
        const point=(at,side,width)=>({x:at.x+normal.x*side*(width/2+.35),z:at.z+normal.z*side*(width/2+.35)});
        const footprint=road.footprint??[point(road.a,-1,road.startWidth??road.width),point(road.b,-1,road.endWidth??road.width),point(road.b,1,road.endWidth??road.width),point(road.a,1,road.startWidth??road.width)];
        assert.equal(overlaps(corners,footprint),false,`${METRO_STATIONS[station].id}: a highway or ramp cannot occupy the complete hall volume: ${JSON.stringify(road.a)}`);
      }
    }
    const grass=scene.getObjectByName('Dense collision-cleared urban grass tufts');assert.ok(grass?.isInstancedMesh);
    const grassMatrix=new THREE.Matrix4(),grassPosition=new THREE.Vector3();
    for(let instance=0;instance<grass.count;instance++) {
      grass.getMatrixAt(instance,grassMatrix);grassPosition.setFromMatrixPosition(grassMatrix).applyMatrix4(grass.matrixWorld);
      for(let station=0;station<3;station++)for(const area of [metroConcourse(station),metroStreetApproach(station)])assert.ok(Math.abs(grassPosition.x-area.x)>area.halfWidth+1||Math.abs(grassPosition.z-area.z)>area.halfDepth+1,'No grass tuft may grow through the station or its paved street access');
    }
    for(const lift of metro.lifts)for(const dx of [-1.3,0,1.3])for(const dz of [-1.3,0,1.3]) {
      const hits=new THREE.Raycaster(new THREE.Vector3(lift.x+dx,lift.lower+.10,lift.z+dz),new THREE.Vector3(0,-1,0),0,.102).intersectObject(visuals.root,true).filter(hit=>Math.abs(hit.point.y-lift.lower)<.002);
      assert.equal(new Set(hits.map(hit=>hit.object.uuid+':'+hit.instanceId)).size,1,'Only the moving carrier has a floor in the lift well; no coplanar lobby tile can flicker over it');
    }
    for(let station=0;station<3;station++)for(let track=0;track<2;track++) {
      const platform=metroPlatform(station,track),hall=metroConcourse(station);
      for(const dz of [-4.92,0,4.92])for(const dy of [.25,1.3,3.05]) {
        const hits=new THREE.Raycaster(new THREE.Vector3(hall.x-hall.halfWidth-1.5,METRO_FLOOR+dy,platform.z+dz),new THREE.Vector3(1,0,0),0,3).intersectObject(visuals.root,true);
        assert.equal(hits.length,0,'Complete imported window bays must clear both full platform riding passages: '+JSON.stringify({station,track,dz,dy}));
      }
    }
    const docked = metro.trains[0];
    for (const door of METRO_DOORS) for (let across = METRO_HALF_WIDTH - .16; across < METRO_HALF_WIDTH + .22; across += .02) {
      const hits = new THREE.Raycaster(new THREE.Vector3(docked.x + door.x, METRO_FLOOR + .2, docked.z + across), new THREE.Vector3(0, -1, 0), 0, .25).intersectObject(visuals.root, true);
      assert.ok(hits.length > 0, 'Rendered carriage threshold has no visible floor gap');
      assert.ok(Math.abs(hits[0].point.y - METRO_FLOOR) < .04, 'Floor or tactile paving stays within four centimetres of the carriage floor');
    }
    assert.ok(metro.fixtures.length >= 60, 'Imported structural posts and seating register measured physical bounds');
    for (const pier of metro.piers) assert.ok(world.transportSupportClears(pier, 2.05), 'Footing must clear every road level: ' + JSON.stringify(pier));
    assert.equal(metro.piers.some(pier => pier.x === -672 && pier.z === -842.5), false, 'Remove the old pier inside the south-ring transfer ramp');

    // Test actual imported door apertures, not just their simulation boxes.
    for (const lift of metro.lifts) for (const upper of [false, true]) {
      lift.height = lift.previousHeight = upper ? METRO_FLOOR : lift.lower; lift.door = lift.previousDoor = 1;
      visuals.render(1); scene.updateMatrixWorld(true);
      const face = upper && lift.track === 0 ? -1 : 1;
      for (const dx of [-.63, 0, .63]) for (const dy of [.25, 1.1, 2.95]) {
        const hits = new THREE.Raycaster(new THREE.Vector3(lift.x + dx, lift.height + dy, lift.z + face * 4.1), new THREE.Vector3(0, 0, -face), 0, 4.1).intersectObject(visuals.root, true);
        assert.equal(hits.length, 0, 'Imported lift doorway must clear the whole scooter: ' + JSON.stringify({ id: lift.id, upper, dx, dy, hits: hits.map(hit => ({ name: hit.object.name, point: hit.point.toArray() })) }));
      }
      lift.height = lift.previousHeight = lift.lower;
    }
    visuals.render(1);

    const checkPath = (a, b, height, description) => {
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / .25);
      for (let step = 0; step <= steps; step++) {
        const fraction = step / steps, point = { x: a.x + (b.x - a.x) * fraction, z: a.z + (b.z - a.z) * fraction };
        const obstacles = [...world.nearbyStaticObstacles(point, 42, height), ...metro.obstaclesAt(point, height)];
        assert.equal(intersectsBuilding(point, obstacles, .4), false, description + ': obstruction at ' + JSON.stringify(point));
        const surface = metro.surfaceAt(point, height) ?? world.elevationAt(point, 0, height);
        assert.ok(Math.abs(surface - height) < .1, description + ': continuous pavement ' + JSON.stringify({point,height,surface}));
      }
    };
    for (const lift of metro.lifts) {
      const station = METRO_STATIONS[lift.station], south = metro.lifts[lift.station * 2];
      checkPath({ x: station.x + 20, z: -794 }, { x: south.x, z: -794 }, lift.lower, station.id + ' concourse');
      checkPath({ x: south.x, z: -794 }, { x: south.x, z: -802 }, lift.lower, station.id + ' A route');
      if (lift.track === 0) checkPath({ x: lift.x, z: -802 }, { x: lift.x, z: lift.z + LIFT_HALF + .5 }, lift.lower, station.id + ' south approach');
      else {
        const branch = lift.z + LIFT_HALF + 3.2, x = station.x + 44;
        checkPath({ x: south.x, z: -802 }, { x, z: -802 }, lift.lower, station.id + ' north access');
        checkPath({ x, z: -802 }, { x, z: branch }, lift.lower, station.id + ' north bypass');
        checkPath({ x, z: branch }, { x: lift.x, z: branch }, lift.lower, station.id + ' north branch');
      }
      for (const dx of [30, 44]) checkPath({ x: station.x + dx, z: -788 }, { x: station.x + dx, z: -802 }, lift.lower, station.id + ' distribution lane');
      for (let x = station.x + 10; x < station.x + 20; x += .5) {
        const point = { x, z: -794 }, ground = world.elevationAt(point, 0, lift.lower);
        const floor = new THREE.Raycaster(new THREE.Vector3(x, ground + .3, -794), new THREE.Vector3(0, -1, 0), 0, .5).intersectObject(visuals.root, true)[0];
        assert.ok(floor, station.id + ' driveway meets the adjacent road');
        assert.ok(Math.abs(floor.point.y - (ground + .06)) < .04, station.id + ' driveway matches the graded ground');
      }
    }
    const dt = 1 / 60;
    const ride = (rider, vertical, input = EMPTY_INPUT) => {
      const before = vertical.height, motion = metro.beginStep(rider, vertical.height, dt); rider = motion.rider;
      if (motion.carrierHeight !== undefined) vertical = { ...vertical, height: motion.carrierHeight };
      const limit = metro.speedLimitAt(rider, vertical.height);
      if (motion.locked) rider = { ...rider, speed: 0, throttle: 0 };
      else {
        const obstacles = [...world.nearbyStaticObstacles(rider, 42, vertical.height), ...metro.obstaclesAt(rider, vertical.height)];
        rider = stepVehicle(rider, input, dt, obstacles, 0, 0, 1, metro.collisionRadiusAt(rider, vertical.height));
        rider.speed = Math.max(-limit, Math.min(limit, rider.speed));
        assert.equal(rider.collided, false, 'A clear station journey must not hit a hidden city or station collider');
      }
      rider = metro.endStep(rider, vertical.height);
      const floor = metro.surfaceAt(rider, vertical.height) ?? world.elevationAt(rider, rider.heading, vertical.height);
      vertical = metro.carrier ? { ...vertical, height: floor, grounded: true, lastGroundHeight: floor, velocity: (floor - before) / dt } : stepVerticalVehicle(vertical, floor, dt);
      return [rider, vertical];
    };
    for (const lift of metro.lifts) {
      metro.carrier = null;
      let rider = { ...createVehicle(), x: lift.x, z: lift.z + 4.1, heading: 0 }, vertical = createVerticalVehicle(lift.lower);
      for (let i = 0; i < 80; i++) [rider, vertical] = ride(rider, vertical, { ...EMPTY_INPUT, forward: true });
      for (let i = 0; i < 45; i++) [rider, vertical] = ride(rider, vertical, { ...EMPTY_INPUT, brake: true });
      assert.equal(metro.whollyInLift(lift, rider), true, 'Lift ' + lift.id + ' physical entry');
      assert.match(metro.operate(rider, vertical.height), /上行/);
      let guard = 0;
      while (lift.phase !== 'idle' && guard++ < 1200) [rider, vertical] = ride(rider, vertical);
      assert.ok(guard < 1200); assert.equal(vertical.height, METRO_FLOOR);
      const exitHeading = lift.track === 0 ? 0 : Math.PI;
      rider = { ...rider, speed: 0, heading: exitHeading };
      for (let i = 0; i < 400; i++) {
        const distance = Math.abs(rider.z - metroPlatform(lift.station, lift.track).z);
        [rider, vertical] = ride(rider, vertical, { ...EMPTY_INPUT, forward: distance > rider.speed*rider.speed/18 + .12, brake: distance <= rider.speed*rider.speed/18 + .12 });
        if (distance < .15 && rider.speed < .03) break;
      }
      assert.equal(metro.carrier, null); assert.equal(vertical.height, METRO_FLOOR, 'Lift ' + lift.id + ' reaches its platform');
      assert.ok(Math.abs(rider.z - metroPlatform(lift.station, lift.track).z) < METRO_PLATFORM_HALF);
      rider = { ...rider, speed: 0, heading: exitHeading + Math.PI };
      for (let i = 0; i < 400; i++) {
        const distance = Math.abs(rider.z - lift.z);
        [rider, vertical] = ride(rider, vertical, { ...EMPTY_INPUT, forward: distance > rider.speed*rider.speed/18 + .12, brake: distance <= rider.speed*rider.speed/18 + .12 });
        if (distance < .15 && rider.speed < .03) break;
      }
      assert.equal(metro.whollyInLift(lift, rider), true, 'Lift ' + lift.id + ' return entry');
      assert.match(metro.operate(rider, vertical.height), /下行/);
      guard = 0; while (lift.phase !== 'idle' && guard++ < 1200) [rider, vertical] = ride(rider, vertical);
      assert.ok(guard < 1200); assert.equal(vertical.height, lift.lower);
      rider = { ...rider, speed: 0, heading: Math.PI };
      for (let i = 0; i < 140; i++) [rider, vertical] = ride(rider, vertical, { ...EMPTY_INPUT, forward: true });
      assert.equal(metro.carrier, null); assert.ok(Math.abs(vertical.height - lift.lower) < .1, 'Lift ' + lift.id + ' returns to street');
    }
    const crossing = { x: -650, z: -842.5 }, originalHighway = world.elevationAt(crossing, 0, 13);
    assert.ok(originalHighway < METRO_FLOOR - 6); assert.equal(metro.surfaceAt(crossing, originalHighway), undefined);
    const plan=authoredExpresswayPlan(),approaches=plan.ramps;
    assert.equal(approaches.length,4);
    for(const approach of approaches){
      assert.equal(approach.properties.two_way,true);assert.equal(approach.properties.oneway,false);assert.equal(approach.properties.lanes,Number(approach.properties.approach_width)>10?4:2);
    }
    const connectors=plan.cityInterchangeRamps.filter(f=>f.properties.mainline_connector===true);assert.ok(connectors.length>0);
    for(const feature of connectors){
      const coordinates=feature.geometry.coordinates;
      for(const [coordinate,key]of [[coordinates[0],'startWidth'],[coordinates.at(-1),'endWidth']]){
        const endpoint=coordinatesFromLocation({longitude:coordinate[0],latitude:coordinate[1]});
        const segments=world.elevatedSegments.filter(s=>Math.hypot((key==='startWidth'?s.a:s.b).x-endpoint.x,(key==='startWidth'?s.a:s.b).z-endpoint.z)<.02);
        assert.ok(segments.some(s=>s[key]>=15.9),'A full-width highway transfer must not finish as a 2.8 m branch: '+feature.properties.name);
      }
    }
    const yellow=[];scene.traverse(object=>{if(object.name.includes('Double yellow centre lines on two-way'))yellow.push(object);});
    assert.ok(yellow.length>0,'Two-way approaches have physical double-yellow centre markings');
    const lanePaint=scene.getObjectByName('Bridge and ramp lane markings');assert.ok(lanePaint?.geometry?.getAttribute('position').count>1000,'Whole highway lane-paint batch must remain visible after joining original street lanes');
  } finally {
    visuals?.dispose(); world.dispose();
  }
}));
