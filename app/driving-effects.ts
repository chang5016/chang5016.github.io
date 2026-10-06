import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "three/addons/utils/SkeletonUtils.js";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute } from "three/tsl";
import type { VehicleState } from "./game-core";
import { ENGINE_LAYERS, stepEngineSound } from "./scooter-engine-sound";

export function stepTurboCharge(charge: number, requested: boolean, speed: number, seconds: number) {
  const dt = Math.max(0, Math.min(seconds, 0.08));
  const engaged = requested && charge > 0.4 && Math.abs(speed) > 2.1;
  return {
    charge: Math.max(0, Math.min(100, charge + (engaged ? -31 : 8.5) * dt)),
    engaged,
  };
}

export class ScooterAudio {
  private running = true;
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private panner: PannerNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private voices: Array<{ source: AudioBufferSourceNode; gain: GainNode }> = [];
  private attackBuffers: AudioBuffer[] = [];
  private attacks = new Set<{source:AudioBufferSourceNode;gain:GainNode}>();
  private activeAttack: {source:AudioBufferSourceNode;gain:GainNode}|null=null;
  private throttleArmed=true;
  private lastAttack=-10;
  private attackIndex=0;
  private trafficMotor: AudioBufferSourceNode | null = null;
  private trafficGain: GainNode | null = null;
  private trafficPanner: PannerNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private tyreGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private loading: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private engine = { rpm: 1700, load: 0 };
  private lastUpdate = 0;
  private readonly forward = new THREE.Vector3();

