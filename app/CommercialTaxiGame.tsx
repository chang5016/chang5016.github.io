"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { createGpuSky, createRiderGpuMotion, standardNodeMaterial } from "./gpu-materials";
import { GpuShadowCache } from "./gpu-shadow-cache";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createOutdoorEnvironment } from "./outdoor-environment";
import { SimulationClock, interpolate, interpolateAngle } from "./simulation-clock";
import { PackedCityBatches } from "./packed-city-batches";
import { ExactStaticMeshes } from "./exact-static-meshes";
import {
  coordinatesFromLocation,
  createVehicle,
  damp,
  distanceBetween,
  TAICHUNG_LOCATIONS,
  tripFare,
  type VehicleInput,
} from "./game-core";
import { createCharacterMotion, stepCharacterMotion, type CharacterMotion } from "./character-animation";
import { scooterLamps, type SignalMode } from "./scooter-signals";
import { createScooterSuspension } from "./scooter-suspension";
import { createRigidScooterWheels } from "./rigid-scooter-wheels";
import { createPassengerAvatar, disposePassengerAvatar, prefetchScooterRecordings, setPassengerAvatarMode, ScooterAudio, ScooterExhaust, stepTurboCharge, updatePassengerAvatar } from "./driving-effects";
import { scooterSteeringYaw, SCOOTER_EXHAUST_OUTLET } from "./scooter-wheel-layout";
import { EXPRESSWAY_RING_POINTS, RealWorldMap } from "./real-world-map";
import { type QualityLevel } from "./performance-control";
import { MOUNTAIN_ROAD_POINTS, type TrafficLightColor } from "./world-terrain";
import { createVerticalVehicle, stepVerticalVehicle } from "./vehicle-vertical-physics";
import { EMPTY_METRO_HUD, METRO_ALL_STATIONS, MetroSystem, metroStationEntrance, type MetroHud } from "./metro-system";
import { MetroScene } from "./metro-scene";
import { METRO_ROUTE, sampleRoute } from "./metro-route";
import { MetroAudio } from "./metro-audio";
import { GameSfx, audioSettings } from "./game-sfx";
import { createResolutionGovernor, stepResolution } from "./adaptive-resolution";
import { Icon } from "./ui-icons";
import { ScooterIgnition, ignitionInput, stepIgnitedVehicle, type IgnitionPhase } from './scooter-ignition';
import { SCOOTER_DISPLAY_LENGTH } from './vehicle-scale';

type Rider = { name: string; icon: string; preference: string; message: string };
import { completeDriverTrip, driverRank } from "./driver-career";
type Phase = "pickup" | "dropoff";
type EnvironmentMode = "day" | "dusk" | "night" | "rain";
type GameHud = { speed: number; wallet: number; trips: number; rating: number; comfort: number; distance: number; timer: number; target: number; rider: number; phase: Phase; boost: boolean; drift: number; turbo: number; trafficSignal: TrafficLightColor | null; signalDistance: number; elevation: number; ready: boolean; loadingProgress: number; message: string; canInteract: boolean; environment: EnvironmentMode; playerX: number; playerZ: number; heading: number; fps: number; quality: QualityLevel; backend: string; speedMultiplier: number; metro: MetroHud; metroGuide: boolean; ignition: IgnitionPhase };
const CHARACTER_MODEL = "/models/capybara-premium-original.glb?v=original-285179-front-fixed";
const DRIVING_MODEL = CHARACTER_MODEL;
const CHARACTER_DISPLAY_LENGTH = SCOOTER_DISPLAY_LENGTH;
const CHARACTER_FORWARD_FLIP = Math.PI;
const DEFAULT_CAMERA_PITCH = 0.24;
const DEFAULT_CAMERA_DISTANCE = 7.8;
const RIDERS: Rider[] = [
  { name: "巴哥阿福", icon: "🐶", preference: "喜歡平穩兜風", message: "汪！麻煩送我去晴川百貨。" },
  { name: "小豬圓圓", icon: "🐷", preference: "準時抵達有小費", message: "快到午餐時間了，麻煩你！" },
  { name: "綿羊白白", icon: "🐑", preference: "第一次來海灣市", message: "沿路的街景很有意思。" },
  { name: "羊駝拉拉", icon: "🦙", preference: "喜歡舒服的騎乘", message: "山景很好看，慢慢騎也沒關係。" },
];
const START_HUD: GameHud = { speed: 0, wallet: 180, trips: 0, rating: 5, comfort: 100, distance: 18, timer: 120, target: 0, rider: 0, phase: "pickup", boost: false, drift: 0, turbo: 100, trafficSignal: null, signalDistance: 0, elevation: 0, ready: false, loadingProgress: 0, message: "", canInteract: false, environment: "day", playerX: 0, playerZ: 0, heading: 0, fps: 60, quality: 0, backend: "初始化 GPU", speedMultiplier: 1, metro: EMPTY_METRO_HUD, metroGuide: false, ignition: 'running' };

type CharacterRig = {
  updateWheels: (angle: number, steering: number, front: number, rear: number) => void;
  suspension: { value: THREE.Vector2 };
  modelScale: number;
  updateSuspension: (front: number, rear: number, steering?: number) => void;
  lamps: { value: THREE.Vector4 };
  frontWheel?: THREE.Object3D;
  rearWheel?: THREE.Object3D;
  body: {
    pitch: { value: number };
    sway: { value: number };
    bob: { value: number };
    wheelAngle: { value: number };
    frontSteer: { value: number };
  };
};

const IDLE_INPUT: VehicleInput = { forward: false, reverse: false, left: false, right: false, brake: false, drift: false };

/** The whole viaduct centre line, including the eastern U-turn into the city. */
const METRO_LINE_PATH = sampleRoute(0, METRO_ROUTE.length, 8).map(point => `${point.x.toFixed(1)},${point.z.toFixed(1)}`).join(" ");

function CityNavigationMap({ hud, expanded, toggle }: { hud: GameHud; expanded: boolean; toggle: () => void }) {
  const destination = coordinatesFromLocation(TAICHUNG_LOCATIONS[hud.target]);
  const rows = [-760, -610, -460, -300, -110, 90, 270, 460, 620, 760];
  const columns = [-860, -650, -480, -250, 0, 120, 340, 560, 780, 960, 1160];
  const mountainPath = MOUNTAIN_ROAD_POINTS.map((point) => `${point.x},${point.z}`).join(" ");
  const expresswayPath = EXPRESSWAY_RING_POINTS.map((point) => `${point.x},${point.z}`).join(" ");
  const metroEntrance = METRO_ALL_STATIONS.map((_, index) => metroStationEntrance(index)).reduce((best, entrance) => Math.hypot(hud.playerX - entrance.x, hud.playerZ - entrance.z) < Math.hypot(hud.playerX - best.x, hud.playerZ - best.z) ? entrance : best);
  return (
    <aside className={`nav-map ${expanded ? "expanded" : ""}`} aria-label="海灣市高解析導航地圖">
      <div className="nav-map-head"><div><b>海灣市全域導航</b><span>前往 {TAICHUNG_LOCATIONS[hud.target].name} · {Math.round(hud.distance)} m</span></div><button onClick={toggle}>{expanded ? "縮小" : "放大"}</button></div>
      <svg viewBox="-1100 -1000 3430 2000" role="img" aria-label="包含市區、環狀快速道路、交流道、河流、橋梁、山路與目的地的導航地圖">
        <rect x="-1100" y="-1000" width="3430" height="2000" className="map-land" />
        <path d="M1180 -850 Q1420 -480 1260 -150 T1460 300 T1230 900 L2330 900 L2330 -850Z" className="map-mountain" />
        <path d="M620 -850 C585 -540 670 -220 620 80 C570 380 665 610 620 900" className="map-river" />
        {rows.map((z) => <line key={`r${z}`} x1="-900" y1={z} x2="1200" y2={z} className="map-road major" />)}
        {columns.map((x) => <line key={`c${x}`} x1={x} y1="-800" x2={x} y2="820" className="map-road" />)}
        {[-690, -535, -385, -205, -18, 180, 365, 540, 690].map((z) => <line key={`a${z}`} x1="-900" y1={z} x2="1200" y2={z} className="map-road alley" />)}
        <polyline points={expresswayPath} className="map-road expressway-ring" />
        <g className="map-city-expressway">
          <line x1="-1040" y1="-300" x2="1300" y2="-300" />
          <line x1="-650" y1="-900" x2="-650" y2="900" />
          <path d="M-810 -300 Q-740 -180 -650 -150 M-650 -450 Q-555 -410 -495 -300 M-495 -300 Q-560 -190 -650 -150 M-650 -450 Q-750 -410 -810 -300" />
        </g>
        <g className="map-interchanges"><circle cx="-690" cy="900" r="18"/><circle cx="382" cy="-900" r="18"/><circle cx="-1040" cy="226" r="18"/><circle cx="1300" cy="-252" r="18"/><circle cx="-650" cy="-300" r="30"/></g>
        <g className="map-metro"><polyline points={METRO_LINE_PATH} />{METRO_ALL_STATIONS.map(station => <g key={station.id} transform={`translate(${station.x} ${station.lineZ})`}><circle r="25" /><text x="0" y={station.city ? 62 : -42}>{station.id} {station.name}</text></g>)}{hud.metro.positions.map((train, i) => <rect key={i} x={train.x - 20} y={train.z - 10} width="40" height="20" className="map-metro-train" />)}</g>
        {hud.metroGuide && hud.metro.mode !== "train" && <line x1={hud.playerX} y1={hud.playerZ} x2={metroEntrance.x} y2={metroEntrance.z} className="map-metro-guide" />}
        <polyline points={mountainPath} className="map-road mountain-road" />
        <path d="M1590 510 H2210" className="map-road mountain-road" strokeDasharray="18 12" />
        <text x="1740" y="475">山腹隧道 500 m</text>
        <rect x="-415" y="160" width="145" height="95" className="map-park" />
        <rect x="330" y="335" width="155" height="90" className="map-park" />
        <g className="map-bridges"><line x1="565" y1="-610" x2="675" y2="-610"/><line x1="565" y1="-300" x2="675" y2="-300"/><line x1="565" y1="90" x2="675" y2="90"/><line x1="565" y1="460" x2="675" y2="460"/></g>
        <line x1={hud.playerX} y1={hud.playerZ} x2={destination.x} y2={destination.z} className="map-route" />
        <g transform={`translate(${destination.x} ${destination.z})`} className="map-target"><circle r="26"/><circle r="8"/></g>
        <g transform={`translate(${hud.playerX} ${hud.playerZ}) rotate(${hud.heading * 180 / Math.PI})`} className="map-player"><path d="M0 -30 L18 20 L0 12 L-18 20Z" /></g>
        <text x="-820" y="-700">南港生活區</text><text x="-170" y="-520">南町商業區</text><text x="260" y="220">中央辦公區</text><text x="750" y="-390">河岸住宅區</text><text x="1450" y="210">山景別墅區</text><text x="-930" y="860">都會環狀快速道路</text>
      </svg>
      <div className="nav-map-legend"><span><i className="you"/>你的位置</span><span><i className="goal"/>接送目標</span><span><i className="metro"/>海灣高架線</span><span>↑ 北</span></div>
    </aside>
  );
}

