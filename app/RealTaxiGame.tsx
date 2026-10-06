"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { type CustomLayerInterface, type GeoJSONSource, type Map as LibreMap, type Marker } from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import RAPIER from "@dimforge/rapier3d-compat";

type GeoPoint = { lng: number; lat: number };
type Stop = GeoPoint & { title: string; district: string; icon: string; note: string };
type Rider = { name: string; icon: string; message: string; preference: string; tip: number };
type MissionPhase = "pickup" | "dropoff";
type UpgradeKey = "motor" | "comfort" | "boost";
type SaveState = { wallet: number; trips: number; rating: number; upgrades: Record<UpgradeKey, number> };
type HUDState = SaveState & {
  speed: number;
  stop: Stop;
  rider: Rider;
  phase: MissionPhase;
  distance: number;
  timer: number;
  comfort: number;
  heading: number;
  drift: number;
  boost: boolean;
  ready: boolean;
  modelReady: boolean;
  canInteract: boolean;
  notification: string;
  district: string;
  mapLoaded: boolean;
  zoom: number;
  audio: boolean;
  collisionBuildings: number;
};

const ORIGIN: GeoPoint = { lng: 120.663454, lat: 24.150453 };
const METERS_PER_LAT = 110540;
const METERS_PER_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const MODEL_PATH = "/models/capybara-image-generated.glb";
const SAVE_KEY = "capy-real-world-save-v1";

const STOPS: Stop[] = [
  { lng: 120.6637, lat: 24.15082, title: "草悟道", district: "西區 · 公益路", icon: "🌿", note: "勤美綠園道入口" },
  { lng: 120.66317, lat: 24.15176, title: "勤美誠品綠園道", district: "西區 · 草悟道", icon: "📚", note: "誠品正門接客區" },
  { lng: 120.66612, lat: 24.15013, title: "市民廣場", district: "西區 · 市民廣場", icon: "⛲", note: "英才路廣場入口" },
  { lng: 120.66175, lat: 24.14549, title: "審計新村", district: "西區 · 民生路", icon: "☕", note: "文創市集正門" },
  { lng: 120.66338, lat: 24.14167, title: "國立臺灣美術館", district: "西區 · 五權西路", icon: "🎨", note: "美術館園區北側" },
  { lng: 120.66524, lat: 24.15675, title: "國立自然科學博物館", district: "北區 · 館前路", icon: "🦕", note: "科博館植物園入口" },
  { lng: 120.67079, lat: 24.14644, title: "臺中第二市場", district: "中區 · 三民路", icon: "🍜", note: "第二市場美食街" },
  { lng: 120.65664, lat: 24.15239, title: "公益路美食街", district: "西區 · 公益路", icon: "🍰", note: "公益路商圈" },
  { lng: 120.67868, lat: 24.14477, title: "柳川水岸", district: "中區 · 柳川東路", icon: "🌊", note: "柳川水岸步道" },
  { lng: 120.63983, lat: 24.16318, title: "臺中國家歌劇院", district: "西屯區 · 惠來路", icon: "🎭", note: "歌劇院前廣場" },
];

const RIDERS: Rider[] = [
  { name: "橘子阿嬤", icon: "👵", message: "慢慢騎就好，阿嬤不趕時間。", preference: "喜歡平穩", tip: 42 },
  { name: "趕稿企鵝", icon: "🐧", message: "編輯在等我，拜託快一點！", preference: "偏好速度", tip: 70 },
  { name: "打工兔兔", icon: "🐰", message: "你這頂安全帽好可愛。", preference: "喜歡舒適", tip: 53 },
  { name: "衝浪狐狸", icon: "🦊", message: "欸欸，前面彎道甩一下！", preference: "喜歡甩尾", tip: 68 },
  { name: "旅行熊熊", icon: "🐻", message: "台中街景比照片還漂亮。", preference: "享受風景", tip: 56 },
  { name: "咖啡師小鹿", icon: "🦌", message: "送你一杯拿鐵，謝謝。", preference: "喜歡慢活", tip: 48 },
  { name: "畫家浣熊", icon: "🦝", message: "下次可以載我去美術館嗎？", preference: "平穩抵達", tip: 60 },
];

const DEFAULT_SAVE: SaveState = { wallet: 180, trips: 0, rating: 5, upgrades: { motor: 0, comfort: 0, boost: 0 } };