  start() {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      if (!this.context) {
        const context = new Context();
        this.context = context;
        this.lastUpdate = context.currentTime;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -17;
        this.compressor.knee.value = 16;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = .006;
        this.compressor.release.value = .2;
        this.compressor.connect(context.destination);
        this.output = context.createGain();
        this.output.gain.value = .65;
        this.panner = context.createPanner();
        this.panner.panningModel = "HRTF";
        this.panner.distanceModel = 'inverse';
        this.panner.refDistance = 3.5;
        this.panner.maxDistance = 38;
        this.panner.rolloffFactor = .34;
        this.output.connect(this.panner);
        this.panner.connect(this.compressor);
        this.engineFilter = context.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 1400;
        this.engineFilter.Q.value = .45;
        this.engineFilter.connect(this.output);
        // Quiet brown rolling noise; no continuous exhaust hiss or turbo whistle.
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = buffer.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < data.length; i++) { brown = (brown + (Math.random()*2-1)*.025)/1.025; data[i] = brown*3.5; }
        this.noise = context.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
        const tyreFilter = context.createBiquadFilter(); tyreFilter.type = 'bandpass'; tyreFilter.frequency.value = 680; tyreFilter.Q.value = .55;
        const windFilter = context.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = .35;
        this.tyreGain = context.createGain(); this.windGain = context.createGain();
        this.tyreGain.gain.value = this.windGain.gain.value = 0;
        this.noise.connect(tyreFilter); tyreFilter.connect(this.tyreGain); this.tyreGain.connect(this.output);
        this.noise.connect(windFilter); windFilter.connect(this.windGain); this.windGain.connect(this.output);
        this.noise.start();
        this.trafficGain = context.createGain(); this.trafficGain.gain.value = 0;
        this.trafficPanner = context.createPanner(); this.trafficPanner.panningModel = "HRTF";
        this.trafficPanner.distanceModel = 'inverse'; this.trafficPanner.refDistance = 2.2;
        this.trafficPanner.maxDistance = 55; this.trafficPanner.rolloffFactor = .78;
        const trafficFilter = context.createBiquadFilter(); trafficFilter.type = 'lowpass'; trafficFilter.frequency.value = 1000;
        this.trafficGain.connect(trafficFilter); trafficFilter.connect(this.trafficPanner); this.trafficPanner.connect(this.compressor);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      if (!this.loading && !this.voices.length) {
        const context = this.context;
        const abort = new AbortController(); this.abort = abort;
        const task = this.loadRecordings(context, abort.signal);
        this.loading = task;
        void task.finally(() => { if (this.loading === task) this.loading = null; });
      }
    } catch {
      this.dispose(); // No synthetic fallback drone when browser audio is unavailable.
    }
  }

  private async loadRecordings(context: AudioContext, signal: AbortSignal) {
    const attacks=Promise.all([0,1,2].map(async index=>{
      const response=await fetch(`/audio/scooter-attack-${index}.wav?v=attack-v1`,{signal});
      if(!response.ok)throw new Error('Throttle recording unavailable');
      return context.decodeAudioData(await response.arrayBuffer());
    })).then(buffers=>{if(!signal.aborted&&this.context===context&&context.state!=='closed')this.attackBuffers=buffers;}).catch(()=>{});
    try {
      const buffers = await Promise.all(ENGINE_LAYERS.map(async ({ name }) => {
        const response = await fetch(`/audio/scooter-${name}.wav?v=sustain-v2`, { signal });
        if (!response.ok) throw new Error('Scooter recording unavailable');
        return context.decodeAudioData(await response.arrayBuffer());
      }));
      if (signal.aborted || this.context !== context || context.state === 'closed') return;
      const loop = (buffer: AudioBuffer, gain: GainNode, rate: number) => {
        const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
        source.playbackRate.value = rate; source.connect(gain); source.start(context.currentTime, buffer.duration * .137); return source;
      };
      const initial = stepEngineSound(this.engine, 0, 0, false, 0, this.running);
      this.voices = buffers.map((buffer, index) => {
        const gain = context.createGain(); gain.gain.value = 0; gain.connect(this.engineFilter!);
        const source = loop(buffer, gain, initial.layers[index].rate);
        gain.gain.setTargetAtTime(initial.layers[index].gain, context.currentTime, .2);
        return { source, gain };
      });
      this.trafficMotor = loop(buffers[1], this.trafficGain!, .82);
    } catch {
      // A subsequent user gesture retries a failed fetch; driving stays available.
    }
    await attacks;
  }

  private releaseAttack(now:number){
    if(!this.activeAttack)return;
    this.activeAttack.gain.gain.setTargetAtTime(0,now,.035);this.activeAttack.source.stop(now+.16);this.activeAttack=null;
  }

  private updateThrottleAttack(throttle:number,rpm:number,now:number){
    const demand=Math.abs(throttle);
    if(demand<.14){this.throttleArmed=true;this.releaseAttack(now);}
    if(demand<.34||!this.throttleArmed||now-this.lastAttack<.45||!this.attackBuffers.length||!this.context||!this.engineFilter)return;
    this.throttleArmed=false;this.lastAttack=now;this.releaseAttack(now);
    const source=this.context.createBufferSource(),gain=this.context.createGain();
    // A true throttle opening plays once. Sustained acceleration never repeats it.
    source.buffer=this.attackBuffers[this.attackIndex++%this.attackBuffers.length];
    source.playbackRate.value=THREE.MathUtils.clamp(.88+(rpm-1700)/16000,.88,1.16);gain.gain.value=.30;
    source.connect(gain);gain.connect(this.engineFilter);
    const voice={source,gain};this.attacks.add(voice);this.activeAttack=voice;
    source.onended=()=>{source.disconnect();gain.disconnect();this.attacks.delete(voice);if(this.activeAttack===voice)this.activeAttack=null;};source.start(now);
  }

  setIgnition(running: boolean) {
    this.running=running;
    if (!running && this.context) {
      const now=this.context.currentTime;
      for(const voice of this.voices) { voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0,now,.035); }
      this.releaseAttack(now); this.throttleArmed=true;
    }
  }

  update(speed: number, throttle: number, boosted: boolean, spatial?: { source: THREE.Vector3; listener: THREE.Camera; trafficSource?: THREE.Vector3 }, running = true) {
    this.setIgnition(running);
    if (!this.context || !this.output) return;
    const now = this.context.currentTime;
    const sound = stepEngineSound(this.engine, speed, throttle, boosted, now - this.lastUpdate, running);
    this.lastUpdate = now; this.engine.rpm = sound.rpm; this.engine.load = sound.load;
    this.updateThrottleAttack(running ? throttle : 0,sound.rpm,now);
    this.voices.forEach((voice, index) => {
      voice.source.playbackRate.setTargetAtTime(sound.layers[index].rate, now, .075);
      voice.gain.gain.setTargetAtTime(sound.layers[index].gain, now, .11);
    });
    this.engineFilter?.frequency.setTargetAtTime(sound.cutoff, now, .09);
    this.tyreGain?.gain.setTargetAtTime(sound.tyreGain, now, .13);
    this.windGain?.gain.setTargetAtTime(sound.windGain, now, .2);
    if (spatial && this.panner) {
      this.panner.positionX.setTargetAtTime(spatial.source.x, now, .025);
      this.panner.positionY.setTargetAtTime(spatial.source.y, now, .025);
      this.panner.positionZ.setTargetAtTime(spatial.source.z, now, .025);
      const listener = this.context.listener;
      spatial.listener.getWorldDirection(this.forward);
      listener.positionX?.setTargetAtTime(spatial.listener.position.x, now, .025);
      listener.positionY?.setTargetAtTime(spatial.listener.position.y, now, .025);
      listener.positionZ?.setTargetAtTime(spatial.listener.position.z, now, .025);
      listener.forwardX?.setTargetAtTime(this.forward.x, now, .025);
      listener.forwardY?.setTargetAtTime(this.forward.y, now, .025);
      listener.forwardZ?.setTargetAtTime(this.forward.z, now, .025);
      listener.upX?.setTargetAtTime(0, now, .025); listener.upY?.setTargetAtTime(1, now, .025); listener.upZ?.setTargetAtTime(0, now, .025);
      const source = spatial.trafficSource;
      const distance = source ? source.distanceTo(spatial.listener.position) : 999;
      this.trafficGain?.gain.setTargetAtTime(source ? Math.max(0, .12*(1-distance/42)) : 0, now, .09);
      if (source && this.trafficPanner) {
        this.trafficPanner.positionX.setTargetAtTime(source.x, now, .03);
        this.trafficPanner.positionY.setTargetAtTime(source.y, now, .03);
        this.trafficPanner.positionZ.setTargetAtTime(source.z, now, .03);
      }
    } else this.trafficGain?.gain.setTargetAtTime(0, now, .09);
  }

  landing(strength: number) {
    if (!this.context || !this.output || strength < .08) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 145; oscillator.type = 'triangle'; oscillator.frequency.value = 68;
    gain.gain.setValueAtTime(Math.max(.001, Math.min(.1, strength*.1)), this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, this.context.currentTime+.16);
    oscillator.connect(filter); filter.connect(gain); gain.connect(this.output);
    oscillator.start(); oscillator.stop(this.context.currentTime+.18);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  horn() {
    if (!this.context || !this.compressor) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = 390;
    gain.gain.setValueAtTime(.001, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.15, this.context.currentTime+.035);
    gain.gain.exponentialRampToValueAtTime(.001, this.context.currentTime+.26);
    oscillator.connect(gain); gain.connect(this.compressor); oscillator.start(); oscillator.stop(this.context.currentTime+.29);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  dispose() {
    this.abort?.abort(); this.abort = null; this.loading = null;
    for (const node of [...this.voices.map(voice => voice.source), this.trafficMotor, this.noise]) { try { node?.stop(); node?.disconnect(); } catch {} }
    this.voices.forEach(voice => voice.gain.disconnect()); this.voices = [];
    for(const voice of this.attacks){try{voice.source.stop();voice.source.disconnect();voice.gain.disconnect();}catch{}}
    this.attacks.clear();this.activeAttack=null;this.attackBuffers=[];this.throttleArmed=true;this.lastAttack=-10;this.attackIndex=0;
    this.trafficMotor = this.noise = null;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null; this.output = null; this.compressor = null;
    this.panner = this.trafficPanner = null; this.engineFilter = null;
    this.trafficGain = this.tyreGain = this.windGain = null;
    this.engine = { rpm: 1700, load: 0 };
  }
}

type ExhaustParticle = { age: number; life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };

export class ScooterExhaust {
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly particles: ExhaustParticle[] = [];
  private readonly puffs: THREE.InstancedMesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(72), 1).setUsage(THREE.DynamicDrawUsage);
  private readonly texture: THREE.CanvasTexture;
  private readonly transform = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private cursor = 0;
  private accumulator = 0;

  constructor(private readonly scene: THREE.Scene) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
      gradient.addColorStop(0, "rgba(255,255,255,.95)");
      gradient.addColorStop(.45, "rgba(237,239,240,.58)");
      gradient.addColorStop(1, "rgba(235,238,239,0)");
      context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    }
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.geometry.setAttribute('exhaustOpacity',this.opacity);
    this.material = new MeshBasicNodeMaterial({ map:this.texture, transparent:true, opacity:.22, depthWrite:false, side:THREE.DoubleSide, toneMapped:false });
    this.material.opacityNode = attribute('exhaustOpacity','float');
    // WebGPU point size is backend-dependent. World-sized billboards preserve
    // the exhaust plume at real dimensions on either renderer.
    this.puffs = new THREE.InstancedMesh(this.geometry, this.material, 72);
    this.puffs.name = "Animated scooter exhaust particles";
    this.puffs.userData.dynamicWorldObject = true;
    this.puffs.frustumCulled = false;
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i=0;i<72;i++) {
      this.particles.push({ age:2,life:1,x:0,y:-999,z:0,vx:0,vy:0,vz:0 });
      this.puffs.setMatrixAt(i,this.transform.makeScale(0,0,0));
      this.puffs.setColorAt(i,new THREE.Color(.8,.82,.82));
    }
    scene.add(this.puffs);
  }

  update(vehicle:VehicleState, terrainHeight:number, dt:number, boosted:boolean, camera?:THREE.Camera, outlet?:THREE.Vector3, running=true) {
    const throttle=Math.abs(vehicle.throttle);
    if(running)this.accumulator += dt*(boosted?18:5+throttle*9);
    else this.accumulator=0;
    while(this.accumulator>=1) {
      this.accumulator--; const p=this.particles[this.cursor], fx=Math.sin(vehicle.heading),fz=-Math.cos(vehicle.heading);
      p.age=0;p.life=.48+Math.random()*.18;
      p.x=vehicle.x-fx*1.45+Math.cos(vehicle.heading)*.32;p.y=terrainHeight+.43;p.z=vehicle.z-fz*1.45+Math.sin(vehicle.heading)*.32;
      if (outlet) { p.x=outlet.x; p.y=outlet.y; p.z=outlet.z; }
      p.vx=-fx*(boosted?2.2:.55+throttle*.55)+(Math.random()-.5)*.12;p.vy=.18+Math.random()*.14;p.vz=-fz*(boosted?2.2:.55+throttle*.55)+(Math.random()-.5)*.12;
      this.puffs.setColorAt(this.cursor,new THREE.Color(boosted?.78:.8,boosted?.92:.82,boosted?1:.82));
      this.cursor=(this.cursor+1)%this.particles.length;
    }
    if(camera)camera.getWorldQuaternion(this.facing);
    for(let i=0;i<this.particles.length;i++) {
      const p=this.particles[i];p.age+=dt;
      if(p.age>=p.life) {this.puffs.setMatrixAt(i,this.transform.makeScale(0,0,0));this.opacity.setX(i,0);continue;}
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vx*=Math.exp(-1.2*dt);p.vz*=Math.exp(-1.2*dt);
      const t=p.age/p.life,size=(boosted?.16:.11)*(1+1.2*t);
      this.opacity.setX(i,.22*Math.pow(1-t,1.8));
      this.transform.compose(this.position.set(p.x,p.y,p.z),this.facing,this.scale.set(size,size,size));this.puffs.setMatrixAt(i,this.transform);
    }
    this.puffs.instanceMatrix.needsUpdate=true;this.opacity.needsUpdate=true;if(this.puffs.instanceColor)this.puffs.instanceColor.needsUpdate=true;
  }
  dispose() {this.scene.remove(this.puffs);this.puffs.dispose();this.geometry.dispose();this.material.dispose();this.texture.dispose();}
}

