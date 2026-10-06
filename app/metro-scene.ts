import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchCityMesh, disposeCityBatch } from './city-multidraw';
import { freezeStaticScene } from './static-scene';
import { DownloadedMetroAssets, type MetroDisplay, type MetroSource, type MetroInstances } from './metro-assets';
import { createDownloadedMetroCar } from './metro-model';
import type { BuildingBounds, Coordinates, VehicleState } from './game-core';
import { METRO_CAR_OFFSETS, METRO_CAR_INTERIOR_HALF, METRO_CAR_INTERIOR_CENTER, METRO_DOOR_WIDTH, METRO_FLOOR, METRO_HALF_WIDTH, METRO_STATIONS, METRO_TRACKS, MetroSystem, METRO_DOORS, METRO_PLATFORM_HALF, METRO_RAIL_HALF_WIDTH, METRO_INTERIOR_HEIGHT, METRO_BIKE_CAPACITY, METRO_DWELL, METRO_DOOR_SECONDS, METRO_TERMINAL_RUNOFF, metroRunSeconds, LIFT_HALF, metroConcourse, metroStreetApproach, metroLiftLanding, metroPlatform, METRO_PLATFORM_GAP, metroScreenEdge } from './metro-system';

type TrainVisual = { group: THREE.Group; cars: ReturnType<typeof createDownloadedMetroCar>[]; bridgePlates: THREE.Group; signature: string };
type LiftLeaf = { instance: number; side: number; sign: number; level?: number; baseX: number };
type LiftVisual = { group: THREE.Group; doors: LiftLeaf[]; landings: LiftLeaf[]; indicator: MetroDisplay; signature: string };
type StationVisual = { doors: { instance: number; track: number; sign: number; x: number; z: number }[]; boards: {board:MetroDisplay;track:number}[]; hall?: MetroDisplay };

/** Downloads supply every visible surface. The scene owns placement, physics
 * synchronization and information displayed on the imported display devices. */