const createCinematicSky = createGpuSky;

function createSoftCloudLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const [x, y, radius] of [[72, 76, 42], [112, 57, 53], [157, 69, 47], [193, 78, 34]] as const) {
      const gradient = context.createRadialGradient(x, y, radius * 0.12, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,.96)");
      gradient.addColorStop(0.48, "rgba(248,250,250,.76)");
      gradient.addColorStop(1, "rgba(238,243,244,0)");
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.SpriteMaterial({ map: texture, color: "#f7fafb", transparent: true, opacity: 0.46, depthWrite: false, fog: false });
  const group = new THREE.Group();
  group.name = "Soft layered Taiwanese fair-weather clouds";
  const placements = [
    [-520, 245, -720, 210, 72], [-190, 290, -850, 260, 84], [250, 230, -760, 225, 73],
    [610, 275, -560, 245, 80], [-660, 220, -260, 190, 65], [720, 255, -80, 230, 76],
    [-510, 300, 330, 270, 88], [-90, 225, 570, 210, 68], [410, 280, 690, 255, 83],
  ] as const;
  for (const [x, y, z, width, height] of placements) {
    const cloud = new THREE.Sprite(material);
    cloud.position.set(x, y, z);
    cloud.scale.set(width, height, 1);
    group.add(cloud);
  }
  return { group, material, texture };
}

function bindCharacterRig(model: THREE.Group): CharacterRig | null {
  const frontWheel = model.getObjectByName("capy-frontWheel-animation");
  const rearWheel = model.getObjectByName("capy-rearWheel-animation");
  let staticMesh = model.getObjectByName("capy-static-animation") as THREE.Mesh | undefined;
  if (!staticMesh?.isMesh) {
    model.traverse((object) => {
      if (!staticMesh && (object as THREE.Mesh).isMesh) staticMesh = object as THREE.Mesh;
    });
  }
  if (!staticMesh?.isMesh) return null;
  const updateWheels = createRigidScooterWheels(staticMesh, model);

  if (frontWheel) frontWheel.rotation.order = "YXZ";
  if (rearWheel) rearWheel.rotation.order = "YXZ";
  staticMesh.geometry.computeBoundingBox();
  const modelHeight = staticMesh.geometry.boundingBox?.max.y ?? 0.86;
  const gpuMotion = createRiderGpuMotion(modelHeight);
  const { body, lamps } = gpuMotion;
  const suspension = { value: new THREE.Vector2() };
  const updateSuspension = createScooterSuspension(model);
  updateSuspension(0, 0);
  const usesMaterialArray = Array.isArray(staticMesh.material);
  const sourceMaterials = usesMaterialArray ? staticMesh.material as THREE.Material[] : [staticMesh.material as THREE.Material];
  const animatedMaterials = sourceMaterials.map(source => {
    const material = standardNodeMaterial(source as THREE.MeshStandardMaterial);
    material.positionNode = gpuMotion.positionNode;
    material.emissiveNode = gpuMotion.emissiveNode;
    return material;
  });
  staticMesh.material = usesMaterialArray ? animatedMaterials : animatedMaterials[0];
  return { frontWheel, rearWheel, body, lamps, suspension, modelScale: model.scale.x, updateSuspension, updateWheels };
}

function applyCharacterMotion(rig: CharacterRig, motion: CharacterMotion, landingCompression = 0) {
  const front = Math.min(.08, motion.frontCompression + landingCompression) / rig.modelScale;
  const rear = Math.min(.08, motion.rearCompression + landingCompression) / rig.modelScale;
  rig.suspension.value.set(front, rear);
  const steeringYaw = scooterSteeringYaw(motion.steeringAngle);
  rig.updateSuspension(front, rear, steeringYaw);
  rig.updateWheels(motion.wheelAngle, steeringYaw, front, rear);
  if (rig.frontWheel) {
    rig.frontWheel.rotation.y = steeringYaw;
    rig.frontWheel.rotation.x = motion.wheelAngle;
  }
  if (rig.rearWheel) rig.rearWheel.rotation.x = motion.wheelAngle;
  rig.body.pitch.value = motion.riderPitch;
  rig.body.sway.value = motion.riderSway;
  rig.body.bob.value = motion.riderBob;
  // Original-body wheel deformation is disabled; axles own all wheel motion.
  rig.body.wheelAngle.value = 0;
  rig.body.frontSteer.value = 0;
  rig.suspension.value.set(0, 0);
}

function prepareCharacterModel(model: THREE.Group, renderer: WebGPURenderer) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = CHARACTER_DISPLAY_LENGTH / Math.max(size.x, size.z, 0.001);
  const modelHeading = (size.x > size.z ? Math.PI / 2 : Math.PI) + CHARACTER_FORWARD_FLIP;
  const alignedCenter = center.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), modelHeading);

  model.scale.setScalar(scale);
  model.position.set(-alignedCenter.x * scale, -bounds.min.y * scale + 0.035, -alignedCenter.z * scale);
  model.rotation.y = modelHeading;

  const anisotropy = Math.min(renderer.getMaxAnisotropy(), 8);
  model.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;

    const mesh = object as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;

      const surface = material as THREE.MeshStandardMaterial;
      for (const texture of [surface.map, surface.normalMap, surface.metalnessMap, surface.roughnessMap]) {
        if (texture) texture.anisotropy = anisotropy;
      }
    }
  });

  return { height: size.y * scale, length: Math.max(size.x, size.z) * scale, wheelRadius: 0.102 * scale };
}

function useEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>, activeRef: React.MutableRefObject<boolean>, keys: React.MutableRefObject<Set<string>>, updateRef: React.MutableRefObject<(hud: Partial<GameHud>) => void>, pausedRef: React.MutableRefObject<boolean>) {
  const actionRef = useRef<{ interact: () => void; ignition: () => void; metro: () => void; center: () => void; horn: () => void; uiClick: () => void; activate: () => void; setEnvironment: (mode: EnvironmentMode) => void; adjustSpeed: (direction: -1 | 1) => void; resetSpeed: () => void } | null>(null);

  useEffect(() => {
    const update = updateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let gpuFailed = false;
    const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    void (async () => {
    await renderer.init();
    if (disposed) { renderer.dispose(); return; }
    const backend = renderer.backend as typeof renderer.backend & { isWebGPUBackend?: boolean };
    update({ backend: backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 相容' });
    const nativeDeviceLost = renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost = info => { nativeDeviceLost(info); gpuFailed = true; update({ ready: false, message: '圖形裝置已中斷，請重新載入遊戲' }); };
    renderer.onError = error => { console.error(error); gpuFailed = true; update({ ready: false, message: 'GPU 渲染失敗，請重新載入遊戲' }); };

    const constrainedDevice = window.innerWidth <= 900 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const maxRenderRatio = Math.min(window.devicePixelRatio || 1, constrainedDevice ? 1 : 1.2);
    let resolution = createResolutionGovernor(maxRenderRatio);
    renderer.setPixelRatio(maxRenderRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#b8d2dc");
    scene.fog = new THREE.Fog("#c7d8dc", 330, 1480);
    const sky = createCinematicSky();
    const clouds = createSoftCloudLayer();
    scene.add(sky, clouds.group);
    const environments = new Map<EnvironmentMode, THREE.RenderTarget>();
    const setOutdoorReflection = (mode: EnvironmentMode) => {
      try {
        let reflection = environments.get(mode);
        if (!reflection) { reflection = createOutdoorEnvironment(renderer, mode); environments.set(mode, reflection); }
        scene.environment = reflection.texture;
        scene.environmentIntensity = .7;
      } catch { /* Directional and hemisphere lighting remain available. */ }
    };
    setOutdoorReflection("day");
    const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 2500);
    const daylight = new THREE.HemisphereLight("#e1ebf1", "#766f60", 1.1);
    const sun = new THREE.DirectionalLight("#fff1dc", 2.8);
    sun.position.set(-45, 78, -36);
    sun.castShadow = true;
    sun.shadow.mapSize.set(constrainedDevice ? 768 : 1024, constrainedDevice ? 768 : 1024);
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42;
    sun.shadow.camera.bottom = -42;
    sun.shadow.bias = -0.00014;
    sun.shadow.normalBias = 0.024;
    const skylineFill = new THREE.DirectionalLight("#b8cfdf", 0.22);
    skylineFill.position.set(34, 35, 40);
    scene.add(daylight, sun, sun.target, skylineFill);

    let environmentMode: EnvironmentMode = "day";
    const rainPositions = new Float32Array(920 * 3);
    for (let index = 0; index < rainPositions.length; index += 3) {
      rainPositions[index] = (Math.random() - 0.5) * 46;
      rainPositions[index + 1] = Math.random() * 24;
      rainPositions[index + 2] = (Math.random() - 0.5) * 46;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.PointsMaterial({ color: "#d9e9ed", size: 0.075, transparent: true, opacity: 0.72, depthWrite: false });
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    rain.name = "World-space rain surrounding the open-air passenger";
    rain.visible = false;
    scene.add(rain);

    const world = new RealWorldMap(scene, renderer.getMaxAnisotropy());
    const metroSystem = new MetroSystem(point => world.elevationAt(point), (point, radius) => world.transportSupportClears(point, radius));
    const metroScene = new MetroScene(scene, metroSystem, point => world.elevationAt(point));
    world.enableMetroCommuters(metroSystem);
    const metroAudio = new MetroAudio();
    const continuousShadows = new GpuShadowCache(scene, sun);
    const exactStatic = new ExactStaticMeshes(scene);
    const packedCity = new PackedCityBatches(scene);
    let measuredFps = 60;
    let fpsFrames = 0;
    let fpsWindowStart = performance.now();
    // Keep one visual specification. Load management never hides geometry or shadows.
    world.setQualityLevel(0);
    continuousShadows.invalidate();
    const scooterAudio = new ScooterAudio();
    const sfx = new GameSfx();
    let lastSignalPulse = false;
    const scooterExhaust = new ScooterExhaust(scene);
    const rider = new THREE.Group();
    rider.userData.dynamicWorldObject = true;
    const vehicle = new THREE.Group();
    rider.add(vehicle);
    // Preserve the original full-size rider; transit doors are designed around its footprint.
    vehicle.scale.setScalar(1);
    const contactCanvas = document.createElement("canvas");
    contactCanvas.width = contactCanvas.height = 64;
    const contactContext = contactCanvas.getContext("2d");
    if (contactContext) {
      const gradient = contactContext.createRadialGradient(32, 32, 3, 32, 32, 32);
      gradient.addColorStop(0, "rgba(0,0,0,0.8)");
      gradient.addColorStop(0.4, "rgba(0,0,0,0.4)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      contactContext.fillStyle = gradient;
      contactContext.fillRect(0, 0, 64, 64);
    }
    const contactTexture = new THREE.CanvasTexture(contactCanvas);
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, color: "#222522", transparent: true, opacity: 0.35, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.75, 40), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.7, 1.28, 1);
    scene.add(rider, shadow);
    const scooterHeadlight = new THREE.SpotLight("#fff1c7", 0, 70, Math.PI / 7, 0.5, 1.35);
    scooterHeadlight.position.set(0, 1.15, -1.1);
    scooterHeadlight.target.position.set(0, 0.2, -16);
    vehicle.add(scooterHeadlight, scooterHeadlight.target);
    let signalMode: SignalMode = "off";
    let signalStarted = 0;
    let signalTurned = false;

    let engineDisposed = false;
    let scenePrepared = false;
    let characterLoaded = false;
    let characterRig: CharacterRig | null = null;
    let exhaustModel: THREE.Object3D | null = null;
    const exhaustOutlet = new THREE.Vector3();
    let characterMotion = createCharacterMotion();
    let characterHeight = 2.95;
    let wheelRadius = 0.34;
    new GLTFLoader().load(DRIVING_MODEL, async (asset) => {
      if (engineDisposed) return;
      const dimensions = prepareCharacterModel(asset.scene, renderer);
      characterHeight = dimensions.height * vehicle.scale.x;
      wheelRadius = dimensions.wheelRadius * vehicle.scale.x;
      characterRig = bindCharacterRig(asset.scene);
      // Compile the complete textured rider before exposing it on the first ride.
      try { await renderer.compileAsync(asset.scene, camera, scene); } catch (error) { update({ ready: false, message: `機車 GPU 材質編譯失敗：${String(error)}` }); return; }
      if (engineDisposed) return;
      vehicle.add(asset.scene);
      exhaustModel = asset.scene;
      continuousShadows.invalidate();
      characterLoaded = true;
      update({ ready: scenePrepared, loadingProgress: 100 });
    }, (event) => {
      const progress = event.total > 0 ? Math.min(99, Math.round(event.loaded / event.total * 100)) : 0;
      if (progress > 0) update({ loadingProgress: progress });
    }, () => {
      update({ ready: false, message: "3D 模型載入失敗，請重新整理頁面" });
    });

    const markerRing = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.16, 12, 64), new THREE.MeshBasicMaterial({ color: "#f3c17c", transparent: true, opacity: 0.93 }));
    markerRing.rotation.x = Math.PI / 2;
    markerRing.position.y = 0.42;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.1, 12, 24, 1, true), new THREE.MeshBasicMaterial({ color: "#efbb73", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 6;
    const marker = new THREE.Group();
    marker.userData.dynamicWorldObject = true;
    marker.add(markerRing, beam);
    scene.add(marker);
    let passenger = createPassengerAvatar(0);
    passenger.userData.dynamicWorldObject = true;
    setPassengerAvatarMode(passenger, "waiting");
    passenger.position.set(2.2, 0.12, 0);
    marker.add(passenger);

    const directionPoints = new Float32Array(6);
    const routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute("position", new THREE.BufferAttribute(directionPoints, 3));
    const route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({ color: "#ffc77f", transparent: true, opacity: 0.83 }));
    scene.add(route);

    let state = createVehicle();
    const ignition = new ScooterIgnition();
    let vertical = createVerticalVehicle(world.elevationAt(state, state.heading));
    const clock = new SimulationClock();
    let previousState = state;
    let previousVertical = vertical;
    let previousMotion = characterMotion;
    let terrainElevation = vertical.height;
    const trafficSoundPosition = new THREE.Vector3();
    let previousLandingImpact = 0;
    let animation = 0;
    let previousTime = performance.now();
    let simulationSeconds = previousTime / 1000;
    let frame = 0;
    let orbit = 0;
    let orbitPitch = DEFAULT_CAMERA_PITCH;
    let orbitDistance = DEFAULT_CAMERA_DISTANCE;
    let actualDistance = DEFAULT_CAMERA_DISTANCE;
    let actualPitch = DEFAULT_CAMERA_PITCH;
    let cameraAngle = 0;
    let freeCameraUntil = 0;
    let pointer: { id: number; x: number; y: number } | null = null;
    let driftingPreviously = false;
    let roadSpawnApplied = false;
    let collisionCooldown = 0;
    let signalPenaltyCooldown = 0;
    let previousSignal: { key: string; distance: number } | null = null;
    let turboCharge = 100;
    let turboEngaged = false;
    let roadPitch = 0;
    let previousSpeed = 0;
    let headSurge = 0;
    let headHeave = 0;
    let headRoll = 0;
    let targetIndex = 0;
    let riderIndex = 0;
    let phase: Phase = "pickup";
    let wallet = 180;
    let trips = 0;
    let streak = 0;
    let pickupPosition = coordinatesFromLocation(TAICHUNG_LOCATIONS[0]);
    let rating = 5;
    let comfort = 100;
    let remaining = 135;
    let message = "自己騎往中央綠園道接第一位乘客";
    let messageUntil = performance.now() + 5000;
    let metroGuide = false;
    const speedLevels = [0.75, 1, 1.25, 1.5, 2, 2.5] as const;
    let speedMultiplier = 1;
    const adjustSpeed = (direction: -1 | 1) => {
      const closest = speedLevels.reduce((best, level, index) => Math.abs(level - speedMultiplier) < Math.abs(speedLevels[best] - speedMultiplier) ? index : best, 0);
      speedMultiplier = speedLevels[Math.max(0, Math.min(speedLevels.length - 1, closest + direction))];
      message = `速度密技已調整為 ×${speedMultiplier}`;
      messageUntil = performance.now() + 1800;
      update({ speedMultiplier, message });
    };
    const resetSpeed = () => {
      speedMultiplier = 1;
      message = "速度密技已重設為 ×1";
      messageUntil = performance.now() + 1800;
      update({ speedMultiplier, message });
    };

    const destinations = TAICHUNG_LOCATIONS.map(coordinatesFromLocation);
    const targetPosition = () => destinations[targetIndex];
    const updateMarker = () => {
      const target = targetPosition();
      marker.position.set(target.x, world.elevationAt(target), target.z);
      const color = phase === "pickup" ? "#f3c17c" : "#a4d2aa";
      (markerRing.material as THREE.MeshBasicMaterial).color.set(color);
      (beam.material as THREE.MeshBasicMaterial).color.set(color);
    };
    updateMarker();

    const interact = () => {
      if (!activeRef.current) return;
      const distance = distanceBetween(state, targetPosition());
      if (distance > 17) {
        message = `再靠近 ${Math.round(distance)} 公尺後按 E`;
        messageUntil = performance.now() + 2300;
        return;
      }
      if (Math.abs(state.speed) > 5) {
        message = "先停穩再讓乘客上下車";
        messageUntil = performance.now() + 2400;
        return;
      }
      if (phase === "pickup") {
        pickupPosition = targetPosition();
        comfort = 100;
        phase = "dropoff";
        marker.remove(passenger);
        passenger.position.set(0, 1.02, 0.88);
        passenger.rotation.set(0, 0, 0);
        passenger.scale.setScalar(0.77);
        setPassengerAvatarMode(passenger, "riding");
        sfx.pickup();
        vehicle.add(passenger);
        targetIndex = (targetIndex + 1 + trips % 3) % TAICHUNG_LOCATIONS.length;
        remaining = 100 + distanceBetween(state, targetPosition()) / 6;
        message = `${RIDERS[riderIndex].icon} 前往 ${TAICHUNG_LOCATIONS[targetIndex].name}。舒適度 85 以上且準時抵達，可獲得連單獎金！`;
      } else {
        const fare = tripFare(distanceBetween(pickupPosition, targetPosition()), remaining, comfort);
        const result = completeDriverTrip(comfort, remaining, streak);
        streak = result.streak;
        wallet += fare.total + result.bonus;
        sfx.dropoff();
        trips++;
        rating = Math.max(3.5, Math.min(5, Math.round((rating * 0.8 + (comfort > 72 ? 5 : 4.3) * 0.2) * 10) / 10));
        message = `${result.grade} 級送達 · 車資 NT$ ${fare.total} + 獎金 ${result.bonus} · ${streak} 連單 · ${driverRank(trips)}`;
        targetIndex = (targetIndex + 2) % TAICHUNG_LOCATIONS.length;
        riderIndex = (riderIndex + 1) % RIDERS.length;
        vehicle.remove(passenger);
        disposePassengerAvatar(passenger);
        passenger = createPassengerAvatar(riderIndex);
        setPassengerAvatarMode(passenger, "waiting");
        passenger.position.set(2.2, 0.12, 0);
        marker.add(passenger);
        comfort = 100;
        phase = "pickup";
      }
      messageUntil = performance.now() + 5300;
      updateMarker();
    };

    const setEnvironment = (mode: EnvironmentMode) => {
      environmentMode = mode;
      const skyMaterial = sky.material;
      const wet = mode === "rain";
      rain.visible = wet;
      if (mode === "day") {
        (scene.background as THREE.Color).set("#b8d2dc"); scene.fog?.color.set("#c7d8dc");
        skyMaterial.skyUniforms.zenith.value.set("#4f8fbe"); skyMaterial.skyUniforms.horizon.value.set("#dce9ee");
        skyMaterial.skyUniforms.hazeColor.value.set("#c9dadd"); clouds.material.color.set("#f7fafb"); clouds.material.opacity = 0.46;
        daylight.intensity = 1.1; sun.intensity = 2.8; skylineFill.intensity = 0.22; renderer.toneMappingExposure = 0.94;
        scooterHeadlight.intensity = 0;
      } else if (mode === "dusk") {
        (scene.background as THREE.Color).set("#a07c70"); scene.fog?.color.set("#a88f81");
        skyMaterial.skyUniforms.zenith.value.set("#334b68"); skyMaterial.skyUniforms.horizon.value.set("#d68c62");
        skyMaterial.skyUniforms.hazeColor.value.set("#b88f80"); clouds.material.color.set("#e8c8b6"); clouds.material.opacity = 0.3;
        daylight.intensity = 0.73; sun.intensity = 2.15; skylineFill.intensity = 0.42; renderer.toneMappingExposure = 1.04;
        scooterHeadlight.intensity = 32;
      } else if (mode === "night") {
        (scene.background as THREE.Color).set("#111b29"); scene.fog?.color.set("#1d2b35");
        skyMaterial.skyUniforms.zenith.value.set("#081320"); skyMaterial.skyUniforms.horizon.value.set("#314154");
        skyMaterial.skyUniforms.hazeColor.value.set("#253542"); clouds.material.color.set("#5a6874"); clouds.material.opacity = 0.12;
        daylight.intensity = 0.2; sun.intensity = 0.18; skylineFill.intensity = 0.28; renderer.toneMappingExposure = 0.88;
        scooterHeadlight.intensity = 92;
      } else {
        (scene.background as THREE.Color).set("#77878b"); scene.fog?.color.set("#829093");
        skyMaterial.skyUniforms.zenith.value.set("#56676d"); skyMaterial.skyUniforms.horizon.value.set("#879496");
        skyMaterial.skyUniforms.hazeColor.value.set("#829093"); clouds.material.color.set("#afb8ba"); clouds.material.opacity = 0.68;
        daylight.intensity = 0.58; sun.intensity = 0.54; skylineFill.intensity = 0.38; renderer.toneMappingExposure = 0.95;
        scooterHeadlight.intensity = 44;
      }
      (scene.fog as THREE.Fog).near = wet ? 105 : mode === "night" ? 165 : mode === "day" ? 330 : 230;
      (scene.fog as THREE.Fog).far = wet ? 640 : mode === "night" ? 820 : mode === "day" ? 1480 : 1160;
      world.setWeather(wet, mode === "night" || mode === "dusk");
      setOutdoorReflection(mode);
      continuousShadows.invalidate();
      update({ environment: mode, message: mode === "rain" ? "雨天模式：濕滑路面與低能見度" : mode === "night" ? "夜間模式：車燈與街燈已開啟" : mode === "dusk" ? "黃昏模式：招牌與路燈開始亮起" : "白天模式：自然日光" });
      messageUntil = performance.now() + 2100;
    };

    actionRef.current = {
      interact,
      ignition: () => {
        if (!activeRef.current) return;
        const phase=ignition.toggle();
        scooterAudio.setIgnition(ignition.running); scooterAudio.start();
        if (phase === 'starting') scooterAudio.starterMotor();
        if (!ignition.running) { state={...state,throttle:0,boost:0,driftCharge:0}; turboEngaged=false; }
        message=phase==='off'?'引擎已熄火，可滑行與煞車':'正在發動引擎…';
        messageUntil=performance.now()+1800;
        update({ignition:phase,message});
      },
      metro: () => {
        if (!activeRef.current) return;
        message = metroSystem.operate(state, vertical.height);
        messageUntil = performance.now() + 6500;
        metroGuide = !metroSystem.carrier;
        update({ message, metroGuide, metro: metroSystem.hud(state, vertical.height) });
      },
      activate: () => { scooterAudio.start(); metroAudio.start(); sfx.start(); },
      uiClick: () => sfx.ui(),
      setEnvironment,
      adjustSpeed,
      resetSpeed,
      center: () => {
        orbit = 0;
        orbitDistance = DEFAULT_CAMERA_DISTANCE;
        orbitPitch = DEFAULT_CAMERA_PITCH;
        cameraAngle = state.heading;
        freeCameraUntil = 0;
      },
      horn: () => { scooterAudio.start(); scooterAudio.horn(); message = "叭叭！請注意水豚來了"; messageUntil = performance.now() + 1500; },
    };

    const down = (event: KeyboardEvent) => {
      scooterAudio.setIgnition(activeRef.current && ignition.running);
      scooterAudio.start();
      if (activeRef.current) { metroAudio.start(); sfx.start(); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      if (!event.repeat && event.code === "KeyE") interact();
      if (!event.repeat && event.code === "KeyT") actionRef.current?.metro();
      if (!event.repeat && event.code === "KeyC") actionRef.current?.center();
      if (!event.repeat && event.code === "KeyH") actionRef.current?.horn();
      if (!event.repeat && event.code === "KeyI") actionRef.current?.ignition();
      if (!event.repeat && ["KeyQ", "KeyR", "KeyX"].includes(event.code)) {
        const requested: SignalMode = event.code === "KeyQ" ? "left" : event.code === "KeyR" ? "right" : "hazard";
        signalMode = signalMode === requested ? "off" : requested;
        signalStarted = performance.now() / 1000;
        signalTurned = false;
        message = signalMode === "off" ? "方向燈關閉" : signalMode === "hazard" ? "雙黃警示燈" : signalMode === "left" ? "左方向燈" : "右方向燈";
        messageUntil = performance.now() + 1600;
      }
      if (!event.repeat && event.code === "BracketLeft") adjustSpeed(-1);
      if (!event.repeat && event.code === "BracketRight") adjustSpeed(1);
      if (!event.repeat && event.code === "Backslash") resetSpeed();
      keys.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const releaseControls = () => keys.current.clear();
    const visibilityChange = () => { if (document.hidden) releaseControls(); };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      orbit -= (event.clientX - pointer.x) * 0.006;
      orbitPitch = Math.max(0.065, Math.min(0.69, orbitPitch - (event.clientY - pointer.y) * 0.0034));
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      freeCameraUntil = performance.now() + 2300;
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); orbitDistance = Math.max(6.2, Math.min(27, orbitDistance + event.deltaY * 0.01)); };
    const resize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseControls);
    document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });

    update({ ready: characterLoaded, message });
    if (new URLSearchParams(window.location.search).has("debug")) (window as Window & { __capy?: unknown }).__capy = { renderer, scene, camera, world, metro: metroSystem, metroScene, sun, exactStatic, packedCity };
    const draw = (now: number) => {
      animation = requestAnimationFrame(draw);
      if (gpuFailed || document.hidden || pausedRef.current || !scenePrepared) {
        metroAudio.silence();
        previousTime = now; clock.reset(); previousState = state; previousVertical = vertical; previousMotion = characterMotion;
        simulationSeconds = now / 1000; world.resetTrafficInterpolation(); metroSystem.resetInterpolation();
        fpsWindowStart = now; fpsFrames = 0; return;
      }
      const frameSeconds = Math.max(0, (now - previousTime) / 1000);
      const dt = Math.min(frameSeconds, .1);
      previousTime = now;
      frame++;
      fpsFrames++;
      if (now - fpsWindowStart >= 1000) {
        measuredFps = Math.round(fpsFrames * 1000 / Math.max(1, now - fpsWindowStart));
        const nextResolution = stepResolution(resolution, measuredFps, maxRenderRatio);
        if (nextResolution.ratio !== resolution.ratio) { renderer.setPixelRatio(nextResolution.ratio); renderer.setSize(window.innerWidth, window.innerHeight, false); }
        resolution = nextResolution;
        fpsFrames = 0;
        fpsWindowStart = now;
      }

      if (!roadSpawnApplied && world.spawnPoint) {
        if (Math.hypot(state.x, state.z) < 0.25 && Math.abs(state.speed) < 0.1) {
          state = { ...state, ...world.spawnPoint };
          vertical = createVerticalVehicle(world.elevationAt(state, state.heading));
          cameraAngle = state.heading;
          previousState = state; previousVertical = vertical; terrainElevation = vertical.height;
        }
        roadSpawnApplied = true;
      }

      const alpha = clock.advance(frameSeconds, dt => {
        simulationSeconds += dt;
        if (ignition.step(dt)) {
          message='引擎已發動'; messageUntil=now+1500;
          scooterAudio.setIgnition(activeRef.current);
          update({ignition:ignition.phase,message});
        }
        previousState = state; previousVertical = vertical; previousMotion = characterMotion;
        const transport = metroSystem.beginStep(state, vertical.height, dt);
        state = transport.rider;
        if (transport.carrierHeight !== undefined) vertical = { ...vertical, height: transport.carrierHeight, lastGroundHeight: transport.carrierHeight, grounded: true, compression: 0, impact: 0 };
        const stationSpeedLimit = metroSystem.speedLimitAt(state, vertical.height);
        let roadGrade = 0;
        if (activeRef.current) {
          const input: VehicleInput = ignitionInput({
            forward: keys.current.has("KeyW") || keys.current.has("ArrowUp"),
            reverse: keys.current.has("KeyS") || keys.current.has("ArrowDown"),
            left: keys.current.has("KeyA") || keys.current.has("ArrowLeft"),
            right: keys.current.has("KeyD") || keys.current.has("ArrowRight"),
            brake: keys.current.has("Space"),
            drift: keys.current.has("ShiftLeft") || keys.current.has("ShiftRight"),
          }, state, ignition.running);
          const nearby = world.nearbyStaticObstacles(state, 42, vertical.height);
          const traffic = world.nearbyTraffic(state, vertical.height);
          nearby.push(...traffic, ...metroSystem.obstaclesAt(state, vertical.height));
          if (Number.isFinite(stationSpeedLimit)) {
            input.drift = false;
            state = { ...state, speed: Math.max(-stationSpeedLimit, Math.min(stationSpeedLimit, state.speed)), boost: 0, driftCharge: 0 };
          }
          if (transport.locked) { input.forward = false; input.reverse = false; input.brake = true; state = { ...state, speed: 0, throttle: 0 }; }
          const turbo = stepTurboCharge(turboCharge, ignition.running && keys.current.has("KeyF") && !Number.isFinite(stationSpeedLimit), state.speed, dt);
          turboCharge = turbo.charge;
          turboEngaged = turbo.engaged;
          if (turboEngaged) state.boost = Math.max(state.boost, 0.18);
          roadGrade = metroSystem.surfaceAt(state, vertical.height) !== undefined ? 0 : world.gradeAt(state, state.heading, vertical.height);
          state = stepIgnitedVehicle(state, input, ignition.running, dt, nearby, (speedMultiplier - 1) * 6, roadGrade, environmentMode === "rain" ? .62 : 1, metroSystem.collisionRadiusAt(state, vertical.height));
          if (Number.isFinite(stationSpeedLimit)) state = { ...state, speed: Math.max(-stationSpeedLimit, Math.min(stationSpeedLimit, state.speed)) };
          if (ignition.running && driftingPreviously && !input.drift && state.driftCharge > 0.55) {
            state.boost = Math.min(2.4, 0.45 + state.driftCharge * 0.43);
            state.driftCharge = 0;
            message = "甩尾蓄力完成，加速啟動";
            messageUntil = now + 1800;
          }
          driftingPreviously = input.drift;
          if (state.collided && now > collisionCooldown) {
            collisionCooldown = now + 1200;
            comfort = Math.max(20, comfort - 8);
            message = "撞到障礙物，乘客舒適度下降";
            messageUntil = now + 1900;
          }
          const signal = world.signalAhead(state, state.heading, simulationSeconds, vertical.height);
          if (signal && previousSignal?.key === signal.key && previousSignal.distance > 0 && signal.distance <= 0 && signal.color === "red" && now > signalPenaltyCooldown) {
            signalPenaltyCooldown = now + 5500;
            wallet = Math.max(0, wallet - 45);
            comfort = Math.max(15, comfort - 12);
            message = "闖紅燈！扣款 NT$ 45，乘客舒適度下降";
            messageUntil = now + 3600;
          } else if (signal && signal.color === "red" && signal.distance > 1 && signal.distance < 17 && now > messageUntil) {
            message = "前方紅燈，請減速停等";
            messageUntil = now + 950;
          }
          previousSignal = signal ? { key: signal.key, distance: signal.distance } : null;
          const waitingForMetro = !!metroSystem.carrier || (vertical.height > 20 && Number.isFinite(stationSpeedLimit));
          if (phase === "dropoff" && !waitingForMetro) remaining = Math.max(0, remaining - dt);
          characterMotion = stepCharacterMotion(characterMotion, state, input, dt, wheelRadius);
        } else {
          characterMotion = stepCharacterMotion(characterMotion, state, IDLE_INPUT, dt, wheelRadius);
        }

        state = metroSystem.endStep(state, vertical.height);
        if (metroSystem.carrier?.kind === 'train') metroGuide = false;
        terrainElevation = metroSystem.surfaceAt(state, vertical.height) ?? world.elevationAt(state, state.heading, vertical.height);
        vertical = metroSystem.carrier ? { ...vertical, height: terrainElevation, velocity: (terrainElevation - previousVertical.height) / dt, lastGroundHeight: terrainElevation, grounded: true, compression: 0, impact: 0, airTime: 0 } : stepVerticalVehicle(vertical, terrainElevation, dt);
        if (vertical.impact > 0.08 && previousLandingImpact <= 0.08) scooterAudio.landing(vertical.impact);
        previousLandingImpact = vertical.impact;
        const propImpact=world.stepStreetPropPhysics(previousState,state,previousVertical.height,vertical.height,dt);
        if (propImpact) {
          state={...state,speed:state.speed*(1-propImpact.strength*.15),suspensionVelocity:state.suspensionVelocity+propImpact.strength*.3};
          comfort=Math.max(20,comfort-propImpact.strength*3);
          scooterAudio.landing(propImpact.strength);
          message=propImpact.kind==='hydrant'?'消防栓受損噴水，請注意路邊設施':propImpact.kind==='bench'?'撞到長椅，請注意路邊設施':'撞到花盆，請小心騎行'; messageUntil=now+1500;
        }
        roadPitch = damp(roadPitch, vertical.grounded ? Math.atan(roadGrade) : 0, vertical.grounded ? 7.5 : 1.7, dt);
        world.updateRoadTraffic(simulationSeconds, dt, state, vertical.height);
      });
      metroScene.render(alpha, state);
      world.renderStreetPropPhysics(alpha);
      metroAudio.update(metroSystem, state, vertical.height);
      const visual = {
        ...state,
        x: interpolate(previousState.x, state.x, alpha),
        z: interpolate(previousState.z, state.z, alpha),
        heading: interpolateAngle(previousState.heading, state.heading, alpha),
        lean: interpolate(previousState.lean, state.lean, alpha),
        suspension: interpolate(previousState.suspension, state.suspension, alpha),
      };
      const visualMotion = { ...characterMotion,
        wheelAngle: interpolateAngle(previousMotion.wheelAngle, characterMotion.wheelAngle, alpha),
        steeringAngle: interpolate(previousMotion.steeringAngle, characterMotion.steeringAngle, alpha),
        frontCompression: interpolate(previousMotion.frontCompression, characterMotion.frontCompression, alpha),
        rearCompression: interpolate(previousMotion.rearCompression, characterMotion.rearCompression, alpha),
      };
      const vehicleHeight = interpolate(previousVertical.height, vertical.height, alpha) + visual.suspension * 0.32 - vertical.compression * 0.42;
      metroScene.updateInteriorLighting(visual,vehicleHeight);
      rider.position.set(visual.x, vehicleHeight, visual.z);
      rider.rotation.y = -visual.heading;
      vehicle.rotation.z = visual.lean;
      vehicle.rotation.x = characterMotion.chassisPitch + roadPitch - (vertical.grounded ? 0 : Math.max(-0.1, Math.min(0.1, vertical.velocity * 0.018)));
      const airborneHeight = Math.max(0, vehicleHeight - terrainElevation);
      shadow.position.set(visual.x, terrainElevation + 0.055, visual.z);
      shadow.rotation.z = visual.heading;
      const contactScale = Math.max(.48, 1 - airborneHeight * .045);
      shadow.scale.set(.36 * contactScale, .72 * contactScale, 1);
      shadowMaterial.opacity = Math.max(0.08, 0.34 - airborneHeight * 0.035);
      if (characterRig) applyCharacterMotion(characterRig, visualMotion, vertical.compression * .42);
      if (signalMode === "left" || signalMode === "right") {
        if (Math.abs(state.steering) > 0.45 && Math.abs(state.speed) > 1) signalTurned = true;
        if (signalTurned && Math.abs(state.steering) < 0.08 && now / 1000 - signalStarted > 1.2) signalMode = "off";
      }
      const lamps = scooterLamps(signalMode, now / 1000 - signalStarted, keys.current.has("Space") || (keys.current.has("KeyS") && state.speed > 0.2));
      const signalPulse = lamps.left > 0 || lamps.right > 0;
      if (signalPulse !== lastSignalPulse) { lastSignalPulse = signalPulse; sfx.relay(signalPulse); }
      characterRig?.lamps.value.set(lamps.tail, lamps.left, lamps.right, scooterHeadlight.intensity > 0 ? 1.8 : 0.25);
      scooterHeadlight.target.position.x = -Math.sin(scooterSteeringYaw(visualMotion.steeringAngle)) * 12;
      updatePassengerAvatar(passenger, dt, now / 1000, visual.lean, characterMotion.riderBob);
      world.interpolateRoadTraffic(alpha, simulationSeconds + alpha * clock.step);
      if (frame % 3 === 0) world.update(state);
      markerRing.rotation.z += dt * 0.4;
      markerRing.scale.setScalar(1 + Math.sin(now * 0.003) * 0.08);
      beam.material.opacity = 0.12 + Math.sin(now * 0.002) * 0.04;

      if (!pointer && now > freeCameraUntil && Math.abs(state.speed) > 1.2) orbit = damp(orbit, 0, 2.8, dt);
      const desiredAngle = visual.heading + orbit + state.steering * Math.min(Math.abs(state.speed), 18) * 0.004;
      const angleDelta = Math.atan2(Math.sin(desiredAngle - cameraAngle), Math.cos(desiredAngle - cameraAngle));
      cameraAngle += angleDelta * (1 - Math.exp(-(pointer ? 14 : 4.7) * dt));
      const acceleration = (state.speed - previousSpeed) / Math.max(dt, 0.001);
      previousSpeed = state.speed;
      headSurge = damp(headSurge, Math.max(-0.24, Math.min(0.3, acceleration * 0.017)), 5.3, dt);
      headHeave = damp(headHeave, state.suspension * 1.65 + Math.min(vertical.impact * 0.16, 0.13), vertical.impact > 0.08 ? 18 : 8.5, dt);
      headRoll = damp(headRoll, visual.lean * 0.52, pointer ? 3.3 : 5.1, dt);
      actualDistance = damp(actualDistance, orbitDistance + Math.min(Math.abs(state.speed) * 0.075, 1.8) + headSurge, 5.2, dt);
      actualPitch = damp(actualPitch, orbitPitch - headSurge * 0.08, 5.5, dt);
      const followTargetHeight = Math.max(1.65, characterHeight * 0.57);
      const cameraHeight = vehicleHeight + Math.sin(actualPitch) * actualDistance + followTargetHeight + 0.42 + headHeave;
      const horizontal = Math.cos(actualPitch) * actualDistance;
      camera.position.set(
        visual.x - Math.sin(cameraAngle) * horizontal,
        cameraHeight,
        visual.z + Math.cos(cameraAngle) * horizontal,
      );
      world.constrainTunnelCamera(camera.position,state,vehicleHeight);
      metroScene.constrainCamera(camera.position,visual,vehicleHeight,alpha);
      camera.lookAt(
        visual.x + Math.sin(visual.heading) * Math.min(Math.abs(state.speed) * 0.12, 2.4),
        vehicleHeight + followTargetHeight - headSurge * 0.3,
        visual.z - Math.cos(visual.heading) * Math.min(Math.abs(state.speed) * 0.12, 2.4),
      );
      camera.rotateZ(-headRoll);
      if (exhaustModel) {
        exhaustOutlet.set(SCOOTER_EXHAUST_OUTLET.x, SCOOTER_EXHAUST_OUTLET.y, SCOOTER_EXHAUST_OUTLET.z);
        exhaustModel.localToWorld(exhaustOutlet);
      }
      scooterExhaust.update(visual, vehicleHeight, dt, turboEngaged || state.boost > 0, camera, exhaustModel ? exhaustOutlet : undefined, activeRef.current && ignition.running);
      const nearestTraffic = world.nearestTrafficPosition(visual, vehicleHeight, trafficSoundPosition) ? trafficSoundPosition : undefined;
      scooterAudio.update(state.speed, state.throttle, turboEngaged || state.boost > 0, { source: rider.position, listener: camera, trafficSource: nearestTraffic }, activeRef.current && ignition.running);
      sky.position.set(visual.x, terrainElevation - 55, visual.z);
      clouds.group.position.set(visual.x, terrainElevation - 18, visual.z);
      if (environmentMode === "rain") {
        rain.position.set(visual.x, terrainElevation, visual.z);
        const positions = rainGeometry.getAttribute("position") as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index++) {
          let y = positions.getY(index) - dt * (20 + (index % 9) * 0.7);
          if (y < 0) y += 24;
          positions.setY(index, y);
        }
        positions.needsUpdate = true;
      }

      continuousShadows.follow(visual.x, terrainElevation, visual.z);

      const destination = targetPosition();
      const destinationElevation = marker.position.y;
      directionPoints.set([state.x, terrainElevation + 0.36, state.z, destination.x, destinationElevation + 0.36, destination.z]);
      routeGeometry.attributes.position.needsUpdate = true;

      if (frame % 10 === 0) {
        const distance = distanceBetween(state, destination);
        const signal = world.signalAhead(state, state.heading, simulationSeconds, vertical.height);
        update({ speed: Math.round(Math.abs(state.speed) * 3.6), wallet, trips, rating, comfort, distance, timer: Math.ceil(remaining), target: targetIndex, rider: riderIndex, phase, boost: state.boost > 0, drift: state.driftCharge, turbo: turboCharge, trafficSignal: signal && signal.distance > -2 ? signal.color : null, signalDistance: signal?.distance ?? 0, elevation: terrainElevation, ready: characterLoaded && scenePrepared, message: now < messageUntil ? message : "", canInteract: distance < 17 && Math.abs(state.speed) < 5, playerX: state.x, playerZ: state.z, heading: state.heading, fps: measuredFps, quality: 0, speedMultiplier, ignition: ignition.phase, metro: metroSystem.hud(state, vertical.height), metroGuide });
      }
      world.updateNeighborhood(dt,state,camera.position);
      world.updateTrafficRendering(camera,sun.shadow.camera);
      exactStatic.update();
      packedCity.update(camera, sun.shadow.camera);
      renderer.render(scene, camera);
    };
    void metroScene.ready.then(async () => {
      if (engineDisposed) return;
      exactStatic.update();
      packedCity.update(camera, sun.shadow.camera);
      await renderer.compileAsync(scene, camera);
      if (!engineDisposed && !gpuFailed) { scenePrepared = true; continuousShadows.invalidate(); update({ ready: characterLoaded }); prefetchScooterRecordings(); }
    }).catch(error => {
      if (!engineDisposed) { gpuFailed = true; update({ ready: false, message: `3D 場景載入或編譯失敗，請重新載入：${String(error)}` }); }
    });
    draw(performance.now());

    cleanup = () => {
      engineDisposed = true;
      cancelAnimationFrame(animation);
      scooterAudio.dispose();
      sfx.dispose();
      scooterExhaust.dispose();
      disposePassengerAvatar(passenger);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseControls);
      document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      metroScene.dispose();
      metroAudio.dispose();
      packedCity.dispose();
      exactStatic.dispose();
      world.dispose();
      continuousShadows.dispose();
      environments.forEach(environment => environment.dispose());
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.material.dispose();
      clouds.texture.dispose();
      rainGeometry.dispose();
      rainMaterial.dispose();
      shadow.geometry.dispose();
      shadowMaterial.dispose();
      contactTexture.dispose();
      renderer.dispose();
      actionRef.current = null;
    };
    })().catch(error => {
      cleanup?.(); renderer.dispose();
      if (!disposed) update({ ready: false, message: `3D 圖形初始化失敗：${String(error)}` });
    });
    return () => { disposed = true; if (cleanup) cleanup(); };

  }, [canvasRef, activeRef, keys, updateRef, pausedRef]);

  return actionRef;
}