const PASSENGER_ANIMALS = [
  { kind: "pug", url: "/models/traffic/pug.glb", height: 1.18 },
  { kind: "pig", url: "/models/traffic/pig.glb", height: 1.22 },
  { kind: "sheep", url: "/models/traffic/sheep.glb", height: 1.28 },
  { kind: "llama", url: "/models/traffic/llama.glb", height: 1.38 },
] as const;

type PassengerMode = "waiting" | "boarding" | "riding";
type LoadedPassengerAnimal = { scene: THREE.Group; animations: THREE.AnimationClip[] };
const passengerLoader = new GLTFLoader();
const passengerTemplates = new Map<string, Promise<LoadedPassengerAnimal>>();

function passengerTemplate(url: string) {
  let request = passengerTemplates.get(url);
  if (!request) {
    request = passengerLoader.loadAsync(url).then((asset) => ({ scene: asset.scene, animations: asset.animations }));
    passengerTemplates.set(url, request);
  }
  return request;
}

function seatingDelta(name: string) {
  const lower = name.toLowerCase();
  const euler = new THREE.Euler();
  if (lower.includes("frontupleg")) euler.set(-0.92, lower.endsWith("l") ? -0.09 : 0.09, 0);
  else if (lower.includes("frontlowleg")) euler.set(1.26, 0, 0);
  else if (lower.includes("backupleg")) euler.set(-1.08, lower.endsWith("l") ? 0.08 : -0.08, 0);
  else if (lower.includes("backlowleg")) euler.set(1.18, 0, 0);
  else if (lower === "torso" || lower === "body") euler.set(-0.16, 0, 0);
  else return null;
  return new THREE.Quaternion().setFromEuler(euler);
}