export class MetroScene {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly trains: TrainVisual[] = [];
  readonly lifts: LiftVisual[] = [];
  private assets = new DownloadedMetroAssets();
  private stations: StationVisual[] = [];
  private platformScreenPoses:{x:number;z:number;scale:number}[]=[];
  private batches: THREE.BatchedMesh[] = [];
  private geometries = new Set<THREE.BufferGeometry>();
  private platformDoorInstances!: MetroInstances;
  private liftDoorInstances!: MetroInstances;
  private liftCabins!: MetroInstances;
  private liftFloors!: MetroInstances;
  private disposed = false;
  private built = false;
  private cabinLights: THREE.PointLight[] = [];
  private stone!:THREE.MeshStandardMaterial;
  private grout!:THREE.MeshStandardMaterial;
  private warningStone!:THREE.MeshStandardMaterial;
  private guideStone!:THREE.MeshStandardMaterial;
  private structuralSteel!:THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene, readonly system: MetroSystem, private ground: (point: Coordinates) => number) {
    this.root.name = '海灣捷運 / downloaded complete train and planned station';
    scene.add(this.root);
    // Stable light count avoids a shader rebuild when entering/leaving a train.
    for (let i=0;i<3;i++) {
      const light=new THREE.PointLight('#fff5e7',0,19,2);
      light.name='Metro cabin LED illumination '+i; light.castShadow=false;
      this.cabinLights.push(light);this.root.add(light);
    }
    this.ready = this.initialize();
  }

  private async initialize() {
    await this.assets.load();
    if (this.disposed) { this.assets.dispose(); return; }
    this.stone=this.assets.material('station-paving','Metro terrazzo / 600 mm module');
    this.grout=this.stone.clone();this.grout.name='Station closed slab / recessed stone joints';this.grout.color.set('#7b8584');this.grout.map=this.grout.normalMap=this.grout.roughnessMap=null;this.grout.roughness=.96;
    this.warningStone=this.stone.clone();this.warningStone.name='Downloaded stone / yellow platform warning course';this.warningStone.color.set('#e1bb4d');this.warningStone.map=null;
    this.guideStone=this.stone.clone();this.guideStone.name='Downloaded stone / blue motorcycle wayfinding course';this.guideStone.color.set('#367b9a');this.guideStone.map=null;
    this.structuralSteel=this.assets.material('canopy','Steel').clone();this.structuralSteel.name='Downloaded canopy steel / coherent atrium structure';
    for(const material of [this.grout,this.warningStone,this.guideStone,this.structuralSteel])this.assets.materials.add(material);
    this.platformDoorInstances = this.assets.instances('platform-door', 72);
    this.liftDoorInstances = this.assets.instances('lift-door', 48);
    this.liftCabins = this.assets.instances('lift-cabin', 6);
    this.liftFloors = this.assets.instances('lift-floor', 6);
    for (const instances of this.instanceGroups()) this.root.add(instances.root);
    this.buildRailway();
    METRO_STATIONS.forEach((_, index) => this.buildStation(index));
    const fixed=this.assets.instances('platform-door',this.platformScreenPoses.length);
    fixed.root.userData.dynamicWorldObject=false;fixed.root.name='Imported full-height platform screen wall / shared glazing and aluminium';
    this.platformScreenPoses.forEach((p,i)=>fixed.set(i,p.x,METRO_FLOOR,p.z,0,p.scale));fixed.commit();this.root.add(fixed.root);
    this.system.trains.forEach(train => this.buildTrain(train.id));
    this.system.lifts.forEach(lift => this.buildLift(lift.id));
    this.auditSources();
    this.batchArchitecture();
    this.built = true; this.render(1); freezeStaticScene(this.root);
    this.root.userData.downloadedMetroLoaded = true;
  }

  private instanceGroups() { return [this.platformDoorInstances, this.liftDoorInstances, this.liftCabins, this.liftFloors].filter(Boolean); }

  private group(name: string, dynamic = false, parent = this.root) {
    const group = new THREE.Group(); group.name = name; group.userData.dynamicWorldObject = dynamic; parent.add(group); return group;
  }

  private placed(name: string, x: number, y: number, z: number, parent = this.root, angle = 0) {
    const model = this.assets.create(name); model.position.set(x, y, z); model.rotation.y = angle; parent.add(model); return model;
  }

  private slab(area: BuildingBounds, floor: number, parent = this.root, angle = 0, joints = false) {
    const model = this.assets.sized('platform', area.halfWidth * 2, null, area.halfDepth * 2, area.x, floor, area.z, angle);
    parent.add(model);model.updateWorldMatrix(true,true);
    const stripes:THREE.Object3D[]=[];
    model.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material))return;
      if(mesh.material.name==='Stripe'){stripes.push(mesh);return;}
      if(mesh.material.name!=='Pflasterstein')return;
      mesh.material=joints?this.grout:this.stone;
      const geometry=mesh.geometry.clone(),p=geometry.attributes.position,uv=geometry.attributes.uv,v=new THREE.Vector3();
      for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);uv.setXY(i,v.x/2,v.z/2);}
      mesh.geometry=geometry;this.geometries.add(geometry);
    });stripes.forEach(part=>part.removeFromParent());
    return model;
  }

  private platformPaving(index:number,track:number,parent:THREE.Group) {
    const platform=metroPlatform(index,track),side=METRO_TRACKS[track].side;
    const counts=[0,0,0],poses:{x:number;z:number;angle:number;kind:number}[]=[];
    for(let col=0;col<128;col++)for(let row=0;row<20;row++) {
      const edgeRow=side>0?row:19-row,kind=edgeRow===1?1:edgeRow===15?2:0;
      poses.push({x:platform.x-platform.halfWidth+(col+.5)*76/128,z:platform.z-platform.halfDepth+(row+.5)*11.2/20,angle:(col+row)%2?Math.PI:0,kind});counts[kind]++;
    }
    for(let kind=0;kind<3;kind++) {
      const tiles=this.assets.instances('station-paving',counts[kind]);tiles.root.userData.dynamicWorldObject=false;
      tiles.root.name=`${METRO_STATIONS[index].id} ${track===0?'A':'B'} physical metric stone course ${kind}`;
      tiles.meshes.forEach(mesh=>{mesh.material=[this.stone,this.warningStone,this.guideStone][kind];mesh.castShadow=false;});
      let at=0;for(const p of poses)if(p.kind===kind)tiles.set(at++,p.x,METRO_FLOOR,p.z,p.angle);
      tiles.commit();parent.add(tiles.root);
    }
    parent.userData.platformFinishes??=[];parent.userData.platformFinishes.push({track,tiles:poses.length,jointWidth:.002,top:METRO_FLOOR+.012,tilePitch:[76/128,11.2/20],pbr:true});
  }

  private frameBeam(x:number,z:number,length:number,top:number,height:number,depth:number,angle:number,parent:THREE.Group,role:string) {
    const beam=this.assets.sized('guideway',length,height,depth,x,top,z,angle);
    beam.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)mesh.material=this.structuralSteel;});
    beam.name=`Downloaded structural girder / ${role}`;parent.add(beam);this.assets.fitSurfaceUv(beam);return beam;
  }

  private board(lines: string[], x: number, y: number, z: number, width: number, height: number, angle = 0, parent = this.root, kind: 'hanging-display' | 'door-display' = 'hanging-display', channel?:string) {
    const board = this.assets.display(kind, width, height,channel);
    board.root.position.set(x, y, z); board.root.rotation.y = angle;
    board.root.userData.dynamicWorldObject = true; parent.add(board.root); this.assets.paint(board, lines); return board;
  }

  private fixture(group: THREE.Object3D, top?: number) {
    group.updateWorldMatrix(true, true); const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    this.system.addFixture({ x: centre.x, z: centre.z, halfWidth: size.x / 2, halfDepth: size.z / 2 }, bounds.min.y, top ?? bounds.max.y);
  }

  private buildRailway() {
    const group = this.group('Downloaded railway guideway, complete rails and audited bridge piers');
    const start = METRO_STATIONS[0].x - METRO_TERMINAL_RUNOFF, end = METRO_STATIONS[2].x + METRO_TERMINAL_RUNOFF;
    for (let x = start; x < end; x += 48) {
      const length = Math.min(48, end - x), b = this.assets.getBounds('guideway');
      const deck = this.assets.sized('guideway', length, null, METRO_RAIL_HALF_WIDTH * 2, x + length / 2, METRO_FLOOR - 3.46 + b.max.y, -842.5);
      group.add(deck);
    }
    // The authored steel is one metre long. Sleeper skirts extend further.
    // Keep native geometry and cull spatial instance chunks independently.
    for (const track of METRO_TRACKS) for (let chunk = start; chunk < end; chunk += 96) {
      const count = Math.min(96, end - chunk), rails = this.assets.instances('rail', count);
      group.add(this.assets.sized('boarding-threshold',count,.28,3.40,chunk+count/2,METRO_FLOOR-2.866,track.z));
      rails.root.userData.dynamicWorldObject = false;
      for (let i = 0; i < count; i++) rails.set(i, chunk + i + .5, METRO_FLOOR - 2.613455, track.z, Math.PI / 2);
      rails.commit(); group.add(rails.root);
    }
    for (const track of METRO_TRACKS) for (const [x,angle] of [[start+5,0],[end-5,Math.PI]]) {
      this.placed('buffer-stop',x,METRO_FLOOR-2.613455,track.z,group,angle);
    }
    for (const side of [-1,1]) this.railing((start+end)/2,-842.5+side*METRO_RAIL_HALF_WIDTH,METRO_FLOOR-2.62,end-start,group);
    for (const x of [start,end]) {
      this.railing(x,-842.5,METRO_FLOOR-2.62,METRO_RAIL_HALF_WIDTH*2,group,Math.PI/2);
      this.board(['軌道終點　禁止通行','END OF TRACK','緩衝止擋　安全保留區'],x,METRO_FLOOR+.65,-842.5,4.6,.65,x===start?0:Math.PI,group,'door-display');
    }
    const native = this.assets.getBounds('pier');
    for (const pier of this.system.piers) {
      const height = METRO_FLOOR - (Math.abs(pier.z + 842.5) < .01 ? 3.96 : 1.8) - pier.bottom;
      const model = this.assets.create('pier'); model.position.set(pier.x, pier.bottom, pier.z);
      const crosshead = Math.abs(pier.z + 842.5) < .01 ? METRO_RAIL_HALF_WIDTH * 2 : METRO_PLATFORM_HALF * 2;
      model.traverse(object => {
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        const geometry = mesh.geometry.clone(), p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const sourceY = p.getY(i), cap = THREE.MathUtils.smoothstep(sourceY, native.max.y - 1.1, native.max.y - .8);
          const zScale = 1 + cap * (crosshead / (native.max.z - native.min.z) - 1);
          p.setXYZ(i, p.getX(i) * pier.radius, (sourceY - native.min.y) * height / (native.max.y - native.min.y), p.getZ(i) * zScale);
        }
        geometry.computeVertexNormals(); mesh.geometry = geometry; this.geometries.add(geometry);
      });
      this.assets.fitSurfaceUv(model);
      group.add(model);
    }
  }

  private canopy(x: number, floor: number, z: number, width: number, depth: number, parent: THREE.Group) {
    const bounds = this.assets.getBounds('canopy'), size = bounds.getSize(new THREE.Vector3());
    const roof = this.assets.create('canopy'); roof.scale.set(width / size.x, 1.5, depth / size.z); roof.position.set(x, floor - bounds.min.y * 1.5, z); parent.add(roof);
    // Measure the original concrete foot; a full roof AABB would block the aisle.
    roof.traverse(object => {
      const mesh = object as THREE.Mesh;
      if(!mesh.isMesh||Array.isArray(mesh.material))return;
      if(mesh.material.name==='Beton')this.fixture(mesh,floor+6.4);
      if(mesh.material.name==='Steel')mesh.material=this.structuralSteel;
    });
    this.assets.fitSurfaceUv(roof);
    return roof;
  }

  private railing(x: number, z: number, floor: number, length: number, parent: THREE.Group, angle = 0) {
    if (length < .06) return;
    const native = this.assets.getBounds('platform-railing'), centre = native.getCenter(new THREE.Vector3());
    const holder = new THREE.Group(); holder.position.set(x, floor, z); holder.rotation.y = angle; parent.add(holder);
    // Complete authored railing sections retain regularly spaced uprights.
    // A single 10-m section stretched across 76 m left implausibly long spans.
    const sections=Math.abs(floor-METRO_FLOOR)<.01?Math.ceil(length/8):1,span=length/sections;
    for(let i=0;i<sections;i++) {
      const railing=this.assets.create('platform-railing');railing.scale.set(span/(native.max.x-native.min.x),1.65,1);
      railing.position.set(-length/2+(i+.5)*span-centre.x*railing.scale.x,0,-centre.z);holder.add(railing);
    }
    this.assets.fitSurfaceUv(holder);
  }

  private railBoundary(x: number, z: number, floor: number, from: number, to: number, openings: { x: number; width: number }[], parent: THREE.Group) {
    let edge = from;
    for (const opening of openings) {
      const left = opening.x - opening.width / 2;
      if (left > edge) this.railing(x + (edge + left) / 2, z, floor, left - edge, parent);
      edge = opening.x + opening.width / 2;
    }
    if (to > edge) this.railing(x + (edge + to) / 2, z, floor, to - edge, parent);
  }

  private screenBoundary(x:number,z:number,side:number,openings:{x:number;width:number}[],parent:THREE.Group) {
    let from=-38;
    const fill=(to:number)=>{
      const count=Math.ceil((to-from)/1.525);if(count<=0)return;const width=(to-from)/count;
      for(let i=0;i<count;i++)this.platformScreenPoses.push({x:x+from+(i+.5)*width,z,scale:width/1.525});
    };
    for(const opening of openings){fill(opening.x-opening.width/2);from=opening.x+opening.width/2;}
    fill(38);
    parent.add(this.assets.sized('boarding-threshold',76,.19,.25,x,METRO_FLOOR+3.55,z));
  }

  private buildStation(index: number) {
    const station = METRO_STATIONS[index], group = this.group(`${station.id} imported station / road-clear concourse`);
    const visual: StationVisual = { doors: [], boards: [] };
    for (let track = 0; track < 2; track++) {
      const platform = metroPlatform(index, track), side = METRO_TRACKS[track].side, lift = this.system.lifts[index * 2 + track];
      for (let i = 0; i < 8; i++) this.slab({ x: station.x - 38 + (i + .5) * 9.5, z: platform.z, halfWidth: 4.75, halfDepth: METRO_PLATFORM_HALF }, METRO_FLOOR, group, side > 0 ? 0 : Math.PI,true);
      this.platformPaving(index,track,group);
      for (let i = 0; i < 7; i++) this.canopy(station.x - 38 + (i + .5) * 76 / 7, METRO_FLOOR, platform.z, 76 / 7 + .05, METRO_PLATFORM_HALF * 2 + .3, group);
      const edge = metroScreenEdge(track);
      this.screenBoundary(station.x,edge,side,METRO_DOORS.map(door=>({x:door.x,width:METRO_DOOR_WIDTH})),group);
      this.railBoundary(station.x, platform.z + side * METRO_PLATFORM_HALF, METRO_FLOOR, -38, 38, [{ x: 30, width: 5.4 }], group);
      for (const end of [-38, 38]) this.railing(station.x + end, platform.z, METRO_FLOOR, METRO_PLATFORM_HALF * 2, group, Math.PI / 2);
      for (const door of METRO_DOORS) for (const sign of [-1, 1]) {
        visual.doors.push({ instance: index * 24 + visual.doors.length, track, sign, x: station.x + door.x + sign * METRO_DOOR_WIDTH / 4, z: edge });
      }
      for(const opening of METRO_DOORS)for(const sign of [-1,1])for(const face of [-1,1])this.placed('platform-pocket',station.x+opening.x+sign*(METRO_DOOR_WIDTH/2+.86),METRO_FLOOR,edge+face*.1025,group,face>0?0:Math.PI);
      const landing = metroLiftLanding(lift);
      this.slab(landing, METRO_FLOOR, group);
      for (const dx of [-landing.halfWidth, landing.halfWidth]) this.railing(landing.x + dx, landing.z, METRO_FLOOR, landing.halfDepth * 2, group, Math.PI / 2);
      for (const offset of [-28, -16, -5]) this.fixture(this.placed('bench', station.x + offset, METRO_FLOOR + .006, platform.z + side * 4.6, group, side < 0 ? Math.PI : 0));
      // Faces X, toward the motorcycle approach along the platform; not the rails.
      for(const [offset,angle] of [[24,0],[-26,Math.PI]]) {
        const board=this.board([`${station.id} ${station.name}　${track===0?'A':'B'} 月台`,'BLUE LINE　海灣高架線','等待列車資訊'],station.x+offset,METRO_FLOOR+5.5,platform.z,6.2,1.15,angle,group,'hanging-display',`platform-${index}-${track}`);
        visual.boards.push({board,track});
      }
      this.board([`${track === 0 ? 'A' : 'B'} PLATFORM　${track === 0 ? '←' : '→'} 候車車道`, '月台速限 25 km/h　依綠燈上車', '出口 → 機車電梯'], lift.x, METRO_FLOOR + 5.65, lift.z - side * (LIFT_HALF + .06), 4.3, .7, Math.PI / 2, group, 'door-display');
    }
    const hall = metroConcourse(index), lower = this.system.lifts[index * 2].lower;
    this.buildAtrium(index,lower,group);
    // The short driveway follows the surveyed cut/fill surface and meets asphalt.
    const approach = metroStreetApproach(index), end = hall.x - hall.halfWidth;
    for (let x = approach.x - approach.halfWidth; x < end; x += 2) {
      const width = Math.min(2, end - x), centreX = x + width / 2, height = this.ground({ x: centreX, z: approach.z }) + .06;
      const tile = this.slab({ x: centreX, z: approach.z, halfWidth: width / 2, halfDepth: approach.halfDepth }, height, group);
      tile.updateWorldMatrix(true, true);
      tile.traverse(object => {
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        const geometry = mesh.geometry.clone(), p = geometry.attributes.position, world = new THREE.Vector3(), inverse = mesh.matrixWorld.clone().invert();
        for (let i = 0; i < p.count; i++) {
          world.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
          world.y += this.ground({ x: world.x, z: world.z }) + .06 - height;
          world.applyMatrix4(inverse); p.setXYZ(i, world.x, world.y, world.z);
        }
        geometry.computeVertexNormals(); mesh.geometry = geometry; this.geometries.add(geometry);
      });
    }
    // Complete imported clear-span roof and remote imported posts make the
    // street portal a designed entrance; no support sits in the riding lane.
    const entrance=this.placed('atrium-roof-clear-bay',station.x+11.7,lower,-794,group,Math.PI/2);
    entrance.scale.set(10.8/44,.205,16/9);
    for(const side of [-1,1])for(const dx of [5.1,18.3]) {
      const point={x:station.x+dx,z:-794+side*4.8},base=this.ground(point)+.06;
      group.add(this.assets.sized('pier',.48,lower+6.55-base,.48,point.x,lower+6.55,point.z));
      this.system.addFixture({...point,halfWidth:.24,halfDepth:.24},base,lower+6.55);
    }
    for(const side of [-1,1])this.frameBeam(station.x+11.7,-794+side*4.8,14,lower+6.60,.27,.34,0,group,'entrance eaves');
    for(const dx of [5.1,18.3])this.frameBeam(station.x+dx,-794,9.9,lower+6.60,.27,.34,Math.PI/2,group,'entrance crosshead');
    visual.hall = this.portalBoard([`${station.id} ${station.name}　${station.english.toUpperCase()}`, 'A / B 月台　海灣高架線', '道路入口 → 機車電梯 T → 月台'],station.x+27,lower,-794,7.5,group);
    this.portalBoard(['A 月台 ↑　南側電梯', 'B 月台 →　右側聯絡道', '服務中心／道路出口 ←'],station.x+36,lower,-802,5.2,group);
    this.stations.push(visual);
  }

  private portalBoard(lines:string[],x:number,floor:number,z:number,width:number,parent:THREE.Group) {
    const result=this.board(lines,x,floor+5.5,z,width,.85,0,parent);
    for(const side of [-1,1]) {
      const post=this.assets.sized('pier',.65,6.5,.65,x,floor+6.5,z+side*(width/2+.5));parent.add(post);
      this.system.addFixture({x,z:z+side*(width/2+.5),halfWidth:.325,halfDepth:.325},floor,floor+6.5);
    }
    parent.add(this.assets.sized('guideway',width+1.7,.24,.34,x,floor+6.54,z,Math.PI/2));
    return result;
  }

  private buildAtrium(index:number,floor:number,parent:THREE.Group) {
    const hall=metroConcourse(index),group=this.group('Complete glazed civic atrium / both motorcycle lifts',false,parent);
    const wells=this.system.lifts.filter(lift=>lift.station===index).map(lift=>({left:lift.x-LIFT_HALF,right:lift.x+LIFT_HALF,back:lift.z-LIFT_HALF,front:lift.z+LIFT_HALF}));
    // The carrier owns the only floor inside each well, including at its lower
    // stop. Fit complete downloaded paving panels around the opening instead of
    // putting another coplanar floor underneath the moving cabin.
    for(let row=0;row<12;row++) for(let col=0;col<6;col++) {
      const left=hall.x-hall.halfWidth+col*hall.halfWidth/3,back=hall.z-hall.halfDepth+row*hall.halfDepth/6;
      let tiles=[{left,right:left+hall.halfWidth/3,back,front:back+hall.halfDepth/6}];
      for(const well of wells) tiles=tiles.flatMap(tile=>{
        const l=Math.max(tile.left,well.left),r=Math.min(tile.right,well.right),b=Math.max(tile.back,well.back),f=Math.min(tile.front,well.front);
        if(l>=r||b>=f)return [tile];
        return [{...tile,right:l},{...tile,left:r},{left:l,right:r,back:tile.back,front:b},{left:l,right:r,back:f,front:tile.front}].filter(part=>part.right-part.left>.0001&&part.front-part.back>.0001);
      });
      for(const tile of tiles)this.slab({x:(tile.left+tile.right)/2,z:(tile.back+tile.front)/2,halfWidth:(tile.right-tile.left)/2,halfDepth:(tile.front-tile.back)/2},floor,group);
    }
    const eave=floor+31.8,columns:{x:number;z:number;base:number;top:number}[]=[];
    // Continuous perimeter transfer girders bridge the train passage. Their
    // supporting columns live at the facade, outside all roads and lift aisles.
    for(const side of [-1,1]) {
      this.frameBeam(hall.x+side*21.85,hall.z,108.8,eave+.07,1.70,.75,Math.PI/2,group,'continuous perimeter transfer');
      this.frameBeam(hall.x,hall.z+side*53.85,44.8,eave+.07,.70,.65,0,group,'end eaves');
      for(let bay=0;bay<=12;bay++) {
        const z=hall.z-53.85+bay*107.7/12;
        if(z>-865&&z<-820)continue;
        if(side===-1&&Math.abs(z+794)<5.3)continue;
        const x=hall.x+side*21.85,top=eave-.95;
        const post=this.assets.sized('pier',.78,top-floor,.78,x,top,z);
        post.name='Downloaded atrium perimeter support / footing to transfer girder';group.add(post);
        this.system.addFixture({x,z,halfWidth:.39,halfDepth:.39},floor,top);
        columns.push({x,z,base:floor,top});
      }
    }
    for(let bay=0;bay<12;bay++) {
      const z=hall.z-hall.halfDepth+(bay+.5)*hall.halfDepth/6;
      this.frameBeam(hall.x,z,44.5,eave+.055,.44,.40,0,group,'roof cross-member');
      // Original recessed LED fixtures are attached to the actual cross-frame.
      const lighting=this.placed('atrium-roof-clear-bay',hall.x,floor,z,group);
      const panels:THREE.Object3D[]=[];
      lighting.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh&&!Array.isArray(mesh.material)&&['Roof','RoofInside'].includes(mesh.material.name))panels.push(mesh);});
      panels.forEach(panel=>panel.removeFromParent());lighting.scale.x=1.035;lighting.scale.z=(hall.halfDepth/6)/9;
    }
    const main=this.placed('atrium-main-roof',hall.x,eave,hall.z,group);
    const lanternTop=floor+36.65;
    const lantern=this.placed('atrium-lantern-roof',hall.x,lanternTop,hall.z,group);
    for(const side of [-1,1]) {
      this.frameBeam(hall.x+side*8.1,hall.z,27.3,lanternTop+.025,.40,.30,Math.PI/2,group,'lantern eaves');
      this.frameBeam(hall.x,hall.z+side*13.5,16.5,lanternTop+.025,.40,.30,0,group,'lantern end eaves');
      for(const z of [hall.z-13.5,hall.z+13.5]) {
        const x=hall.x+side*8.1,post=this.assets.sized('pier',.30,lanternTop-.25-(eave-.10),.30,x,lanternTop-.25,z);
        post.name='Downloaded lantern support / lower roof frame to upper eaves';group.add(post);
      }
    }
    // The raised source roof previously floated six metres above its base.
    // Fit a complete glazed enclosure and a real daylight opening beneath it.
    main.updateWorldMatrix(true,true);
    const roofRay=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,8);
    const roofHeight=(x:number,z:number)=>{
      if(Math.abs(x-hall.x)<8.025&&Math.abs(z-hall.z)<13.425) {
        // Inner glazing/rebate vertices overhang the daylight aperture by a
        // few centimetres. Measure the adjacent original pitched rim there.
        if(Math.abs(z-hall.z)>13)z=hall.z+Math.sign(z-hall.z)*13.425;
        else x=hall.x+Math.sign(x-hall.x)*8.025;
      }
      roofRay.ray.origin.set(x,eave+5,z);
      const hit=roofRay.intersectObject(main,true)[0];
      if(!hit)throw new Error('Lantern envelope does not meet the downloaded lower roof');
      return hit.point.y;
    };
    const pitchedPair=(z:number,inner:number,outer:number,surface:(x:number,z:number)=>number,section:number,role:string)=>{
      for(const side of [-1,1]) {
        const ax=hall.x+Math.min(side*inner,side*outer),bx=hall.x+Math.max(side*inner,side*outer);
        const ay=surface(ax,z)-.025,by=surface(bx,z)-.025;
        const beam=this.frameBeam((ax+bx)/2,z,Math.hypot(bx-ax,by-ay),(ay+by)/2,section,.36,0,group,role);
        // Rotation is about the native girder's upper edge. Both ends meet the
        // measured original pitch, with the lower chord landing on the eaves.
        beam.rotation.z=Math.atan2(by-ay,bx-ax);
      }
    };
    for(let bay=0;bay<12;bay++) {
      const z=hall.z-hall.halfDepth+(bay+.5)*hall.halfDepth/6;
      pitchedPair(z,Math.abs(z-hall.z)<13.41?8.10:0,21.85,roofHeight,.40,'fitted main-roof rafters');
    }
    lantern.updateWorldMatrix(true,true);
    const upperHeight=(x:number,z:number)=>{
      roofRay.ray.origin.set(x,floor+43,z);roofRay.far=12;
      const hit=roofRay.intersectObject(lantern,true)[0];
      if(!hit)throw new Error('Lantern rafter misses the original pitched canopy');
      return hit.point.y;
    };
    for(const z of [hall.z-12,hall.z-6,hall.z,hall.z+6,hall.z+12])pitchedPair(z,0,8.1,upperHeight,.68,'fitted lantern-roof rafters');
    const glazedBay=(x:number,z:number,span:number,angle:number)=>{
      const base=roofHeight(x,z)-.018;
      const window=this.assets.sized('atrium-window',.214,lanternTop-base,span,x,lanternTop,z,angle);
      group.add(window);window.updateWorldMatrix(true,true);
      // Whole original frames follow the pitched roof at their lower edge.
      window.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        const g=mesh.geometry.clone(),p=g.attributes.position,inverse=mesh.matrixWorld.clone().invert(),v=new THREE.Vector3();
        for(let i=0;i<p.count;i++) {
          v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
          const contact=roofHeight(v.x,Math.abs(v.z-hall.z)>13.4?z:v.z);
          v.y+=(contact-.018-base)*(lanternTop-v.y)/(lanternTop-base);
          v.applyMatrix4(inverse);p.setXYZ(i,v.x,v.y,v.z);
        }
        g.computeVertexNormals();mesh.geometry=g;this.geometries.add(g);
      });
    };
    for(const side of [-1,1]) {
      for(let bay=0;bay<8;bay++)glazedBay(hall.x+side*8.1,hall.z-13.5+(bay+.5)*27/8,27/8,side>0?Math.PI:0);
      for(let bay=0;bay<6;bay++)glazedBay(hall.x-8.1+(bay+.5)*16.2/6,hall.z+side*13.5,16.2/6,Math.PI/2);
    }
    group.userData.architecturalRoof={source:'TrainStationBuilding3',coherentEnvelope:true,eaveHeight:31.8,lanternHeight:36.65,daylightOpening:[16.02,26.82],perimeterSupports:columns};
    const windowHeight=this.assets.getBounds('atrium-window').max.y;
    const poses:{x:number;y:number;z:number;angle:number}[]=[];
    const platformEdges=METRO_TRACKS.flatMap((_,track)=>{
      const platform=metroPlatform(index,track);
      return [platform.z-platform.halfDepth,platform.z+platform.halfDepth];
    });
    const passageBack=Math.min(...platformEdges)-.9,passageFront=Math.max(...platformEdges)+.9;
    // Omit whole imported window bays across both platforms and the guideway.
    const throughRail=(z:number,y:number)=>z+1.6>passageBack&&z-1.6<passageFront&&y<METRO_FLOOR+7&&y+windowHeight>METRO_FLOOR-3.4;
    for(let row=0;row<6;row++) {
      const y=floor+row*windowHeight;
      for(const side of [-1,1]) for(let bay=0;bay<34;bay++) {
        const x=hall.x+side*hall.halfWidth,z=hall.z-hall.halfDepth+(bay+.5)*3.2;
        if(side===-1&&Math.abs(z+794)<4.9&&row<2)continue;
        if(throughRail(z,y))continue;
        poses.push({x,y,z,angle:side>0?Math.PI:0});
        if(row===0)this.system.addFixture({x,z,halfWidth:.12,halfDepth:1.6},floor,floor+windowHeight);
      }
      for(const side of [-1,1])for(let bay=0;bay<14;bay++) {
        const x=hall.x-hall.halfWidth+(bay+.5)*3.2,z=hall.z+side*hall.halfDepth;
        poses.push({x,y,z,angle:Math.PI/2});
        if(row===0)this.system.addFixture({x,z,halfWidth:1.6,halfDepth:.12},floor,floor+windowHeight);
      }
    }
    const windows=this.assets.instances('atrium-window',poses.length);windows.root.userData.dynamicWorldObject=false;
    poses.forEach((p,i)=>windows.set(i,p.x,p.y,p.z,p.angle));windows.commit();group.add(windows.root);
    // A fitted upper transom closes the gap beneath the imported roof eaves.
    // It uses the same complete framed window; only its vertical scale changes.
    const clerestory=this.assets.instances('atrium-window',96);clerestory.root.userData.dynamicWorldObject=false;
    clerestory.root.position.y=floor+windowHeight*6;
    clerestory.root.scale.y=(31.8-windowHeight*6)/windowHeight;
    let topIndex=0;
    for(const side of [-1,1])for(let bay=0;bay<34;bay++)clerestory.set(topIndex++,hall.x+side*hall.halfWidth,0,hall.z-hall.halfDepth+(bay+.5)*3.2,side>0?Math.PI:0);
    for(const side of [-1,1])for(let bay=0;bay<14;bay++)clerestory.set(topIndex++,hall.x-hall.halfWidth+(bay+.5)*3.2,0,hall.z+side*hall.halfDepth,Math.PI/2);
    clerestory.commit();group.add(clerestory.root);
    for(const z of [hall.z+40,hall.z+44])this.fixture(this.placed('bench',hall.x+12,floor+.006,z,group,Math.PI/2));
    group.userData.atrium={floor,clearHeight:31.4,enclosesLifts:this.system.lifts.filter(l=>l.station===index).map(l=>l.id),footprint:hall};
  }

  updateInteriorLighting(rider:Coordinates,height:number) {
    if(!this.built)return;
    let closestX=0,closestZ=0,best=Infinity;
    for(const visual of this.trains)for(const car of visual.cars){
      const x=visual.group.position.x+car.root.position.x,z=visual.group.position.z;
      const distance=Math.max(0,Math.abs(x-rider.x)-13)**2+(z-rider.z)**2;
      if(distance<best){best=distance;closestX=x;closestZ=z;}
    }
    const weight=Math.max(0,1-Math.sqrt(best)/65)*Math.max(0,1-Math.abs(height-METRO_FLOOR)/10);
    for(let i=0;i<this.cabinLights.length;i++) {
      const light=this.cabinLights[i];light.intensity=weight*8;
      // Lights must be below the ceiling's downward-facing interior surfaces.
      light.position.set(closestX+(i-1)*8,METRO_FLOOR+3.3,closestZ);
    }
  }

  private buildTrain(id: number) {
    const train = this.system.trains[id], group = this.group(`M${id + 1} downloaded JFR1 train`, true), cars: ReturnType<typeof createDownloadedMetroCar>[] = [];
    METRO_CAR_OFFSETS.forEach((offset, car) => {
      const model = createDownloadedMetroCar(this.assets, car === 0 ? -1 : 1, METRO_TRACKS[train.track].side, `train-${id}`);
      model.root.position.x = offset; group.add(model.root); cars.push(model);
    });
    const gangway=this.placed('gangway-shell',0,0,0,group,Math.PI/2);
    gangway.name='Downloaded flexible inter-car gangway / open rear vestibules';
    for(const end of [-1,1])this.placed('gangway-collar',end*1.99,0,0,group,Math.PI/2);
    group.add(this.assets.sized('boarding-threshold',4.12,.025,3.42,0,.015,0));
    group.userData.gangway={clearWidth:3.44,length:4.10,throughPassage:true};
    const bridgePlates = this.group('Imported retractable boarding plates', false, group), side = METRO_TRACKS[train.track].side;
    for (const opening of METRO_DOORS) bridgePlates.add(this.assets.sized('boarding-threshold',METRO_DOOR_WIDTH,.025,METRO_PLATFORM_GAP+.35,opening.x,.006,side*(METRO_HALF_WIDTH+METRO_PLATFORM_GAP/2)));
    this.trains.push({ group, cars, bridgePlates, signature: '' });
  }

  private buildLift(id: number) {
    const lift = this.system.lifts[id], shaft = this.group(`Downloaded ${METRO_STATIONS[lift.station].id} ${lift.track === 0 ? 'A' : 'B'} lift shaft`), moving = this.group(`Downloaded moving motorcycle lift ${id}`, true);
    this.placed(`lift-shaft-${lift.station}-${lift.track}`, lift.x, lift.lower, lift.z, shaft);
    moving.position.set(lift.x, lift.height, lift.z);
    const doors: LiftLeaf[] = [], landings: LiftLeaf[] = [];
    for (const side of [-1, 1]) for (const sign of [-1, 1]) {
      doors.push({ instance: id * 8 + doors.length, side, sign, baseX: sign * 1.35 });
    }
    for (const level of [lift.lower, METRO_FLOOR]) {
      const side = level === METRO_FLOOR && lift.track === 0 ? -1 : 1;
      for (const sign of [-1, 1]) {
        landings.push({ instance: id * 8 + 4 + landings.length, side, sign, level, baseX: lift.x + sign * 1.35 });
      }
    }
    const indicator = this.board(['機車升降梯　T', '停妥後搭乘／召喚電梯', '車門淨空　請完整進入'], lift.x, lift.lower + 5.62, lift.z + LIFT_HALF + .06, 4.2, .70, Math.PI / 2, shaft, 'door-display');
    this.lifts.push({ group: moving, doors, landings, indicator, signature: '' });
  }

  private registerHallWalls(building: THREE.Group) {
    building.updateWorldMatrix(true, true);
    const seen = new Set<string>();
    building.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal;
      const count = g.index?.count ?? p.count, v = new THREE.Vector3(), normal = new THREE.Vector3();
      for (let i = 0; i < count; i += 3) {
        const b = new THREE.Box3();
        const first = g.index ? g.index.getX(i) : i;
        normal.fromBufferAttribute(n, first).transformDirection(mesh.matrixWorld);
        if (Math.abs(normal.y) > .2) continue;
        for (let j = 0; j < 3; j++) { const at = g.index ? g.index.getX(i+j) : i+j; b.expandByPoint(v.fromBufferAttribute(p, at).applyMatrix4(mesh.matrixWorld)); }
        const size = b.getSize(new THREE.Vector3()), centre = b.getCenter(new THREE.Vector3());
        if (size.y < .15 || b.max.y < building.position.y+.2 || b.min.y > building.position.y+3.2) continue;
        const key = [...b.min.toArray(), ...b.max.toArray()].map(x=>x.toFixed(3)).join(':'); if (seen.has(key)) continue; seen.add(key);
        this.system.addFixture({ x:centre.x,z:centre.z,halfWidth:Math.max(.04,size.x/2),halfDepth:Math.max(.04,size.z/2) }, b.min.y,b.max.y);
      }
    });
  }

  private auditSources() {
    let meshes = 0, triangles = 0; const sources = new Map<string, MetroSource>();
    this.root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      const source = mesh.userData.downloadedSource as MetroSource;
      if (!source?.sha256 || (!source.repository && !source.page)) throw new Error('Metro contains visible geometry without a downloaded source: ' + mesh.name);
      meshes++; triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1); sources.set(source.sha256, source);
    });
    this.root.userData.downloadedGeometryAudit = { meshes, triangles, sources: [...sources.values()], generatedVisiblePrimitives: 0 };
  }

  private batchArchitecture() {
    this.root.updateWorldMatrix(true, true);
    const families = new Map<THREE.Material, { meshes: THREE.Mesh[]; sources: Map<string, MetroSource> }>();
    const visit = (object: THREE.Object3D) => {
      if (object.userData.dynamicWorldObject || !object.visible) return;
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && !mesh.material.transparent) {
        const family: { meshes: THREE.Mesh[]; sources: Map<string, MetroSource> } = families.get(mesh.material) ?? { meshes: [], sources: new Map() };
        family.meshes.push(mesh); family.sources.set(mesh.userData.downloadedSource.sha256, mesh.userData.downloadedSource); families.set(mesh.material, family);
      }
      for (const child of object.children) visit(child);
    };
    visit(this.root);
    for (const [material, family] of families) {
      if (family.meshes.length < 4) continue;
      const pieces = family.meshes.map(mesh => {
        const geometry = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const a = mesh.geometry.getAttribute(name); if (!a) continue;
          const values = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) values[i * a.itemSize + c] = a.getComponent(i, c);
          geometry.setAttribute(name, new THREE.BufferAttribute(values, a.itemSize));
        }
        if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
        return (geometry.index ? geometry.toNonIndexed() : geometry).applyMatrix4(mesh.matrixWorld);
      });
      const geometry = mergeGeometries(pieces, false); pieces.forEach(piece => piece.dispose());
      if (!geometry) throw new Error('Incompatible downloaded station geometry attributes');
      const source = new THREE.Mesh(geometry, material); source.castShadow = true; source.receiveShadow = true; source.name = `Downloaded metro architecture / ${material.name}`;
      source.userData.downloadedSources = [...family.sources.values()]; this.geometries.add(geometry);
      const batch = batchCityMesh(source, 144);
      if (batch) { batch.userData.downloadedSources = source.userData.downloadedSources; this.batches.push(batch); this.root.add(batch); }
      else this.root.add(source);
      family.meshes.forEach(mesh => mesh.removeFromParent());
    }
  }

  render(alpha: number, observer?:Coordinates) {
    if (!this.built || this.disposed) return;
    for (const train of this.system.trains) {
      const visual = this.trains[train.id], x = THREE.MathUtils.lerp(train.previousX, train.x, alpha), door = THREE.MathUtils.lerp(train.previousDoor, train.door, alpha);
      visual.group.position.set(x, METRO_FLOOR, train.z);
      visual.bridgePlates.visible = train.phase !== 'running' && door > .98;
      visual.cars.forEach(car => {car.animate(door);car.driver.visible=car.orientation===train.direction;});
      const duration=train.phase==='running'?metroRunSeconds(train.station,train.nextStation):train.phase==='dwell'?METRO_DWELL:METRO_DOOR_SECONDS;
      const seconds=Math.max(0,Math.ceil(duration-train.elapsed));
      // Retain full-resolution lettering. Animate nearby physical screens at
      // 12 Hz; distant, unreadable screens only need current service data.
      const near=!observer||Math.abs(observer.x-x)<80&&Math.abs(observer.z-train.z)<25;
      const animation=near?Math.floor(this.system.seconds*12)/12:Math.floor(this.system.seconds);
      const progress=train.phase==='running'?THREE.MathUtils.clamp((x-METRO_STATIONS[train.station].x)/(METRO_STATIONS[train.nextStation].x-METRO_STATIONS[train.station].x),0,1):0;
      const signature = `${train.nextStation}:${train.station}:${train.phase}:${seconds}:${this.system.capacity(train.id)}:${animation}`;
      if (signature !== visual.signature) {
        this.assets.paintTrain(visual.cars[0].boards[0],{names:METRO_STATIONS.map(s=>s.name),english:METRO_STATIONS.map(s=>s.english),current:train.station,next:train.nextStation,phase:train.phase,seconds,capacity:this.system.capacity(train.id),total:METRO_BIKE_CAPACITY,progress,animation});
        visual.signature = signature;
      }
    }
    for (const lift of this.system.lifts) {
      const visual = this.lifts[lift.id], h = THREE.MathUtils.lerp(lift.previousHeight, lift.height, alpha), door = THREE.MathUtils.lerp(lift.previousDoor, lift.door, alpha);
      visual.group.position.y = h;
      this.liftCabins.set(lift.id, lift.x, h, lift.z); this.liftFloors.set(lift.id, lift.x, h, lift.z);
      const face = Math.abs(lift.height - METRO_FLOOR) < .08 && lift.track === 0 ? -1 : 1;
      for (const leaf of visual.doors) this.liftDoorInstances.set(leaf.instance, lift.x + leaf.baseX + (leaf.side === face ? leaf.sign * 2.71 * door : 0), h, lift.z + leaf.side * LIFT_HALF);
      for (const leaf of visual.landings) this.liftDoorInstances.set(leaf.instance, leaf.baseX + (Math.abs(lift.height - leaf.level!) < .08 ? leaf.sign * 2.71 * door : 0), leaf.level!, lift.z + leaf.side * (LIFT_HALF + .1));
      const signature = `${lift.phase}:${lift.target}:${lift.blocked}`;
      if (signature !== visual.signature) {
        this.assets.paint(visual.indicator, ['機車升降梯　T', lift.blocked ? '門口受阻　請完整進入' : lift.phase === 'idle' ? '停妥後按 T　可召喚本層' : lift.target === METRO_FLOOR ? '↑ 前往月台　請等待開門' : '↓ 前往街道　請等待開門', '車門自動連鎖　勿停留門口']);
        visual.signature = signature;
      }
    }
    METRO_STATIONS.forEach((station, stationIndex) => {
      const visual = this.stations[stationIndex];
      this.assets.paint(visual.hall!, [`${station.id} ${station.name}　${station.english.toUpperCase()}`, `← A月台 往${this.system.platformDestination(this.system.trains[0], stationIndex)}　↑ B月台 往${this.system.platformDestination(this.system.trains[1], stationIndex)}`, '道路入口 → 機車電梯 T → 月台']);
      for (const leaf of visual.doors) {
        const train = this.system.trains[leaf.track], door = train.station === stationIndex && train.phase !== 'running' ? THREE.MathUtils.lerp(train.previousDoor, train.door, alpha) : 0;
        this.platformDoorInstances.set(leaf.instance, leaf.x + leaf.sign * (METRO_DOOR_WIDTH / 2 + .035) * door, METRO_FLOOR, leaf.z);
      }
      for (const {board,track} of visual.boards) {
        const train = this.system.trains[track], signal = this.system.boardingSignal(stationIndex, track), seconds = Math.ceil(this.system.arrivalSeconds(train, stationIndex));
        const following = Math.ceil(this.system.followingArrivalSeconds(train, stationIndex)), format = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
        this.assets.paint(board, [`${station.id} ${station.name}　${track === 0 ? 'A' : 'B'} 月台`, `往 ${this.system.platformDestination(train, stationIndex)}　BLUE LINE`, train.blocked ? '門口受阻　請保持淨空' : signal === 'green' ? '● 綠燈 開始上車' : signal === 'amber' ? '● 準備　車門動作中' : `● 等待　下一班 ${format(seconds)}`, `速限 25　下下班 ${format(following)}　機車位 ${this.system.capacity(train.id)}/${METRO_BIKE_CAPACITY}`], signal === 'green' ? '#58d4ae' : signal === 'amber' ? '#e5b45f' : '#4ab9df');
      }
    });
    this.instanceGroups().forEach(instances => instances.commit());
  }

  constrainCamera(camera: THREE.Vector3, rider: VehicleState, height: number, alpha: number) {
    const carrier = this.system.carrier;
    if (carrier?.kind === 'train') {
      const train = this.system.trains[carrier.id];
      const centre = THREE.MathUtils.lerp(train.previousX, train.x, alpha);
      const half = Math.abs(METRO_CAR_OFFSETS[1]+METRO_CAR_INTERIOR_CENTER)+METRO_CAR_INTERIOR_HALF-.35;
      camera.x = THREE.MathUtils.clamp(camera.x, centre - half, centre + half);
      const initialHalfWidth=Math.abs(camera.x-centre)<2.3?1.72:METRO_HALF_WIDTH;
      camera.z=THREE.MathUtils.clamp(camera.z,train.z-initialHalfWidth+.32,train.z+initialHalfWidth-.32);
      if (Math.hypot(camera.x - rider.x, camera.z - rider.z) < 3.4) camera.x = THREE.MathUtils.clamp(rider.x + (rider.x > centre ? -3.9 : 3.9), centre - half, centre + half);
      const inGangway=Math.abs(camera.x-centre)<2.3;
      const cameraHalfWidth=inGangway?1.72:METRO_HALF_WIDTH;
      camera.z = THREE.MathUtils.clamp(camera.z, train.z - cameraHalfWidth + .32, train.z + cameraHalfWidth - .32);
      camera.y = THREE.MathUtils.clamp(camera.y, METRO_FLOOR + 3.15, METRO_FLOOR + (inGangway?3.60:Math.min(METRO_INTERIOR_HEIGHT - .12, 3.95)));
    } else if (carrier?.kind === 'lift') {
      const lift = this.system.lifts[carrier.id];
      camera.x = THREE.MathUtils.clamp(camera.x, lift.x - 2.9, lift.x + 2.9); camera.z = THREE.MathUtils.clamp(camera.z, lift.z - 2.9, lift.z + 2.9); camera.y = height + 4.3;
    }
  }

  dispose() {
    this.disposed = true; this.root.removeFromParent();
    this.root.traverse(object => { if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose(); });
    this.batches.forEach(disposeCityBatch); this.geometries.forEach(geometry => geometry.dispose()); this.assets.dispose();
  }
}