function createInstantTaichungDistrict(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const longitude = (x: number) => ORIGIN.lng + x / METERS_PER_LNG;
  const latitude = (z: number) => ORIGIN.lat + z / METERS_PER_LAT;
  const point = (x: number, z: number): [number, number] => [longitude(x), latitude(z)];
  const polygon = (left: number, bottom: number, right: number, top: number): GeoJSON.Polygon => ({
    type: "Polygon", coordinates: [[point(left, bottom), point(right, bottom), point(right, top), point(left, top), point(left, bottom)]],
  });
  const seed = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  };

  const avenuesX = [-1270, -1020, -820, -645, -476, -314, -157, 0, 176, 367, 565, 779, 1010, 1290];
  const avenuesZ = [-1230, -1040, -860, -689, -516, -347, -176, 0, 186, 365, 555, 780, 1040, 1280];
  const verticalNames = ["忠明南路", "華美西街", "華美街", "美村路", "向上北路", "中興街", "公益路商圈", "草悟道", "英才路", "館前路", "民權路", "五權路", "三民路", "柳川東路"];
  const horizontalNames = ["五權西路", "美術館路", "民生路", "向上路", "昇平街", "中美街", "公益路", "草悟道街口", "公正路", "模範街", "臺灣大道", "博館路", "健行路", "西屯路"];

  features.push({ type: "Feature", properties: { kind: "park" }, geometry: polygon(34, -990, 115, 1070) });
  features.push({ type: "Feature", properties: { kind: "park" }, geometry: polygon(210, -76, 340, 113) });

  avenuesX.forEach((x, index) => features.push({
    type: "Feature", properties: { kind: "road", name: verticalNames[index], major: index % 3 === 0 },
    geometry: { type: "LineString", coordinates: [point(x, -1580), point(x + (index % 2 === 0 ? 16 : -12), 1580)] },
  }));
  avenuesZ.forEach((z, index) => features.push({
    type: "Feature", properties: { kind: "road", name: horizontalNames[index], major: index % 3 === 1 },
    geometry: { type: "LineString", coordinates: [point(-1580, z), point(1580, z + (index % 2 === 0 ? -12 : 9))] },
  }));

  for (let ix = 0; ix < avenuesX.length - 1; ix++) {
    for (let iz = 0; iz < avenuesZ.length - 1; iz++) {
      const left = avenuesX[ix] + 15;
      const right = avenuesX[ix + 1] - 15;
      const bottom = avenuesZ[iz] + 15;
      const top = avenuesZ[iz + 1] - 15;
      if ((left < 115 && right > 34) || (left < 340 && right > 210 && bottom < 113 && top > -76)) continue;
      const lots = 2 + Math.floor(seed(ix + 9, iz + 5) * 2);
      for (let lot = 0; lot < lots; lot++) {
        const gutter = 4 + seed(ix + lot, iz) * 5;
        const lotLeft = left + (right - left) * lot / lots + gutter;
        const lotRight = left + (right - left) * (lot + 1) / lots - gutter;
        const mid = (top + bottom) / 2;
        for (let row = 0; row < 2; row++) {
          const low = row === 0 ? bottom + gutter : mid + 5;
          const high = row === 0 ? mid - 5 : top - gutter;
          if (lotRight - lotLeft < 9 || high - low < 9) continue;
          const variation = seed(ix * 8 + lot, iz * 3 + row);
          features.push({
            type: "Feature", properties: { kind: "building", height: 10 + Math.round(variation * variation * 59), shade: variation },
            geometry: polygon(lotLeft, low, lotRight, high),
          });
        }
      }
    }
  }

  for (let z = -960; z <= 1050; z += 41) {
    for (const x of [48, 99]) {
      features.push({ type: "Feature", properties: { kind: "tree", size: 5 + seed(x, z) * 3 }, geometry: { type: "Point", coordinates: point(x + seed(z, x) * 7, z) } });
    }
  }
  return { type: "FeatureCollection", features };
}

const STARTER_CITY = createInstantTaichungDistrict();