export function setPassengerAvatarMode(passenger: THREE.Group, mode: PassengerMode) {
  passenger.userData.mode = mode;
  const actions = passenger.userData.actions as Record<string, THREE.AnimationAction> | undefined;
  if (!actions) return;
  const target = mode === "boarding" ? actions.jump ?? actions.idle : actions.idle;
  if (!target || target === passenger.userData.activeAction) return;
  const current = passenger.userData.activeAction as THREE.AnimationAction | undefined;
  current?.fadeOut(0.18);
  target.reset().fadeIn(0.18).play();
  target.setLoop(mode === "boarding" ? THREE.LoopOnce : THREE.LoopRepeat, mode === "boarding" ? 1 : Infinity);
  target.clampWhenFinished = mode === "boarding";
  passenger.userData.activeAction = target;
}

export function updatePassengerAvatar(passenger: THREE.Group, dt: number, elapsed: number, lean = 0, bob = 0) {
  const mixer = passenger.userData.mixer as THREE.AnimationMixer | undefined;
  mixer?.update(Math.min(dt, 0.08));
  const mode = passenger.userData.mode as PassengerMode;
  if (mode === "riding") {
    const bones = passenger.userData.seatedBones as Array<{ bone: THREE.Bone; delta: THREE.Quaternion }> | undefined;
    bones?.forEach(({ bone, delta }) => bone.quaternion.multiply(delta));
    passenger.rotation.z = -lean * 0.3;
    passenger.position.y = 1.02 + bob * 0.62;
  } else {
    passenger.rotation.y = Math.sin(elapsed * 1.2) * 0.14;
    passenger.position.y = 0.12 + Math.sin(elapsed * 3) * 0.025;
  }
  const head = passenger.userData.head as THREE.Bone | undefined;
  if (head) head.rotation.y += Math.sin(elapsed * 0.9) * 0.08;
}