function ModelShowroom({ close }: { close: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    void (async () => {
    await renderer.init();
    if (disposed) { renderer.dispose(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(6.8, 3.4, 8.5);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.15, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.8;
    controls.maxDistance = 15;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.65;

    scene.add(new THREE.HemisphereLight("#fff2d7", "#50463b", 2.1));
    const main = new THREE.DirectionalLight("#fff0d2", 3.5);
    main.position.set(5, 8, 5);
    main.castShadow = true;
    scene.add(main);
    const rim = new THREE.DirectionalLight("#c0d2db", 2);
    rim.position.set(-4, 3, -5);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5, 80),
      new THREE.MeshStandardMaterial({ color: "#35362f", roughness: 0.77 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    scene.add(ground);

    let stopped = false;
    let showroomRig: CharacterRig | null = null;
    let showroomMotion = createCharacterMotion();
    const showroomVehicle = { ...createVehicle(), speed: 0.42 };
    new GLTFLoader().load(CHARACTER_MODEL, (asset) => {
      if (stopped) return;
      const dimensions = prepareCharacterModel(asset.scene, renderer);
      showroomRig = bindCharacterRig(asset.scene);
      controls.target.set(0, dimensions.height * 0.52, 0);
      camera.position.set(dimensions.length * 1.15, dimensions.height * 1.38, dimensions.length * 1.4);
      controls.update();
      scene.add(asset.scene);
    });

    let animation = 0;
    let previousTime = performance.now();
    const draw = (now: number) => {
      animation = requestAnimationFrame(draw);
      const dt = Math.min((now - previousTime) / 1000, 0.04);
      previousTime = now;
      showroomVehicle.steering = Math.sin(now * 0.0008) * 0.35;
      showroomMotion = stepCharacterMotion(showroomMotion, showroomVehicle, IDLE_INPUT, dt);
      if (showroomRig) applyCharacterMotion(showroomRig, showroomMotion);
      controls.update();
      renderer.render(scene, camera);
    };
    draw(performance.now());

    const resize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    window.addEventListener("resize", resize);

    cleanup = () => {
      stopped = true;
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
    };
    })().catch(error => { cleanup?.(); renderer.dispose(); console.error('Character showroom initialization failed', error); });
    return () => { disposed = true; cleanup?.(); };

  }, []);

  return (
    <section className="character-gallery" aria-label="可完整旋轉的 3D 水豚機車模型">
      <canvas ref={canvasRef} className="showroom-model-canvas" />
      <button className="gallery-close" onClick={close}>關閉 <Icon name="close" size={14} /></button>
      <div className="gallery-kicker">角色檔案 · 360°</div>
      <h2>卡皮隊長<br />與他的愛車。</h2>
      <div className="gallery-note">拖曳旋轉 · 滾輪縮放 · 海灣市最受歡迎的機車計程車司機</div>
    </section>
  );
}

export default function CommercialTaxiGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const active = useRef(false);
  const keyboard = useRef(new Set<string>());
  const state = useRef<GameHud>(START_HUD);
  const [hud, setHud] = useState<GameHud>(START_HUD);
  const [started, setStarted] = useState(false);
  const [showroom, setShowroom] = useState(false);
  const [phone, setPhone] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    setMuted(audioSettings.muted);
    setDebug(new URLSearchParams(window.location.search).has("debug"));
    return audioSettings.subscribe(setMuted);
  }, []);
  const updateRef = useRef((next: Partial<GameHud>) => { state.current = { ...state.current, ...next }; setHud(state.current); });
  const paused = useRef(false);
  useEffect(() => { paused.current = showroom || phone; keyboard.current.clear(); }, [showroom, phone]);
  const actions = useEngine(canvasRef, active, keyboard, updateRef, paused);
  const target = TAICHUNG_LOCATIONS[hud.target];
  const rider = RIDERS[hud.rider];
  const pressControl = useCallback((event: ReactPointerEvent<HTMLButtonElement>, code: string) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); keyboard.current.add(code);
  }, []);
  const releaseControl = useCallback((code: string) => keyboard.current.delete(code), []);

  return (
    <main className={`real-game commercial-game ${hud.metro.visible ? "metro-nearby" : ""} ${started ? "is-driving" : "is-title"}`} data-testid="capy-game" onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest(".real-actions button, .real-phone button, .start-buttons button, .gallery-close, .engine-toggle, .city-map button")) actions.current?.uiClick(); }}>
      <canvas ref={canvasRef} className="commercial-canvas" aria-label="原創台灣風格實體 3D 城市水豚機車計程車駕駛遊戲" />
      <div className="commercial-atmosphere" />
      <header className="real-topbar"><div className="real-brand"><span>CAPY</span> CAB<div>卡皮巴拉機車計程車</div></div><div className="real-topstats">{started && <button className={`engine-toggle engine-${hud.ignition}`} data-testid="ignition-control" aria-pressed={hud.ignition === "running"} aria-label={hud.ignition === "off" ? "發動機車引擎" : hud.ignition === "starting" ? "取消發動引擎" : "熄火機車引擎"} onClick={() => actions.current?.ignition()}><kbd>I</kbd>{hud.ignition === "off" ? "發動引擎" : hud.ignition === "starting" ? "發動中…" : "熄火引擎"}</button>}{started && hud.trafficSignal && <span className={`traffic-signal-pill signal-${hud.trafficSignal}`}><i /> {hud.trafficSignal === "red" ? "紅燈" : hud.trafficSignal === "amber" ? "黃燈" : "綠燈"} {Math.max(0, Math.round(hud.signalDistance))} m</span>}{started && debug && <span className={`fps-pill ${hud.fps < 55 ? "low" : ""}`}>{hud.fps} FPS · {hud.backend}</span>}{started && <span className="live-map-pill"><i /> 營業中</span>}<span>★ {hud.rating.toFixed(1)}</span><span className="wallet-pill">NT$ {hud.wallet}</span></div></header>

      {started && <aside className="real-mission"><div className="real-mission-kicker">{hud.phase === "pickup" ? "新的叫車" : "載客中"}</div><div className="real-rider"><span>{rider.icon}</span><div><strong>{rider.name}</strong><small>{rider.preference}</small></div></div><div className="real-mission-divider" /><div className="real-location-label">{hud.phase === "pickup" ? "上車地點" : "目的地"}</div><div className="real-location">{target.icon} {target.name}</div><div className="real-address">{target.address}</div><div className="real-mission-meta"><span>↗ {Math.round(hud.distance)} m</span>{hud.phase === "dropoff" && <span>{hud.metro.timerPaused ? "轉乘計時暫停" : `${hud.timer}s`}</span>}</div>{hud.phase === "dropoff" && <div className="real-comfort"><i style={{ width: `${hud.comfort}%` }} /></div>}</aside>}

      {started && !phone && <aside className="driver-career" aria-label="司機進度"><span>{driverRank(hud.trips)}</span><strong>{hud.trips} 趟完成</strong><small>{hud.phase === "dropoff" ? `舒適 ${Math.round(hud.comfort)}% · ${hud.metro.timerPaused ? "捷運轉乘計時暫停" : hud.timer > 0 ? "準時送達可賺連單獎金" : "已逾時，安全送達仍有基本車資"}` : "準時送達 + 舒適 85% · 挑戰 S 級連單"}</small><progress max={hud.trips < 3 ? 3 : hud.trips < 10 ? 10 : 20} value={Math.min(hud.trips, 20)} /></aside>}
      {started && hud.metro.visible && <aside className={`metro-ride-panel metro-${hud.metro.mode}`} aria-label="高架捷運搭乘資訊" data-testid="metro-status"><div className="metro-panel-head"><b><Icon name="metro" size={18} /></b><span>海灣高架線<small>{hud.metro.station}</small></span>{hud.metro.mode === 'train' && <strong>{hud.metro.trainSpeed}<small>列車 km/h</small></strong>}</div><p className="metro-state" role="status">{hud.metro.status}</p><div className="metro-destination">{hud.metro.destination}{(hud.metro.mode === 'train' || hud.metro.mode === 'platform') && <span>{hud.metro.seconds > 0 ? `${hud.metro.seconds}s` : '到站'}</span>}</div><p className="metro-instruction">{hud.metro.instruction}</p>{hud.metro.action && <button onClick={() => actions.current?.metro()}>{hud.metro.action}</button>}</aside>}
      {started && hud.message && <div className="real-toast" role="status">{hud.message}</div>}
      {started && hud.canInteract && <div className="real-interact"><b>E</b> {hud.phase === "pickup" ? "乘客上車" : "乘客下車"}</div>}
      {started && <CityNavigationMap hud={hud} expanded={mapExpanded} toggle={() => setMapExpanded((value) => !value)} />}
            {started && <div className="real-camera-hint">W/S 油門倒車　·　A/D 轉向　·　Space 煞車　·　Q/R 方向燈　·　X 雙黃燈　·　E 接送　·　T 捷運升降梯　·　I 發動／熄火</div>}
      <div className={`real-speed ${hud.boost ? "is-boost" : ""}`}><span>{hud.speed}</span><small>{hud.boost ? "加速中" : "km/h"}</small></div>
      {started && <div className={`real-turbo ${hud.boost ? "turbo-active" : ""}`}><span>F 渦輪</span><div><i style={{ width: `${hud.turbo}%` }} /></div></div>}
      {hud.drift > 0.35 && <div className="real-drift"><span>甩尾集氣</span><div><i style={{ width: `${hud.drift / 4 * 100}%` }} /></div></div>}

      <div className="real-actions">{started && <button className="metro-open-button" onClick={() => { if (!hud.metro.visible) setMapExpanded(true); actions.current?.metro(); }} aria-label="捷運路線與升降梯操作"><Icon name="metro" /><span>捷運</span></button>}<button onClick={() => setShowroom(true)} aria-label="查看水豚角色"><Icon name="rider" /><span>角色</span></button><button onClick={() => setPhone((value) => !value)} aria-label="打開手機"><Icon name="phone" /><span>手機</span></button><button className="sound-toggle" onClick={() => audioSettings.setMuted(!muted)} aria-pressed={muted} aria-label={muted ? "開啟聲音" : "關閉聲音"}><Icon name={muted ? "soundOff" : "soundOn"} /><span>{muted ? "靜音" : "聲音"}</span></button></div>

      {!started && <><img className="real-character-poster commercial-poster" src="/generated/capy-front.webp" alt="騎著橄欖綠復古機車的水豚司機" /><section className="real-start commercial-start"><div className="start-city">海灣市 <span>● 機車計程車</span></div><h1><span>自己掌握方向，</span><br /><span>開始載客。</span></h1><p>騎上水豚機車計程車，穿梭店面、百貨、騎樓、河岸與高架橋，把每位乘客準時又舒適地送到目的地。<br />遇到捷運站，還能連人帶車搭升降梯上月台，騎進列車直達下一站。</p><div className="start-status" aria-live="polite"><i className={hud.ready ? "loaded" : ""} />{hud.ready ? "準備完成，出發吧！" : /失敗|中斷/.test(hud.message) ? hud.message : `城市載入中${hud.loadingProgress > 0 ? ` ${hud.loadingProgress}%` : "…"}`}</div><div className="start-buttons"><button data-testid="start-driving" disabled={!hud.ready} onClick={() => { actions.current?.activate(); active.current = true; setStarted(true); }}>發動機車開始載客 →</button><button className="inspect-button" onClick={() => setShowroom(true)}><Icon name="rotate" size={16} /> 360° 欣賞角色</button></div><div className="start-keys">W/S 油門倒車　·　A/D 轉向　·　Space 煞車　·　Shift 甩尾　·　F 加速　·　E 接送　·　T 升降梯　·　I 發動／熄火</div></section></>}

      {phone && <aside className="real-phone"><div className="phone-header"><span>卡皮手機</span><button onClick={() => setPhone(false)} aria-label="關閉手機"><Icon name="close" size={16} /></button></div><div className="phone-profile"><img className="phone-character" src="/generated/capy-front.webp" alt="水豚司機" /><strong>卡皮隊長</strong><span>海灣市機車計程車</span></div><div className="phone-summary"><div><b>{hud.trips}</b><span>趟旅程</span></div><div><b>{hud.rating.toFixed(1)}</b><span>星評價</span></div><div><b>${hud.wallet}</b><span>錢包</span></div></div><div className="phone-grid"><button onClick={() => setShowroom(true)}><Icon name="profile" /><span>角色檔案</span></button><button onClick={() => actions.current?.center()}><Icon name="recenter" /><span>重設視角</span></button><button onClick={() => actions.current?.horn()}><Icon name="horn" /><span>按喇叭</span></button><button onClick={() => actions.current?.interact()}><Icon name="passenger" /><span>接送乘客</span></button></div>{debug && <div className="speed-cheat-control"><span>速度倍率</span><button onClick={() => actions.current?.adjustSpeed(-1)}>−</button><b>×{hud.speedMultiplier}</b><button onClick={() => actions.current?.adjustSpeed(1)}>＋</button><button onClick={() => actions.current?.resetSpeed()}>重設</button></div>}<div className="environment-grid" aria-label="環境模式"><button className={hud.environment === "day" ? "active" : ""} onClick={() => actions.current?.setEnvironment("day")}><Icon name="sun" size={16} /> 白天</button><button className={hud.environment === "dusk" ? "active" : ""} onClick={() => actions.current?.setEnvironment("dusk")}><Icon name="sunset" size={16} /> 黃昏</button><button className={hud.environment === "night" ? "active" : ""} onClick={() => actions.current?.setEnvironment("night")}><Icon name="moon" size={16} /> 夜間</button><button className={hud.environment === "rain" ? "active" : ""} onClick={() => actions.current?.setEnvironment("rain")}><Icon name="rain" size={16} /> 雨天</button></div><div className="phone-foot">中央綠園道 · 晴川百貨 · 南町生活街<br /><a href="/credits.html" target="_blank" rel="noopener noreferrer">製作名單與素材授權</a></div></aside>}

      {showroom && <ModelShowroom close={() => setShowroom(false)} />}

      <div className="map-attribution">原創 3D 城市 · 虛構台灣街景</div>

      {started && <div className="real-touch driver-touch"><div><button onPointerDown={(event) => pressControl(event, "KeyA")} onPointerUp={() => releaseControl("KeyA")} onPointerCancel={() => releaseControl("KeyA")} aria-label="向左轉">←</button><button onPointerDown={(event) => pressControl(event, "KeyD")} onPointerUp={() => releaseControl("KeyD")} onPointerCancel={() => releaseControl("KeyD")} aria-label="向右轉">→</button></div><div><button onPointerDown={(event) => pressControl(event, "Space")} onPointerUp={() => releaseControl("Space")} onPointerCancel={() => releaseControl("Space")} aria-label="煞車">煞</button><button onPointerDown={(event) => pressControl(event, "KeyS")} onPointerUp={() => releaseControl("KeyS")} onPointerCancel={() => releaseControl("KeyS")} aria-label="倒車">退</button><button onPointerDown={(event) => pressControl(event, "KeyW")} onPointerUp={() => releaseControl("KeyW")} onPointerCancel={() => releaseControl("KeyW")} aria-label="油門前進">騎</button><button onPointerDown={(event) => pressControl(event, "KeyF")} onPointerUp={() => releaseControl("KeyF")} onPointerCancel={() => releaseControl("KeyF")} aria-label="渦輪加速">衝</button><button onPointerDown={(event) => pressControl(event, "ShiftLeft")} onPointerUp={() => releaseControl("ShiftLeft")} onPointerCancel={() => releaseControl("ShiftLeft")} aria-label="甩尾">甩</button><button onClick={() => actions.current?.interact()} aria-label="接送乘客">E</button><button onClick={() => actions.current?.metro()} aria-label="捷運升降梯">T</button></div></div>}
    </main>
  );
}