const INSTANT_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "starter-city": { type: "geojson", data: STARTER_CITY, attribution: "臺中地標與街區坐標 · 線上地圖 © OpenStreetMap contributors" },
  },
  layers: [
    { id: "city-ground", type: "background", paint: { "background-color": "#d9d7cb" } },
    { id: "city-parks", type: "fill", source: "starter-city", filter: ["==", ["get", "kind"], "park"], paint: { "fill-color": "#789570", "fill-opacity": 0.96 } },
    { id: "city-road-edge", type: "line", source: "starter-city", filter: ["==", ["get", "kind"], "road"], paint: { "line-color": "#7c807a", "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 2, 20, ["case", ["get", "major"], 97, 76]] } },
    { id: "city-roads", type: "line", source: "starter-city", filter: ["==", ["get", "kind"], "road"], paint: { "line-color": "#606865", "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 1.5, 20, ["case", ["get", "major"], 81, 61]] } },
    { id: "city-road-markings", type: "line", source: "starter-city", filter: ["all", ["==", ["get", "kind"], "road"], ["==", ["get", "major"], true]], paint: { "line-color": "#e6dca7", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.25, 20, 1.8], "line-dasharray": [2, 3], "line-opacity": 0.76 } },
    { id: "starter-3d-buildings", type: "fill-extrusion", source: "starter-city", filter: ["==", ["get", "kind"], "building"], paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["get", "shade"], 0, "#f1e8db", 0.45, "#ddcfbf", 0.75, "#bdc5bd", 1, "#a6b7b7"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.97, "fill-extrusion-vertical-gradient": true } },
    { id: "city-trees", type: "circle", source: "starter-city", filter: ["==", ["get", "kind"], "tree"], paint: { "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 15, 1, 20, 17], "circle-color": "#546f51", "circle-stroke-color": "#738a66", "circle-stroke-width": 1.2, "circle-opacity": 0.92 } },
  ],
};

function toLocal(point: GeoPoint) {
  return { x: (point.lng - ORIGIN.lng) * METERS_PER_LNG, z: (point.lat - ORIGIN.lat) * METERS_PER_LAT };
}

function toGeo(x: number, z: number): GeoPoint {
  return { lng: ORIGIN.lng + x / METERS_PER_LNG, lat: ORIGIN.lat + z / METERS_PER_LAT };
}

function meters(a: GeoPoint, b: GeoPoint) {
  return Math.hypot((a.lng - b.lng) * METERS_PER_LNG, (a.lat - b.lat) * METERS_PER_LAT);
}

function niceDistance(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

function audioEngine() {
  let context: AudioContext | undefined;
  let oscillator: OscillatorNode | undefined;
  let volume: GainNode | undefined;
  let muted = false;
  const init = () => {
    if (context) return;
    context = new AudioContext();
    volume = context.createGain();
    volume.gain.value = 0.014;
    volume.connect(context.destination);
    oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 64;
    oscillator.connect(volume);
    oscillator.start();
  };
  const note = (frequency: number, seconds = 0.15, amplitude = 0.06, type: OscillatorType = "sine") => {
    if (!context || muted) return;
    const synth = context.createOscillator();
    const envelope = context.createGain();
    synth.type = type;
    synth.frequency.value = frequency;
    envelope.gain.setValueAtTime(amplitude, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + seconds);
    synth.connect(envelope);
    envelope.connect(context.destination);
    synth.start();
    synth.stop(context.currentTime + seconds);
  };
  return {
    init,
    motor(speed: number) {
      if (!context || !oscillator || !volume) return;
      oscillator.frequency.setTargetAtTime(66 + speed * 3.7, context.currentTime, 0.08);
      volume.gain.setTargetAtTime(muted ? 0 : 0.012 + Math.min(speed * 0.0011, 0.038), context.currentTime, 0.08);
    },
    bell() { note(690, 0.17, 0.06); setTimeout(() => note(930, 0.2, 0.06), 85); },
    complete() { [523, 659, 784, 1046].forEach((tone, index) => setTimeout(() => note(tone, 0.2, 0.07), index * 88)); },
    horn() { note(330, 0.2, 0.08, "square"); setTimeout(() => note(440, 0.13, 0.07, "square"), 105); },
    toggle() { muted = !muted; return !muted; },
    destroy() { oscillator?.stop(); context?.close(); },
  };
}

function ModelShowroom({ close }: { close: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.31;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20231f);
    scene.fog = new THREE.Fog(0x20231f, 10, 28);
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 80);
    camera.position.set(6.5, 4.5, 8.5);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 3.4;
    controls.maxDistance = 14;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.85;
    controls.target.set(0, 1.9, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    scene.add(new THREE.HemisphereLight(0xfff0d4, 0x28271f, 2.6));
    const keyLight = new THREE.DirectionalLight(0xffdfbc, 3.5);
    keyLight.position.set(5, 8, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight(0xacc7dc, 2.2);
    rim.position.set(-5, 5, -4);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 80),
      new THREE.MeshStandardMaterial({ color: 0x383b32, roughness: 0.82, metalness: 0.13 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const plinth = new THREE.Mesh(
      new THREE.TorusGeometry(3.15, 0.026, 9, 100),
      new THREE.MeshBasicMaterial({ color: 0xb2a77a, transparent: true, opacity: 0.62 }),
    );
    plinth.rotation.x = Math.PI / 2;
    plinth.position.y = 0.015;
    scene.add(plinth);

    new GLTFLoader().load(MODEL_PATH, (asset) => {
      asset.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      scene.add(asset.scene);
      setProgress(100);
    }, (event) => {
      if (event.total > 0) setProgress(Math.round(event.loaded / event.total * 100));
    });

    let animation = 0;
    const draw = () => { animation = requestAnimationFrame(draw); controls.update(); renderer.render(scene, camera); };
    draw();
    const resize = () => {
      if (!canvas) return;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    };
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(animation); window.removeEventListener("resize", resize); controls.dispose(); environment.dispose(); pmrem.dispose(); renderer.dispose(); };
  }, []);

  return (
    <section className="real-showroom" aria-label="水豚角色 360 度模型展示">
      <canvas ref={canvasRef} className="showroom-canvas" />
      <div className="showroom-top"><span>CHARACTER MODEL / 01</span><button onClick={close}>關閉 ×</button></div>
      <div className="showroom-copy"><span>REFERENCE-GENERATED 3D CHARACTER</span><h2>卡皮巴拉<br />復古小綠</h2><p>直接參照你提供的角色圖生成。<br />按住滑鼠拖曳環視，滾輪放大細節。</p><div>100,924 GENERATED TRIANGLES · REFERENCE-MATCHED TEXTURE</div></div>
      <div className="showroom-views" aria-label="生成角色的不同角度"><img src="/generated/capy-front.webp" alt="依照原圖生成的正面水豚機車" /><img src="/generated/capy-side.webp" alt="依照原圖生成的側面水豚機車" /><img src="/generated/capy-rear.webp" alt="依照原圖生成的後側水豚機車" /></div>
      {progress < 100 && <div className="showroom-loading">正在載入正式 3D 模型 {progress}%</div>}
      <div className="showroom-hint">拖曳旋轉 360°　·　滾輪縮放　·　滑鼠右鍵平移</div>
    </section>
  );
}

export default function RealTaxiGame() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const keysRef = useRef(new Set<string>());
  const startedRef = useRef(false);
  const saveRef = useRef<SaveState>({ ...DEFAULT_SAVE, upgrades: { ...DEFAULT_SAVE.upgrades } });
  const commandsRef = useRef<{ interact: () => void; horn: () => void; toggleAudio: () => boolean; flyHome: () => void; initAudio: () => void } | null>(null);
  const [started, setStarted] = useState(false);
  const [phone, setPhone] = useState(false);
  const [garage, setGarage] = useState(false);
  const [showroom, setShowroom] = useState(false);
  const [hud, setHud] = useState<HUDState>({
    ...DEFAULT_SAVE, speed: 0, stop: STOPS[0], rider: RIDERS[0], phase: "pickup", distance: 47,
    timer: 120, comfort: 100, heading: 0, drift: 0, boost: false, ready: false, modelReady: false,
    canInteract: false, notification: "", district: "臺中市西區 · 草悟道", mapLoaded: false, zoom: 19.2, audio: true, collisionBuildings: 0,
  });

  useEffect(() => {
    const container = mapElementRef.current;
    if (!container) return;
    let alive = true;
    let animation = 0;
    let last = performance.now();
    let mapReady = false;
    let modelReady = false;
    let speed = 0;
    let heading = 0;
    let steeringAngle = 0;
    let steeringVelocity = 0;
    let throttleResponse = 0;
    let chassisRoll = 0;
    let suspensionOffset = 0;
    let suspensionVelocity = 0;
    let cameraBearing = 0;
    let cameraPitch = 67;
    let cameraZoom = 19.2;
    let drift = 0;
    let boostUntil = 0;
    let pressedDrift = false;
    let orbit = -22;
    let pitch = 67;
    let zoom = 19.2;
    let orbitReleaseAt = 0;
    let frame = 0;
    let riderMarker: Marker | null = null;
    let physics: { world: RAPIER.World; body: RAPIER.RigidBody } | null = null;
    let threeScene: THREE.Scene | null = null;
    let threeRenderer: THREE.WebGLRenderer | null = null;
    let modelRoot: THREE.Group | null = null;
    let mapCenter: GeoPoint = { ...ORIGIN };
    let routeAbort: AbortController | null = null;
    let collisionCooldownUntil = 0;
    let onlineMapReady = false;
    const buildingColliders = new Map<string, { collider: RAPIER.Collider; x: number; z: number }>();

    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveState>;
        saveRef.current = { ...DEFAULT_SAVE, ...parsed, upgrades: { ...DEFAULT_SAVE.upgrades, ...(parsed.upgrades ?? {}) } };
      }
    } catch { /* device-only progress is optional */ }

    const mission = {
      phase: "pickup" as MissionPhase,
      rider: RIDERS[saveRef.current.trips % RIDERS.length],
      pickup: STOPS[0],
      target: STOPS[0],
      destination: STOPS[3],
      timer: 135,
      comfort: 100,
      notification: "真實臺中道路已就緒，前往草悟道接客",
      notificationUntil: 6,
      audio: true,
    };

    const sounds = audioEngine();
    const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveRef.current)); } catch { /* device storage unavailable */ } };

    const map = new maplibregl.Map({
      container,
      style: INSTANT_MAP_STYLE,
      center: [ORIGIN.lng, ORIGIN.lat],
      zoom,
      pitch,
      bearing: orbit,
      maxPitch: 84,
      minZoom: 15,
      maxZoom: 21,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      fadeDuration: 0,
      touchPitch: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.dragPan.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();

    const syncBuildingCollisions = () => {
      if (!physics || !mapReady) return;
      const source = onlineMapReady && map.getSource("real-city-buildings") ? "real-city-buildings" : "starter-city";
      if (!map.getSource(source)) return;
      const location = physics.body.translation();
      for (const [key, entry] of buildingColliders) {
        if (Math.hypot(entry.x - location.x, entry.z - location.z) > 460) {
          physics.world.removeCollider(entry.collider, true);
          buildingColliders.delete(key);
        }
      }

      let added = 0;
      const features = source === "starter-city"
        ? map.querySourceFeatures(source, { filter: ["==", ["get", "kind"], "building"] })
        : map.querySourceFeatures(source, { sourceLayer: "building" });
      for (const feature of features) {
        if (added >= 18 || buildingColliders.size >= 190) break;
        const geometry = feature.geometry;
        if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

        for (const polygon of polygons) {
          if (added >= 18 || buildingColliders.size >= 190) break;
          const outline = polygon[0];
          if (!outline || outline.length < 4 || outline.length > 110) continue;
          const footprint = outline.slice(0, -1).map(([lng, lat]) => toLocal({ lng, lat }));
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const point of footprint) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minZ = Math.min(minZ, point.z);
            maxZ = Math.max(maxZ, point.z);
          }

          const centerX = (minX + maxX) / 2;
          const centerZ = (minZ + maxZ) / 2;
          const width = maxX - minX;
          const depth = maxZ - minZ;
          if (width < 2.3 || depth < 2.3 || width > 105 || depth > 105) continue;
          if (Math.hypot(centerX - location.x, centerZ - location.z) > 360) continue;
          if (location.x > minX - 1.5 && location.x < maxX + 1.5 && location.z > minZ - 1.5 && location.z < maxZ + 1.5) continue;

          const key = `${Math.round(centerX * 2)}:${Math.round(centerZ * 2)}:${Math.round(width)}:${Math.round(depth)}`;
          if (buildingColliders.has(key)) continue;
          const points = new Float32Array(footprint.length * 6);
          footprint.forEach((point, index) => {
            const deltaX = point.x - centerX;
            const deltaZ = point.z - centerZ;
            const length = Math.hypot(deltaX, deltaZ);
            const inset = length > 0.7 ? Math.max(0, length - 0.5) / length : 0.7;
            const x = deltaX * inset;
            const z = deltaZ * inset;
            points.set([x, -3, z, x, 3, z], index * 6);
          });
          const hull = RAPIER.ColliderDesc.convexHull(points);
          if (!hull) continue;
          hull.setTranslation(centerX, 0, centerZ).setFriction(0.34).setRestitution(0.08);
          const collider = physics.world.createCollider(hull);
          buildingColliders.set(key, { collider, x: centerX, z: centerZ });
          added++;
        }
      }
    };

    const markerElement = document.createElement("div");
    markerElement.className = "real-passenger-marker";
    markerElement.innerHTML = `<div class="passenger-marker-icon">${mission.rider.icon}</div><div class="passenger-marker-pulse"></div>`;
    riderMarker = new maplibregl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([mission.target.lng, mission.target.lat])
      .addTo(map);

    const requestRoute = async (from: GeoPoint, to: GeoPoint) => {
      const source = map.getSource("ride-route") as GeoJSONSource | undefined;
      if (!source) return;
      const fallback: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[from.lng, from.lat], [from.lng, to.lat], [to.lng, to.lat]] },
      };
      source.setData(fallback);
      routeAbort?.abort();
      routeAbort = new AbortController();
      const timeout = window.setTimeout(() => routeAbort?.abort(), 2200);
      try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: routeAbort.signal });
        if (!response.ok) return;
        const route = await response.json() as { routes?: Array<{ geometry: GeoJSON.LineString }> };
        if (route.routes?.[0] && alive) source.setData({ type: "Feature", properties: {}, geometry: route.routes[0].geometry });
      } catch { /* the local street-grid route remains a usable fallback */ }
      finally { window.clearTimeout(timeout); }
    };

    const customLayer: CustomLayerInterface = {
      id: "capybara-reference-model",
      type: "custom",
      renderingMode: "3d",
      onAdd(loadedMap, context) {
        threeScene = new THREE.Scene();
        const camera = new THREE.Camera();
        camera.name = "map-camera";
        threeScene.add(camera);
        const hemi = new THREE.HemisphereLight(0xfff0d9, 0x38443a, 3.4);
        threeScene.add(hemi);
        const sunlight = new THREE.DirectionalLight(0xffe7c3, 3.5);
        sunlight.position.set(-70, -90, 120).normalize();
        threeScene.add(sunlight);
        const rim = new THREE.DirectionalLight(0xa8ccf3, 1.8);
        rim.position.set(50, 40, 80).normalize();
        threeScene.add(rim);

        threeRenderer = new THREE.WebGLRenderer({ canvas: loadedMap.getCanvas(), context, antialias: true });
        threeRenderer.autoClear = false;
        threeRenderer.outputColorSpace = THREE.SRGBColorSpace;
        threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        threeRenderer.toneMappingExposure = 1.28;

        new GLTFLoader().load(MODEL_PATH, (asset) => {
          if (!alive || !threeScene) return;
          modelRoot = asset.scene;
          modelRoot.scale.setScalar(1.72);
          modelRoot.traverse((item) => {
            if (item instanceof THREE.Mesh) { item.frustumCulled = false; item.castShadow = true; }
          });
          threeScene.add(modelRoot);
          modelReady = true;
          mission.notification = "依照你的角色圖生成的 3D 水豚與機車已載入";
          mission.notificationUntil = 5;
        }, undefined, () => {
          mission.notification = "角色高畫質細節背景載入中，仍可正常騎車";
          mission.notificationUntil = 6;
        });
      },
      render(_gl, args) {
        if (!threeScene || !threeRenderer) return;
        const camera = threeScene.getObjectByName("map-camera") as THREE.Camera;
        const projection = (args as unknown as { defaultProjectionData?: { mainMatrix: number[] } }).defaultProjectionData?.mainMatrix;
        if (!projection) return;
        const coordinate = maplibregl.MercatorCoordinate.fromLngLat([mapCenter.lng, mapCenter.lat], 0);
        const scale = coordinate.meterInMercatorCoordinateUnits();
        const move = new THREE.Matrix4()
          .makeTranslation(coordinate.x, coordinate.y, coordinate.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        camera.projectionMatrix = new THREE.Matrix4().fromArray(projection).multiply(move);
        if (modelRoot) {
          modelRoot.rotation.y = heading;
          modelRoot.rotation.z = chassisRoll;
          modelRoot.rotation.x = suspensionOffset * 0.12 - throttleResponse * 0.022;
          modelRoot.position.y = Math.max(-0.08, suspensionOffset * 0.22);
        }
        threeRenderer.resetState();
        threeRenderer.render(threeScene, camera);
        map.triggerRepaint();
      },
    };

    map.on("load", async () => {
      if (!alive) return;
      mapReady = true;
      map.addSource("ride-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "ride-route-shadow", type: "line", source: "ride-route", paint: { "line-color": "rgba(46, 64, 57, 0.35)", "line-width": 8, "line-blur": 2 } });
      map.addLayer({ id: "ride-route-line", type: "line", source: "ride-route", paint: { "line-color": "#f6b965", "line-width": 4.2, "line-opacity": 0.94 } });
      map.addLayer(customLayer);
      void requestRoute(ORIGIN, mission.target);

      // The district is rendered from the bundled snapshot immediately. Live
      // OSM buildings are an optional background enhancement, never a gate.
      window.setTimeout(() => {
        if (!alive || map.getSource("real-city-buildings")) return;
        try {
          map.addSource("real-city-buildings", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
          map.addLayer({
            id: "real-3d-buildings", source: "real-city-buildings", "source-layer": "building", type: "fill-extrusion",
            minzoom: 14.5, filter: ["!=", ["get", "hide_3d"], true],
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#e7ded0", 22, "#ddd4c5", 60, "#bfccd1", 150, "#9fb7c6"],
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.93, "fill-extrusion-vertical-gradient": true,
            },
          }, "ride-route-shadow");
          map.on("sourcedata", (event) => {
            if (onlineMapReady || event.sourceId !== "real-city-buildings" || !event.isSourceLoaded) return;
            const realBuildings = map.querySourceFeatures("real-city-buildings", { sourceLayer: "building" });
            if (realBuildings.length < 4) return;
            onlineMapReady = true;
            map.setLayoutProperty("starter-3d-buildings", "visibility", "none");
            mission.notification = "真實 OpenStreetMap 建築已在背景載入";
            mission.notificationUntil = 3;
          });
        } catch { /* bundled district remains complete without network access */ }
      }, 1400);

      try {
        await RAPIER.init();
        if (!alive) return;
        const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
        const description = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setLinearDamping(3).lockRotations();
        const body = world.createRigidBody(description);
        world.createCollider(RAPIER.ColliderDesc.ball(1.22).setRestitution(0.12), body);
        physics = { world, body };
        syncBuildingCollisions();
      } catch {
        mission.notification = "物理引擎初始化中，地圖仍可正常瀏覽";
        mission.notificationUntil = 4;
      }
    });

    map.on("error", () => {
      if (!mapReady) {
        mission.notification = "正在連線真實地圖資料，請確認網路可存取地圖服務";
        mission.notificationUntil = 5;
      }
    });

    const resetRide = (finished: boolean) => {
      if (finished) saveRef.current.trips += 1;
      const next = (saveRef.current.trips * 3 + 1) % STOPS.length;
      const destination = (next + 2 + (saveRef.current.trips % 4)) % STOPS.length;
      mission.phase = "pickup";
      mission.rider = RIDERS[saveRef.current.trips % RIDERS.length];
      mission.pickup = STOPS[next];
      mission.target = STOPS[next];
      mission.destination = STOPS[destination];
      mission.comfort = 100;
      mission.timer = 95 + Math.min(meters(mission.target, mission.destination) / 7, 190);
      markerElement.classList.remove("destination-marker");
      markerElement.innerHTML = `<div class="passenger-marker-icon">${mission.rider.icon}</div><div class="passenger-marker-pulse"></div>`;
      riderMarker?.setLngLat([mission.target.lng, mission.target.lat]);
      void requestRoute(mapCenter, mission.target);
      persist();
    };

    const interact = () => {
      if (!startedRef.current) return;
      const distance = meters(mapCenter, mission.target);
      if (distance > 18) {
        mission.notification = `距離${mission.phase === "pickup" ? "乘客" : "目的地"}還有 ${niceDistance(distance)}，靠近後按 E`;
        mission.notificationUntil = 2.5;
        return;
      }
      if (Math.abs(speed) > 7) {
        mission.notification = "先停穩車子，乘客才敢上下車";
        mission.notificationUntil = 2.4;
        return;
      }
      if (mission.phase === "pickup") {
        mission.phase = "dropoff";
        mission.target = mission.destination;
        markerElement.classList.add("destination-marker");
        markerElement.innerHTML = `<div class="passenger-marker-icon">${mission.destination.icon}</div><div class="passenger-marker-pulse"></div>`;
        riderMarker?.setLngLat([mission.target.lng, mission.target.lat]);
        mission.notification = `${mission.rider.icon} ${mission.rider.name}：${mission.rider.message}`;
        mission.notificationUntil = 5;
        sounds.bell();
        void requestRoute(mapCenter, mission.target);
      } else {
        const base = 75 + Math.round(meters(mission.pickup, mission.destination) * 0.15);
        const tip = Math.round(mission.rider.tip * mission.comfort / 100 + saveRef.current.upgrades.comfort * 12);
        const bonus = Math.max(0, Math.round(mission.timer * 0.42));
        saveRef.current.wallet += base + tip + bonus;
        saveRef.current.rating = Math.round((saveRef.current.rating * 0.78 + (mission.comfort > 68 ? 5 : 4) * 0.22) * 10) / 10;
        mission.notification = `送達 ${mission.destination.title} · 車資 $${base} ＋ 小費 $${tip} ＋ 獎勵 $${bonus}`;
        mission.notificationUntil = 7;
        sounds.complete();
        resetRide(true);
      }
    };

    commandsRef.current = {
      interact,
      horn: () => sounds.horn(),
      toggleAudio: () => { mission.audio = sounds.toggle(); return mission.audio; },
      flyHome: () => {
        physics?.body.setTranslation({ x: 0, y: 0, z: 0 }, true);
        physics?.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        mapCenter = { ...ORIGIN };
        speed = 0;
      },
      initAudio: () => sounds.init(),
    };

    let pointer: { id: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      container.setPointerCapture(event.pointerId);
      container.classList.add("orbiting");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      orbit += (event.clientX - pointer.x) * 0.31;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - pointer.y) * 0.16, 38, 82);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      orbitReleaseAt = performance.now() + 3800;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return;
      pointer = null;
      container.classList.remove("orbiting");
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom - event.deltaY * 0.002, 16.4, 20.9);
      orbitReleaseAt = performance.now() + 4000;
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      if (!event.repeat && event.code === "KeyE") interact();
      if (!event.repeat && event.code === "KeyH") sounds.horn();
      if (!event.repeat && event.code === "KeyM") setPhone((value) => !value);
      if (!event.repeat && event.code === "KeyV") setShowroom((value) => !value);
      if (!event.repeat && event.code === "KeyC") { orbit = 0; pitch = 68; zoom = 19.2; }
      keysRef.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const tick = (now: number) => {
      animation = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;
      frame++;
      if (startedRef.current) {
        const throttle = keysRef.current.has("KeyW") || keysRef.current.has("ArrowUp");
        const reverse = keysRef.current.has("KeyS") || keysRef.current.has("ArrowDown");
        const left = keysRef.current.has("KeyA") || keysRef.current.has("ArrowLeft");
        const right = keysRef.current.has("KeyD") || keysRef.current.has("ArrowRight");
        const braking = keysRef.current.has("Space");
        const drifting = keysRef.current.has("ShiftLeft") || keysRef.current.has("ShiftRight");
        const boostActive = now < boostUntil;
        const maxSpeed = 18 + saveRef.current.upgrades.motor * 3.2 + (boostActive ? 11 : 0);
        const throttleTarget = throttle ? 1 : reverse ? -0.76 : 0;
        throttleResponse = THREE.MathUtils.damp(throttleResponse, throttleTarget, throttle || reverse ? 7.4 : 5.1, dt);
        const torque = throttleResponse * (19 + saveRef.current.upgrades.motor * 2.3);
        const aerodynamicDrag = Math.sign(speed) * speed * speed * 0.023;
        speed += (torque - aerodynamicDrag + (boostActive ? 12 : 0)) * dt;
        speed *= Math.exp(-(braking ? 5.1 : Math.abs(throttleResponse) > 0.12 ? 0.2 : 1.2) * dt);
        speed = THREE.MathUtils.clamp(speed, -7, maxSpeed);
        const steering = (left ? 1 : 0) - (right ? 1 : 0);
        const priorSteering = steeringAngle;
        steeringAngle = THREE.MathUtils.damp(steeringAngle, steering, drifting ? 6.1 : 9.4, dt);
        steeringVelocity = (steeringAngle - priorSteering) / Math.max(dt, 0.001);
        const grip = drifting ? 0.76 : 1;
        heading += steeringAngle * Math.min(Math.abs(speed) / 5, 1) * (drifting ? 1.82 : 1.29) * grip * dt * Math.sign(speed || 1);
        const desiredRoll = -steeringAngle * Math.min(Math.abs(speed) * 0.018, drifting ? 0.38 : 0.27);
        chassisRoll = THREE.MathUtils.damp(chassisRoll, desiredRoll, 7.2, dt);

        if (drifting && steering && Math.abs(speed) > 7) {
          drift = Math.min(4.5, drift + dt);
          if (mission.phase === "dropoff" && mission.rider.preference !== "喜歡甩尾") mission.comfort = Math.max(15, mission.comfort - dt * 2.1);
        }
        if (pressedDrift && !drifting && drift > 0.8) {
          boostUntil = now + 450 + drift * 290 + saveRef.current.upgrades.boost * 180;
          mission.notification = drift > 2.7 ? "漂亮！超級甩尾渦輪啟動" : "甩尾加速";
          mission.notificationUntil = 2;
          drift = 0;
          sounds.bell();
        }
        if (!drifting) drift = Math.max(0, drift - dt * 1.8);
        pressedDrift = drifting;
        const movementHeading = heading + (drifting ? steeringAngle * 0.19 : 0);
        if (physics) {
          const before = physics.body.translation();
          const beforeX = before.x;
          const beforeZ = before.z;
          physics.body.setLinvel({ x: Math.sin(movementHeading) * speed, y: 0, z: Math.cos(movementHeading) * speed }, true);
          physics.world.timestep = Math.min(dt, 1 / 30);
          physics.world.step();
          const location = physics.body.translation();
          const expectedTravel = Math.abs(speed) * physics.world.timestep;
          const actualTravel = Math.hypot(location.x - beforeX, location.z - beforeZ);
          if (expectedTravel > 0.08 && actualTravel < expectedTravel * 0.31 && now > collisionCooldownUntil) {
            collisionCooldownUntil = now + 1300;
            if (mission.phase === "dropoff") mission.comfort = Math.max(12, mission.comfort - Math.min(12, 2.5 + Math.abs(speed) * 0.36));
            speed *= -0.11;
            suspensionVelocity -= 1.8;
            mission.notification = "碰到街區建築，注意道路與乘客舒適度";
            mission.notificationUntil = 2.6;
          }
          mapCenter = toGeo(location.x, location.z);
        } else {
          const current = toLocal(mapCenter);
          mapCenter = toGeo(current.x + Math.sin(movementHeading) * speed * dt, current.z + Math.cos(movementHeading) * speed * dt);
        }
        const location = toLocal(mapCenter);
        const roadRipple = (Math.sin(location.x * 0.17 + location.z * 0.13) * 0.012 + Math.sin(location.z * 0.041) * 0.016) * Math.min(Math.abs(speed) / 11, 1);
        const suspensionTarget = roadRipple - Math.abs(steeringVelocity) * 0.002 + (braking ? -Math.min(Math.abs(speed), 12) * 0.005 : 0);
        suspensionVelocity += ((suspensionTarget - suspensionOffset) * 75 - suspensionVelocity * 13) * dt;
        suspensionOffset += suspensionVelocity * dt;
        sounds.motor(Math.abs(speed));

        if (mission.phase === "dropoff") {
          mission.timer -= dt;
          if (mission.timer <= 0) {
            saveRef.current.rating = Math.max(3.2, Math.round((saveRef.current.rating - 0.25) * 10) / 10);
            mission.notification = "乘客等太久了，下一趟再加油！";
            mission.notificationUntil = 5;
            resetRide(false);
          }
        }
      }

      if (!pointer && startedRef.current && performance.now() > orbitReleaseAt && Math.abs(speed) > 2) orbit = THREE.MathUtils.damp(orbit, 0, 1.45, dt);
      if (mapReady && !map.isMoving()) {
        const targetBearing = heading * 180 / Math.PI + orbit - steeringAngle * Math.min(Math.abs(speed), 18) * 0.32;
        const bearingDelta = ((targetBearing - cameraBearing + 540) % 360) - 180;
        cameraBearing += bearingDelta * (1 - Math.exp(-(pointer ? 14 : 4.3) * dt));
        cameraPitch = THREE.MathUtils.damp(cameraPitch, pitch - Math.min(Math.abs(speed) * 0.13, 3.3), 4.4, dt);
        cameraZoom = THREE.MathUtils.damp(cameraZoom, zoom - Math.min(Math.abs(speed) * 0.008, 0.2) - (now < boostUntil ? 0.09 : 0), 4.1, dt);
        const lookahead = Math.min(Math.abs(speed) * 0.2, 3.5);
        const focus = toGeo(toLocal(mapCenter).x + Math.sin(heading) * lookahead, toLocal(mapCenter).z + Math.cos(heading) * lookahead);
        map.jumpTo({ center: [focus.lng, focus.lat], bearing: cameraBearing, pitch: cameraPitch, zoom: cameraZoom });
      }
      if (mapReady && physics && frame % 75 === 0) syncBuildingCollisions();

      if (frame % 7 === 0) {
        const distance = meters(mapCenter, mission.target);
        mission.notificationUntil = Math.max(0, mission.notificationUntil - dt * 7);
        setHud({
          ...saveRef.current, upgrades: { ...saveRef.current.upgrades }, speed: Math.round(Math.abs(speed) * 5.2), stop: mission.target,
          rider: mission.rider, phase: mission.phase, distance, timer: Math.max(0, Math.ceil(mission.timer)), comfort: Math.round(mission.comfort),
          heading, drift, boost: now < boostUntil, ready: true, modelReady, canInteract: distance < 18 && Math.abs(speed) < 7,
          notification: mission.notificationUntil > 0 ? mission.notification : "", district: mission.target.district,
          mapLoaded: mapReady, zoom, audio: mission.audio, collisionBuildings: buildingColliders.size,
        });
        if (startedRef.current && frame % 420 === 0) void requestRoute(mapCenter, mission.target);
      }
    };
    animation = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(animation);
      routeAbort?.abort();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      riderMarker?.remove();
      commandsRef.current = null;
      map.remove();
      threeRenderer?.dispose();
      physics?.world.free();
      sounds.destroy();
    };
  }, []);

  const start = () => { startedRef.current = true; setStarted(true); commandsRef.current?.initAudio(); };
  const hold = (key: string, active: boolean) => { if (active) keysRef.current.add(key); else keysRef.current.delete(key); };
  const buy = (key: UpgradeKey) => {
    const current = saveRef.current.upgrades[key];
    const cost = (key === "motor" ? 220 : key === "comfort" ? 190 : 250) * (current + 1);
    if (current >= 3 || saveRef.current.wallet < cost) return;
    saveRef.current.wallet -= cost;
    saveRef.current.upgrades[key] += 1;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveRef.current)); } catch { /* local storage optional */ }
    setHud((before) => ({ ...before, ...saveRef.current, upgrades: { ...saveRef.current.upgrades } }));
  };
  const isLoaded = hud.mapLoaded;

  return (
    <main className="real-game">
      <div className="real-map" ref={mapElementRef} aria-label="真實臺中 OpenStreetMap 3D 城市" />
      <div className="real-cinematic" />
      <header className="real-topbar"><div className="real-brand"><span>CAPY</span> CAB<div>TAICHUNG / REAL STREETS</div></div><div className="real-topstats"><span className="live-map-pill"><i /> LIVE CITY</span><span>★ {hud.rating.toFixed(1)}</span><span className="wallet-pill">NT$ {hud.wallet}</span></div></header>

      {started && <aside className="real-mission"><div className="real-mission-kicker">{hud.phase === "pickup" ? "INCOMING REQUEST" : "PASSENGER ON BOARD"}</div><div className="real-rider"><span>{hud.rider.icon}</span><div><strong>{hud.rider.name}</strong><small>{hud.rider.preference}</small></div></div><div className="real-mission-divider"/><div className="real-location-label">{hud.phase === "pickup" ? "PICK UP AT" : "DESTINATION"}</div><div className="real-location">{hud.stop.icon} {hud.stop.title}</div><div className="real-address">{hud.stop.note}</div><div className="real-mission-meta"><span>↗ {niceDistance(hud.distance)}</span>{hud.phase === "dropoff" && <span className={hud.timer < 24 ? "urgent" : ""}>⏱ {hud.timer}s</span>}</div>{hud.phase === "dropoff" && <div className="real-comfort"><i style={{ width: `${hud.comfort}%` }}/></div>}</aside>}

      {hud.notification && started && <div className="real-toast">{hud.notification}</div>}
      {hud.canInteract && started && <div className="real-interact"><b>E</b> {hud.phase === "pickup" ? "乘客上車" : "乘客下車"}</div>}
      <div className="real-district"><span>24°09′ N / 120°39′ E</span><strong>{hud.district}</strong></div>
      <div className="real-camera-hint">↺ 按住滑鼠拖曳環視　⊕ 滾輪縮放　C 重設視角　V 角色展示</div>
      <div className={`real-speed ${hud.boost ? "is-boost" : ""}`}><span>{hud.speed}</span><small>{hud.boost ? "TURBO" : "KM/H"}</small></div>
      {hud.drift > 0.4 && <div className="real-drift"><span>DRIFT CHARGE</span><div><i style={{ width: `${hud.drift / 4.5 * 100}%` }}/></div></div>}

      <div className="real-actions"><button onClick={() => setShowroom(true)} title="360 度查看完整角色模型">◉<span>角色模型</span></button><button onClick={() => setPhone((value) => !value)} title="手機與車庫">▦<span>手機</span></button></div>

      {!started && <img className="real-character-poster" src="/generated/capy-front.webp" alt="依照原始設計圖生成的卡皮巴拉復古機車角色" />}
      {!started && <section className="real-start"><div className="start-city">TAICHUNG CITY, TAIWAN <span>● INSTANT PLAY</span></div><h1>你的水豚，<br/>真的來了。</h1><p>依照你提供的角色圖重新生成。<br/>台中街區即刻啟動，線上地圖在背景載入。</p><div className="start-status"><i className={isLoaded ? "loaded" : ""}/>{isLoaded ? `已可立即遊玩 · ${hud.collisionBuildings} 棟街區碰撞建築` : "台中街區正在快速初始化…"}</div><div className="start-buttons"><button onClick={start}>開始載客 →</button><button className="inspect-button" onClick={() => setShowroom(true)}>360° 看角色</button></div><div className="start-keys">W A S D 騎車　·　Shift 甩尾　·　E 接送</div></section>}

      {phone && started && <aside className="real-phone"><div className="phone-header"><span>CAPY PHONE</span><button onClick={() => setPhone(false)}>×</button></div><div className="phone-profile"><div>🦫</div><strong>卡皮隊長</strong><span>臺中慢活計程車</span></div><div className="phone-summary"><div><b>{hud.trips}</b><span>趟旅程</span></div><div><b>{hud.rating.toFixed(1)}</b><span>星評價</span></div><div><b>${hud.wallet}</b><span>錢包</span></div></div><div className="phone-grid"><button onClick={() => setGarage(true)}>🛠<span>改裝車庫</span></button><button onClick={() => setShowroom(true)}>🦫<span>角色展示</span></button><button onClick={() => commandsRef.current?.toggleAudio()}>{hud.audio ? "🔊" : "🔇"}<span>{hud.audio ? "音效開啟" : "音效關閉"}</span></button><button onClick={() => commandsRef.current?.flyHome()}>⌂<span>回草悟道</span></button></div><div className="phone-foot">資料來源：OpenStreetMap</div></aside>}

      {garage && <section className="real-garage" onClick={(event) => { if (event.currentTarget === event.target) setGarage(false); }}><div className="real-garage-card"><button className="garage-x" onClick={() => setGarage(false)}>×</button><span>WORKSHOP / TAICHUNG</span><h2>小綠改裝工坊</h2><p>把每一趟的小費，變成更舒服的下一段路。</p>{(["motor", "comfort", "boost"] as UpgradeKey[]).map((key) => { const level = hud.upgrades[key]; const price = (key === "motor" ? 220 : key === "comfort" ? 190 : 250) * (level + 1); const labels = { motor: ["高效電動馬達", "加速度與最高速"], comfort: ["雙人雲朵座墊", "增加舒適度與小費"], boost: ["甩尾動能回收", "延長加速時間"] }; return <div className="real-upgrade" key={key}><div><strong>{labels[key][0]}</strong><small>{labels[key][1]}</small><span>{"●".repeat(level)}{"○".repeat(3-level)}</span></div><button disabled={level >= 3 || hud.wallet < price} onClick={() => buy(key)}>{level >= 3 ? "MAX" : `$${price}`}</button></div>; })}<div className="real-garage-wallet">可用餘額 <strong>NT$ {hud.wallet}</strong></div></div></section>}

      <div className="real-touch"><div><button onPointerDown={() => hold("KeyA",true)} onPointerUp={() => hold("KeyA",false)} onPointerLeave={() => hold("KeyA",false)}>←</button><button onPointerDown={() => hold("KeyD",true)} onPointerUp={() => hold("KeyD",false)} onPointerLeave={() => hold("KeyD",false)}>→</button></div><div><button onPointerDown={() => hold("KeyS",true)} onPointerUp={() => hold("KeyS",false)} onPointerLeave={() => hold("KeyS",false)}>煞</button><button onPointerDown={() => hold("KeyW",true)} onPointerUp={() => hold("KeyW",false)} onPointerLeave={() => hold("KeyW",false)}>騎</button><button onClick={() => commandsRef.current?.interact()}>E</button></div></div>
      {showroom && <ModelShowroom close={() => setShowroom(false)} />}
    </main>
  );
}