export function createPassengerAvatar(index: number) {
  const definition = PASSENGER_ANIMALS[index % PASSENGER_ANIMALS.length];
  const group = new THREE.Group();
  group.name = "Animated rigged animal taxi passenger with seated riding pose";
  group.userData.mode = "waiting" satisfies PassengerMode;
  group.userData.animalKind = definition.kind;
  group.userData.assetUrl = definition.url;
  group.userData.usesSkeletalAnimation = true;

  void passengerTemplate(definition.url).then(({ scene, animations }) => {
    if (group.userData.disposed) return;
    const animal = cloneSkinnedModel(scene) as THREE.Group;
    animal.rotation.y = Math.PI;
    animal.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(animal);
    const size = original.getSize(new THREE.Vector3());
    animal.scale.setScalar(definition.height / Math.max(size.y, 0.01));
    animal.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(animal);
    const center = fitted.getCenter(new THREE.Vector3());
    animal.position.set(-center.x, -fitted.min.y, -center.z);
    animal.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    group.add(animal);

    const mixer = new THREE.AnimationMixer(animal);
    const idleClip = animations.find((clip) => /idle/i.test(clip.name)) ?? animations[0];
    const jumpClip = animations.find((clip) => /jump/i.test(clip.name));
    const actions: Record<string, THREE.AnimationAction> = {};
    if (idleClip) actions.idle = mixer.clipAction(idleClip);
    if (jumpClip) actions.jump = mixer.clipAction(jumpClip);
    group.userData.mixer = mixer;
    group.userData.actions = actions;
    group.userData.seatedBones = [] as Array<{ bone: THREE.Bone; delta: THREE.Quaternion }>;
    animal.traverse((object) => {
      if (!(object as THREE.Bone).isBone) return;
      const bone = object as THREE.Bone;
      const delta = seatingDelta(bone.name);
      if (delta) group.userData.seatedBones.push({ bone, delta });
      if (/^head$/i.test(bone.name)) group.userData.head = bone;
    });
    setPassengerAvatarMode(group, group.userData.mode as PassengerMode);
  }).catch(() => { group.userData.loadFailed = true; });
  return group;
}

export function disposePassengerAvatar(passenger: THREE.Group) {
  passenger.userData.disposed = true;
  (passenger.userData.mixer as THREE.AnimationMixer | undefined)?.stopAllAction();
  passenger.clear();
}
