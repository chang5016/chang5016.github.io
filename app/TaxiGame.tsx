"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Phase = "pickup" | "dropoff";
type UpgradeKey = "engine" | "comfort" | "boost";
type SaveData = {
  money: number;
  rides: number;
  rating: number;
  level: number;
  upgrades: Record<UpgradeKey, number>;
};
type Stop = { name: string; district: string; x: number; z: number; icon: string };
type Rider = { name: string; emoji: string; quote: string; color: number; preference: string; tip: number };
type LiveState = SaveData & {
  speed: number;
  district: string;
  phase: Phase;
  rider: Rider;
  stop: Stop;
  distance: number;
  timer: number;
  comfort: number;
  drift: number;
  boosting: boolean;
  clock: string;
  weather: "sunny" | "rain";
  notification: string;
  canInteract: boolean;
  music: boolean;
  navAngle: number;
  combo: number;
};

type Collider = { x: number; z: number; halfX: number; halfZ: number };
type Traffic = { mesh: THREE.Group; road: number; direction: number; axis: "x" | "z"; progress: number; speed: number };

const ROAD_WIDTH = 12;
const BLOCK = 35;
const COLORS = [0xffb4a1, 0xffd584, 0xf5ecd0, 0xbac9d2, 0xd8a798, 0xc0d3af, 0xe7bd98];
const STOPS: Stop[] = [
  { name: "橘子中央公園", district: "中央公園", x: 0, z: 35, icon: "🍊" },
  { name: "海風魚市場", district: "海風碼頭", x: 105, z: 105, icon: "🐟" },
  { name: "雲朵美術館", district: "夕陽商業街", x: 105, z: -35, icon: "🎨" },
  { name: "月牙咖啡店", district: "森林住宅區", x: -105, z: 70, icon: "☕" },
  { name: "水豚溫泉旅館", district: "山丘溫泉街", x: -105, z: -105, icon: "♨️" },
  { name: "泡芙中央車站", district: "車站商圈", x: 35, z: -105, icon: "🚉" },
  { name: "西瓜海灘", district: "海風碼頭", x: -35, z: 140, icon: "🏖️" },
  { name: "小黃花書店", district: "夕陽商業街", x: 140, z: 35, icon: "📚" },
  { name: "晚安山丘", district: "山丘溫泉街", x: -140, z: -35, icon: "🌙" },
  { name: "牛奶糖夜市", district: "車站商圈", x: 70, z: -140, icon: "🏮" },
  { name: "港灣燈塔", district: "海風碼頭", x: 140, z: 140, icon: "🗼" },
  { name: "慢慢來花園", district: "森林住宅區", x: -140, z: 105, icon: "🌷" },
];
const RIDERS: Rider[] = [
  { name: "橘子阿嬤", emoji: "👵", quote: "慢慢開就好，阿嬤不趕時間。", color: 0xe2a38d, preference: "喜歡平穩駕駛", tip: 28 },
  { name: "趕稿企鵝", emoji: "🐧", quote: "編輯要稿了！拜託快一點！", color: 0x8498a8, preference: "偏好快速抵達", tip: 50 },
  { name: "打工兔兔", emoji: "🐰", quote: "你車上的香香好舒服喔。", color: 0xe8c9bb, preference: "希望舒適乘車", tip: 35 },
  { name: "衝浪狐狸", emoji: "🦊", quote: "前面路口甩一下啊！", color: 0xd89463, preference: "喜歡甩尾刺激", tip: 45 },
  { name: "旅人熊熊", emoji: "🐻", quote: "可以繞一下海邊嗎？", color: 0xb98970, preference: "享受海港風景", tip: 42 },
  { name: "咖啡師小鹿", emoji: "🦌", quote: "送你一杯燕麥拿鐵，謝謝。", color: 0xc5a179, preference: "喜歡夜晚兜風", tip: 38 },
  { name: "派對柴柴", emoji: "🐕", quote: "今天有派對，要一起來嗎？", color: 0xdbaa74, preference: "喜歡音樂", tip: 44 },
  { name: "畫家小浣熊", emoji: "🦝", quote: "這座城市的天空很漂亮。", color: 0x9b9290, preference: "偏好平穩駕駛", tip: 32 },
];
const DEFAULT_SAVE: SaveData = { money: 120, rides: 0, rating: 5, level: 1, upgrades: { engine: 0, comfort: 0, boost: 0 } };
const STORAGE_KEY = "capy-cab-save-v2";

function distanceTo(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function seededRandom(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function createBox(width: number, height: number, depth: number, color: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createCylinder(radius: number, height: number, color: number, segments = 10) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addPart(group: THREE.Group, mesh: THREE.Mesh, x: number, y: number, z: number) {
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function makeTree(scene: THREE.Scene, x: number, z: number, seed = Math.random()) {
  const trunk = createBox(0.6, 3.5, 0.6, 0x805944);
  trunk.position.set(x, 1.75, z);
  scene.add(trunk);
  const crown = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.5 + seed * 1.2, 0),
    new THREE.MeshStandardMaterial({ color: seed > 0.65 ? 0xb99b75 : seed > 0.35 ? 0x6f9671 : 0x87a67a, roughness: 1 }),
  );
  crown.position.set(x, 4.3, z);
  crown.castShadow = true;
  scene.add(crown);
}

function createSphere(radius: number, color: number, segments = 14) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, Math.max(8, Math.round(segments * 0.7))),
    new THREE.MeshStandardMaterial({ color, roughness: 0.91 }),
  );
  mesh.castShadow = true;
  return mesh;
}

function makeCapyCharacter(color: number, outfit = 0xe6bd82, hero = false) {
  const animal = new THREE.Group();
  const body = createSphere(0.74, hero ? 0xc99760 : outfit, 18);
  body.scale.set(1, 1.14, 0.8);
  addPart(animal, body, 0, 0.94, -0.08);
  const head = createSphere(0.57, color, 18);
  head.scale.set(1.07, 0.92, 0.87);
  addPart(animal, head, 0, 1.62, 0.08);
  const snout = createSphere(0.4, 0xc6976d, 16);
  snout.scale.set(1.13, 0.76, 0.77);
  addPart(animal, snout, 0, 1.43, 0.48);
  for (const x of [-0.28, 0.28]) {
    const eyeWhite = createSphere(0.115, 0xf1e8d8, 10);
    eyeWhite.scale.set(1, 0.78, 0.35);
    addPart(animal, eyeWhite, x, 1.71, 0.52);
    addPart(animal, createSphere(0.052, 0x2d2521, 8), x, 1.71, 0.56);
    const ear = createSphere(0.16, 0xc4864f, 10);
    ear.scale.set(0.8, 1.05, 0.42);
    addPart(animal, ear, x * 1.53, 2.13, -0.06);
    const leg = createSphere(0.19, 0x6b493b, 11);
    leg.scale.set(1, 0.58, 1.18);
    addPart(animal, leg, x * 1.35, 0.25, 0.15);
  }
  for (const x of [-0.095, 0.095]) addPart(animal, createSphere(0.035, 0x59423b, 7), x, 1.46, 0.805);
  if (hero) {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshStandardMaterial({ color: 0x777d49, roughness: 0.66 }),
    );
    helmet.scale.set(1.02, 0.76, 0.91);
    addPart(animal, helmet, 0, 1.69, -0.005);
    addPart(animal, createBox(1.08, 0.105, 0.13, 0x564338), 0, 1.83, 0.39);
    for (const x of [-0.22, 0.22]) {
      const goggles = createCylinder(0.19, 0.09, 0xc49a59, 13);
      goggles.rotation.x = Math.PI / 2;
      addPart(animal, goggles, x, 1.94, 0.5);
      const lens = createCylinder(0.145, 0.095, 0xb5d5da, 13);
      lens.rotation.x = Math.PI / 2;
      addPart(animal, lens, x, 1.94, 0.555);
    }
    addPart(animal, createBox(0.88, 0.045, 0.08, 0x493b30), 0, 1.14, 0.26);
    const tongue = createSphere(0.085, 0xed7779, 10);
    tongue.scale.set(0.85, 1.7, 0.42);
    addPart(animal, tongue, 0.075, 1.17, 0.73);
  }
  animal.castShadow = true;
  return animal;
}

function makeCapyCab() {
  const cab = new THREE.Group();
  const olive = 0x727a48;
  const darkerOlive = 0x555e37;
  const cream = 0xe5dbb3;
  addPart(cab, createBox(1.27, 0.38, 3.96, darkerOlive), 0, 0.91, -0.14);
  addPart(cab, createBox(1.57, 0.78, 1.82, olive), 0, 1.02, -1.0);
  const rearFairing = createSphere(0.76, olive, 16);
  rearFairing.scale.set(1.17, 0.72, 1.31);
  addPart(cab, rearFairing, 0, 1.19, -1.08);
  for (const x of [-0.75, 0.75]) addPart(cab, createBox(0.06, 0.62, 1.02, cream), x, 1.15, -1.15);

  const frontShield = createSphere(0.82, olive, 17);
  frontShield.scale.set(1, 1.3, 0.39);
  addPart(cab, frontShield, 0, 1.55, 1.16);
  const shieldInset = createSphere(0.59, cream, 15);
  shieldInset.scale.set(0.82, 1.25, 0.22);
  addPart(cab, shieldInset, 0, 1.5, 1.48);
  addPart(cab, createBox(1.13, 0.31, 2.28, 0x58493e), 0, 1.65, -0.69);
  for (let seam = -1.46; seam < 0.38; seam += 0.31) addPart(cab, createBox(1.11, 0.014, 0.018, 0x8a7868), 0, 1.82, seam);

  const handlebar = createBox(1.82, 0.11, 0.13, 0x48443e);
  addPart(cab, handlebar, 0, 2.32, 1.04);
  addPart(cab, createCylinder(0.095, 0.89, 0x53503f), 0, 1.95, 1.12);
  for (const x of [-0.98, 0.98]) {
    addPart(cab, createBox(0.26, 0.16, 0.18, 0x423b35), x, 2.32, 1.04);
    const mirrorArm = createCylinder(0.036, 0.7, 0x9b9991, 8);
    mirrorArm.rotation.z = x > 0 ? -0.25 : 0.25;
    addPart(cab, mirrorArm, x * 1.11, 2.63, 1.04);
    const mirror = createSphere(0.17, 0xc0bdb2, 12);
    mirror.scale.set(1.2, 0.77, 0.38);
    addPart(cab, mirror, x * 1.24, 2.94, 1.08);
  }

  const driver = makeCapyCharacter(0xc79764, 0xc79764, true);
  driver.scale.setScalar(1.23);
  driver.position.set(0, 1.18, 0.17);
  cab.add(driver);

  const passengerSeat = new THREE.Group();
  passengerSeat.name = "passengerSeat";
  passengerSeat.position.set(0, 1.22, -1.39);
  cab.add(passengerSeat);
  for (const z of [-1.68, 1.42]) {
    const wheel = createCylinder(0.6, 0.38, 0x343331, 15);
    wheel.rotation.z = Math.PI / 2;
    addPart(cab, wheel, 0, 0.61, z);
    const hub = createCylinder(0.33, 0.405, 0x8b8880, 14);
    hub.rotation.z = Math.PI / 2;
    addPart(cab, hub, 0, 0.61, z);
  }
  const headlight = createCylinder(0.36, 0.23, 0xfff0bf, 14);
  headlight.rotation.x = Math.PI / 2;
  addPart(cab, headlight, 0, 2.07, 1.58);
  addPart(cab, createBox(0.6, 0.32, 0.09, 0xe95d60), 0, 1.28, -2.03);
  addPart(cab, createBox(0.7, 0.37, 0.08, cream), 0, 0.89, -2.08);
  return cab;
}

function makeStreetLight(scene: THREE.Scene, x: number, z: number, lampLights: THREE.Mesh[]) {
  const pole = createCylinder(0.12, 6.1, 0x4c5251, 8);
  pole.position.set(x, 3.02, z);
  scene.add(pole);
  const arm = createBox(1.35, 0.12, 0.12, 0x4c5251);
  arm.position.set(x + 0.58, 5.96, z);
  scene.add(arm);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffecb8, emissive: 0xffca76, emissiveIntensity: 0.12 }),
  );
  bulb.position.set(x + 1.13, 5.75, z);
  scene.add(bulb);
  lampLights.push(bulb);
}

function makeAwning(scene: THREE.Scene, x: number, z: number, color: number) {
  const frame = createBox(8.8, 0.34, 2.5, color);
  frame.position.set(x, 3.4, z);
  scene.add(frame);
  for (let i = -3; i <= 3; i += 2) {
    const stripe = createBox(0.62, 0.36, 2.53, 0xfff4e0);
    stripe.position.set(x + i, 3.42, z);
    scene.add(stripe);
  }
}

function makeLandmarks(scene: THREE.Scene) {
  const tower = new THREE.Group();
  addPart(tower, createCylinder(4.3, 20, 0xfff1d6, 12), 0, 10, 0);
  addPart(tower, createCylinder(4.48, 3, 0xe78b77, 12), 0, 5, 0);
  addPart(tower, createCylinder(4.48, 3, 0xe78b77, 12), 0, 13, 0);
  addPart(tower, createCylinder(5.1, 0.75, 0x7b7369, 12), 0, 20.15, 0);
  addPart(tower, createCylinder(3.1, 3.3, 0xffdfa1, 10), 0, 21.9, 0);
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(4.1, 3.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xc97866, roughness: 1 }),
  );
  addPart(tower, top, 0, 25.1, 0);
  tower.position.set(163, 0, 160);
  scene.add(tower);

  const ferris = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(13.5, 0.29, 7, 32),
    new THREE.MeshStandardMaterial({ color: 0xffe6be, roughness: 0.62 }),
  );
  ring.position.set(0, 18, 0);
  ferris.add(ring);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const spoke = createBox(0.13, 13.4, 0.13, 0xe9dfd4);
    spoke.position.set(Math.sin(angle) * 6.7, 18 + Math.cos(angle) * 6.7, 0);
    spoke.rotation.z = -angle;
    ferris.add(spoke);
    const pod = createBox(1.8, 1.3, 1.5, COLORS[i % COLORS.length]);
    pod.position.set(Math.sin(angle) * 13.45, 18 + Math.cos(angle) * 13.45, 0);
    ferris.add(pod);
  }
  addPart(ferris, createBox(0.7, 19, 0.7, 0xf0dfbd), -4.7, 9.5, 0);
  addPart(ferris, createBox(0.7, 19, 0.7, 0xf0dfbd), 4.7, 9.5, 0);
  ferris.position.set(-95, 0, 163);
  scene.add(ferris);

  const fountain = new THREE.Group();
  addPart(fountain, createCylinder(5.1, 0.7, 0xe4d8c6, 16), 0, 0.35, 0);
  addPart(fountain, createCylinder(4.45, 0.09, 0x86bcd0, 16), 0, 0.76, 0);
  addPart(fountain, createCylinder(0.8, 2.7, 0xe9dec8, 12), 0, 1.7, 0);
  fountain.position.set(-17.5, 0, 17.5);
  scene.add(fountain);
  return { ferris };
}

function seedCity(scene: THREE.Scene) {
  const colliders: Collider[] = [];
  const lampLights: THREE.Mesh[] = [];
  const ground = createBox(400, 0.4, 400, 0x98ad83);
  ground.position.y = -0.28;
  scene.add(ground);

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x596670, roughness: 1 });
  for (let index = -4; index <= 4; index++) {
    const avenue = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 315), roadMaterial);
    avenue.rotation.x = -Math.PI / 2;
    avenue.position.set(index * BLOCK, 0.02, 0);
    avenue.receiveShadow = true;
    scene.add(avenue);
    const cross = avenue.clone();
    cross.rotation.z = Math.PI / 2;
    cross.position.set(0, 0.023, index * BLOCK);
    scene.add(cross);
    for (let line = -14; line <= 14; line++) {
      if (Math.abs(line % 3) === 0) continue;
      const marking = createBox(0.16, 0.025, 3, 0xffefbe);
      marking.position.set(index * BLOCK, 0.06, line * 10);
      scene.add(marking);
      const horizontal = marking.clone();
      horizontal.rotation.y = Math.PI / 2;
      horizontal.position.set(line * 10, 0.061, index * BLOCK);
      scene.add(horizontal);
    }
    for (let light = -3; light <= 3; light += 2) {
      makeStreetLight(scene, index * BLOCK + 7.6, light * BLOCK + 9, lampLights);
    }
  }

  for (let bx = -4; bx < 4; bx++) {
    for (let bz = -4; bz < 4; bz++) {
      const x = bx * BLOCK + BLOCK / 2;
      const z = bz * BLOCK + BLOCK / 2;
      const seed = seededRandom((bx + 6) * 41 + bz * 13 + 3);
      if ((bx === -1 || bx === 0) && (bz === -1 || bz === 0)) {
        for (let tree = 0; tree < 6; tree++) {
          const treeX = x + (seededRandom(tree * 15 + x) - 0.5) * 18;
          const treeZ = z + (seededRandom(tree * 19 + z) - 0.5) * 18;
          makeTree(scene, treeX, treeZ, seededRandom(tree + x + z));
        }
        continue;
      }
      const width = 18 + seed * 5;
      const depth = 18 + seededRandom(x + z) * 5;
      const buildingHeight = 8 + seed * 21 + (Math.abs(bx) < 2 ? 8 : 0);
      const building = createBox(width, buildingHeight, depth, COLORS[Math.floor(seed * COLORS.length)]);
      building.position.set(x, buildingHeight / 2, z);
      scene.add(building);
      colliders.push({ x, z, halfX: width / 2 + 0.8, halfZ: depth / 2 + 0.8 });
      const roof = createBox(width + 0.95, 0.55, depth + 0.95, 0xefe5d7);
      roof.position.set(x, buildingHeight + 0.25, z);
      scene.add(roof);
      for (let wy = 4; wy < buildingHeight - 1; wy += 4) {
        for (const wx of [-6, 0, 6]) {
          const window = createBox(2.35, 1.95, 0.1, seededRandom(wx + wy + x) > 0.28 ? 0xbed2d6 : 0xffdc96);
          window.position.set(x + wx, wy, z + depth / 2 + 0.08);
          scene.add(window);
        }
      }
      if (seed > 0.25) makeTree(scene, x - 11.8, z - 11.8, seed);
      if (seed > 0.56) makeAwning(scene, x, z + depth / 2 + 1.08, seed > 0.8 ? 0xd99580 : 0x7d9d86);
    }
  }

  const sand = createBox(92, 0.07, 26, 0xe6cf9c);
  sand.position.set(-22, -0.035, 169);
  scene.add(sand);
  for (let index = 0; index < 8; index++) {
    const parasol = new THREE.Mesh(
      new THREE.ConeGeometry(2.65, 1.3, 12),
      new THREE.MeshStandardMaterial({ color: index % 2 === 0 ? 0xec8f78 : 0xe8c66c, roughness: 1 }),
    );
    parasol.position.set(-55 + index * 10, 3.1, 167 + (index % 2) * 7);
    scene.add(parasol);
    const pole = createCylinder(0.11, 3, 0xecdcc0);
    pole.position.set(parasol.position.x, 1.5, parasol.position.z);
    scene.add(pole);
  }

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ color: 0x6daac6, roughness: 0.36, metalness: 0.08 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.5, 370);
  scene.add(sea);
  const { ferris } = makeLandmarks(scene);
  return { colliders, lampLights, ferris, sea };
}

function makeMarker(color: number) {
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.05, 0.14, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  marker.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 2.7, 19, 18, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.095, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 9.5;
  marker.add(beam);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.33, roughness: 0.35 }),
  );
  diamond.position.y = 5.0;
  diamond.name = "diamond";
  marker.add(diamond);
  return marker;
}

function makeTrafficVehicle(color: number) {
  const vehicle = new THREE.Group();
  addPart(vehicle, createBox(2.8, 0.83, 4.45, color), 0, 1.06, 0);
  addPart(vehicle, createBox(2.32, 0.8, 2.15, color), 0, 1.79, -0.15);
  addPart(vehicle, createBox(2.06, 0.5, 0.06, 0xb7d2d3), 0, 1.82, 0.96);
  for (const x of [-1.44, 1.44]) {
    for (const z of [-1.38, 1.38]) {
      const wheel = createCylinder(0.42, 0.3, 0x454243, 9);
      wheel.rotation.z = Math.PI / 2;
      addPart(vehicle, wheel, x, 0.52, z);
    }
  }
  return vehicle;
}

function createAudio() {
  let context: AudioContext | null = null;
  let engine: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let enabled = true;

  const init = () => {
    if (context) return;
    context = new AudioContext();
    gain = context.createGain();
    gain.gain.value = 0.025;
    gain.connect(context.destination);
    engine = context.createOscillator();
    engine.type = "triangle";
    engine.frequency.value = 72;
    engine.connect(gain);
    engine.start();
  };

  const tone = (frequency: number, length = 0.12, volume = 0.1, kind: OscillatorType = "sine") => {
    if (!context || !enabled) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = kind;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(volume, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + length);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + length);
  };

  return {
    init,
    setEngine: (speed: number) => {
      if (!context || !engine || !gain) return;
      engine.frequency.setTargetAtTime(67 + speed * 3.4, context.currentTime, 0.08);
      gain.gain.setTargetAtTime(enabled ? 0.016 + Math.min(speed * 0.0013, 0.035) : 0, context.currentTime, 0.08);
    },
    chime: () => { tone(660, 0.16, 0.075); setTimeout(() => tone(880, 0.24, 0.08), 90); },
    success: () => [523, 659, 784, 1046].forEach((note, i) => setTimeout(() => tone(note, 0.22, 0.08), i * 95)),
    impact: () => tone(105, 0.19, 0.09, "sawtooth"),
    horn: () => { tone(340, 0.2, 0.12, "square"); setTimeout(() => tone(430, 0.14, 0.09, "square"), 115); },
    toggle: () => { enabled = !enabled; return enabled; },
    dispose: () => { engine?.stop(); context?.close(); },
  };
}

export default function TaxiGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef(false);
  const heldRef = useRef(new Set<string>());
  const saveRef = useRef<SaveData>({ ...DEFAULT_SAVE, upgrades: { ...DEFAULT_SAVE.upgrades } });
  const actionRef = useRef<{ interact: () => void; horn: () => void; audio: () => void; toggleAudio: () => boolean } | null>(null);
  const [started, setStarted] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [live, setLive] = useState<LiveState>({
    ...DEFAULT_SAVE,
    speed: 0,
    district: "橘子中央公園",
    phase: "pickup",
    rider: RIDERS[0],
    stop: STOPS[0],
    distance: 35,
    timer: 96,
    comfort: 100,
    drift: 0,
    boosting: false,
    clock: "16:30",
    weather: "sunny",
    notification: "新的叫車通知：橘子阿嬤正在中央公園等你",
    canInteract: false,
    music: true,
    navAngle: 0,
    combo: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        saveRef.current = {
          ...DEFAULT_SAVE,
          ...parsed,
          upgrades: { ...DEFAULT_SAVE.upgrades, ...(parsed.upgrades ?? {}) },
        };
      }
    } catch {
      saveRef.current = { ...DEFAULT_SAVE, upgrades: { ...DEFAULT_SAVE.upgrades } };
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa7d6e9);
    scene.fog = new THREE.Fog(0xa7d6e9, 80, 260);

    const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 9, -16);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.17;

    const ambient = new THREE.HemisphereLight(0xffefcf, 0x708568, 2.4);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xfff0ca, 2.3);
    sunlight.position.set(45, 70, 35);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -85;
    sunlight.shadow.camera.right = 85;
    sunlight.shadow.camera.top = 85;
    sunlight.shadow.camera.bottom = -85;
    scene.add(sunlight);

    const city = seedCity(scene);
    const cab = makeCapyCab();
    scene.add(cab);

    const pickupMarker = makeMarker(0xffca62);
    const destinationMarker = makeMarker(0x8ce6ba);
    scene.add(pickupMarker, destinationMarker);
    destinationMarker.visible = false;
    const waitingRider = makeCapyCharacter(RIDERS[0].color, 0xd8a796);
    waitingRider.position.set(STOPS[0].x + 3.4, 0.12, STOPS[0].z + 2.1);
    scene.add(waitingRider);
    pickupMarker.position.set(STOPS[0].x, 0, STOPS[0].z);

    const traffic: Traffic[] = [];
    for (let index = 0; index < 13; index++) {
      const axis = index % 2 === 0 ? "z" : "x";
      const direction = index % 3 === 0 ? -1 : 1;
      const vehicle = makeTrafficVehicle(COLORS[(index + 2) % COLORS.length]);
      const entry: Traffic = {
        mesh: vehicle,
        axis,
        road: ((index * 3) % 7) - 3,
        direction,
        progress: -145 + ((index * 49) % 290),
        speed: 7 + (index % 4) * 1.65,
      };
      traffic.push(entry);
      scene.add(vehicle);
    }

    const smokeGeometry = new THREE.SphereGeometry(0.29, 6, 5);
    const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0xf4e8d0, transparent: true, opacity: 0.63 });
    const smokeParticles = Array.from({ length: 30 }, () => {
      const particle = new THREE.Mesh(smokeGeometry, smokeMaterial.clone());
      particle.visible = false;
      scene.add(particle);
      return { mesh: particle, life: 0, vx: 0, vz: 0 };
    });
    let smokeIndex = 0;

    const rainPositions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index++) {
      rainPositions[index * 3] = (Math.random() - 0.5) * 80;
      rainPositions[index * 3 + 1] = Math.random() * 35;
      rainPositions[index * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rain = new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: 0xd4e8f0, size: 0.11, transparent: true, opacity: 0.63 }));
    rain.visible = false;
    scene.add(rain);

    const audio = createAudio();

    const mission = {
      phase: "pickup" as Phase,
      rider: RIDERS[saveRef.current.rides % RIDERS.length],
      target: STOPS[0],
      destination: STOPS[3],
      timer: 98,
      comfort: 100,
      notification: "新的叫車通知：乘客正在中央公園等你",
      notificationTimer: 5,
      interactionCooldown: 0,
      collisionCooldown: 0,
      combo: 0,
      music: true,
    };

    const save = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saveRef.current)); } catch { /* device storage unavailable */ }
    };

    const resetRide = (completed: boolean) => {
      if (completed) {
        saveRef.current.rides += 1;
        saveRef.current.level = Math.floor(saveRef.current.rides / 4) + 1;
      }
      const pickupIndex = (saveRef.current.rides * 5 + 2) % STOPS.length;
      let destinationIndex = (pickupIndex + 3 + (saveRef.current.rides % 5)) % STOPS.length;
      if (destinationIndex === pickupIndex) destinationIndex = (destinationIndex + 4) % STOPS.length;
      mission.phase = "pickup";
      mission.rider = RIDERS[saveRef.current.rides % RIDERS.length];
      mission.target = STOPS[pickupIndex];
      mission.destination = STOPS[destinationIndex];
      mission.timer = 92 + Math.min(distanceTo(mission.target, mission.destination) * 0.35, 48);
      mission.comfort = 100;
      pickupMarker.visible = true;
      pickupMarker.position.set(mission.target.x, 0, mission.target.z);
      destinationMarker.visible = false;
      waitingRider.visible = true;
      waitingRider.position.set(mission.target.x + 3.4, 0.12, mission.target.z + 2.1);
      const seat = cab.getObjectByName("passengerSeat");
      seat?.clear();
      save();
    };

    let velocity = 0;
    const interact = () => {
      if (!startedRef.current || mission.interactionCooldown > 0) return;
      const distance = distanceTo(cab.position, mission.target);
      if (distance > 8 || Math.abs(velocity) > 10) {
        mission.notification = distance > 8 ? "靠近發光的接送點，再按 E" : "慢一點停車，乘客才敢上車！";
        mission.notificationTimer = 2.4;
        return;
      }
      mission.interactionCooldown = 1;
      if (mission.phase === "pickup") {
        mission.phase = "dropoff";
        mission.target = mission.destination;
        pickupMarker.visible = false;
        destinationMarker.visible = true;
        destinationMarker.position.set(mission.destination.x, 0, mission.destination.z);
        waitingRider.visible = false;
        const seat = cab.getObjectByName("passengerSeat");
        if (seat) {
          const riderModel = makeCapyCharacter(mission.rider.color, 0xe7b184);
          riderModel.scale.setScalar(0.76);
          seat.add(riderModel);
        }
        mission.notification = `${mission.rider.emoji} ${mission.rider.name}：${mission.rider.quote}`;
        mission.notificationTimer = 5;
        audio.chime();
      } else {
        const baseFare = Math.round(64 + distanceTo(mission.destination, STOPS[(saveRef.current.rides * 5 + 2) % STOPS.length]) * 0.47);
        const tip = Math.round((mission.rider.tip + saveRef.current.upgrades.comfort * 9) * (mission.comfort / 100));
        const timeBonus = Math.round(Math.max(mission.timer, 0) * 0.31);
        const reward = baseFare + tip + timeBonus;
        saveRef.current.money += reward;
        const targetRating = mission.comfort > 72 ? 5 : mission.comfort > 42 ? 4 : 3;
        saveRef.current.rating = Math.round((saveRef.current.rating * 0.72 + targetRating * 0.28) * 10) / 10;
        mission.combo += 1;
        mission.notification = `✨ 送達成功！車資 $${baseFare} ＋ 小費 $${tip} ＋ 時間獎金 $${timeBonus}`;
        mission.notificationTimer = 6;
        audio.success();
        resetRide(true);
      }
    };

    actionRef.current = {
      interact,
      horn: () => audio.horn(),
      audio: () => audio.init(),
      toggleAudio: () => {
        mission.music = audio.toggle();
        return mission.music;
      },
    };

    const pressed = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      if (!event.repeat && event.code === "KeyE") interact();
      if (!event.repeat && event.code === "KeyH") audio.horn();
      if (!event.repeat && event.code === "KeyM") setPhoneOpen((current) => !current);
      if (!event.repeat && event.code === "KeyC") cameraMode = (cameraMode + 1) % 3;
      pressed.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let heading = 0;
    let frame = 0;
    let animation = 0;
    let elapsed = 0;
    let driftCharge = 0;
    let boostRemaining = 0;
    let cameraMode = 0;
    let driftHeld = false;
    let weather: "sunny" | "rain" = "sunny";
    const cameraTarget = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const skyAfternoon = new THREE.Color(0xa7d6e9);
    const skySunset = new THREE.Color(0xf2b58c);
    const skyNight = new THREE.Color(0x293b56);
    const currentSky = new THREE.Color(0xa7d6e9);

    const drawMap = (target: Stop) => {
      const map = mapRef.current;
      if (!map) return;
      const context = map.getContext("2d");
      if (!context) return;
      const size = map.width;
      context.clearRect(0, 0, size, size);
      context.save();
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "#849c79";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#78adc5";
      context.fillRect(0, size * 0.83, size, size * 0.17);
      const scale = size / 340;
      context.strokeStyle = "#e7dec8";
      context.lineWidth = 5.2;
      for (let road = -4; road <= 4; road++) {
        const point = size / 2 + road * BLOCK * scale;
        context.beginPath(); context.moveTo(point, 0); context.lineTo(point, size); context.stroke();
        context.beginPath(); context.moveTo(0, point); context.lineTo(size, point); context.stroke();
      }
      const tx = size / 2 + target.x * scale;
      const tz = size / 2 + target.z * scale;
      context.fillStyle = mission.phase === "pickup" ? "#ffcd63" : "#92e5bd";
      context.beginPath(); context.arc(tx, tz, 5.3, 0, Math.PI * 2); context.fill();
      const px = size / 2 + cab.position.x * scale;
      const pz = size / 2 + cab.position.z * scale;
      context.translate(px, pz);
      context.rotate(-heading);
      context.fillStyle = "#ffffff";
      context.beginPath(); context.moveTo(0, 6); context.lineTo(-4, -4); context.lineTo(4, -4); context.closePath(); context.fill();
      context.restore();
      context.strokeStyle = "rgba(255,255,255,.75)";
      context.lineWidth = 2;
      context.beginPath(); context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); context.stroke();
    };

    const loop = () => {
      animation = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.035);
      const active = startedRef.current;
      elapsed += dt;
      const hasKey = (code: string) => pressed.has(code) || heldRef.current.has(code);
      const throttle = hasKey("KeyW") || hasKey("ArrowUp");
      const reverse = hasKey("KeyS") || hasKey("ArrowDown");
      const left = hasKey("KeyA") || hasKey("ArrowLeft");
      const right = hasKey("KeyD") || hasKey("ArrowRight");
      const drifting = hasKey("ShiftLeft") || hasKey("ShiftRight");
      const braking = hasKey("Space");
      mission.interactionCooldown = Math.max(0, mission.interactionCooldown - dt);
      mission.collisionCooldown = Math.max(0, mission.collisionCooldown - dt);
      mission.notificationTimer = Math.max(0, mission.notificationTimer - dt);

      if (active) {
        const engineLevel = saveRef.current.upgrades.engine;
        const maxSpeed = 23 + engineLevel * 3.5 + (boostRemaining > 0 ? 14 : 0);
        velocity += (throttle ? 19 + engineLevel * 2.8 : reverse ? -21 : 0) * dt;
        if (boostRemaining > 0) {
          velocity += (16 + saveRef.current.upgrades.boost * 4) * dt;
          boostRemaining = Math.max(0, boostRemaining - dt);
        }
        velocity *= Math.exp(-(braking ? 5.5 : throttle || reverse ? 0.39 : 1.25) * dt);
        velocity = THREE.MathUtils.clamp(velocity, -10, maxSpeed);
        const steering = (left ? 1 : 0) - (right ? 1 : 0);
        heading += steering * Math.min(Math.abs(velocity) / 7, 1) * (drifting ? 2.15 : 1.68) * dt * Math.sign(velocity || 1);
        const previousX = cab.position.x;
        const previousZ = cab.position.z;
        cab.position.x += Math.sin(heading) * velocity * dt;
        cab.position.z += Math.cos(heading) * velocity * dt;
        cab.position.x = THREE.MathUtils.clamp(cab.position.x, -174, 174);
        cab.position.z = THREE.MathUtils.clamp(cab.position.z, -174, 178);
        for (const collider of city.colliders) {
          if (Math.abs(cab.position.x - collider.x) < collider.halfX + 1.43 && Math.abs(cab.position.z - collider.z) < collider.halfZ + 1.43) {
            cab.position.x = previousX;
            cab.position.z = previousZ;
            if (mission.collisionCooldown <= 0 && Math.abs(velocity) > 5) {
              velocity *= -0.28;
              mission.comfort = Math.max(6, mission.comfort - (11 - saveRef.current.upgrades.comfort * 1.8));
              mission.collisionCooldown = 0.8;
              mission.notification = "碰！乘客舒適度下降，開慢一點～";
              mission.notificationTimer = 2;
              audio.impact();
            }
            break;
          }
        }
        cab.rotation.y = heading;
        cab.rotation.z = THREE.MathUtils.lerp(cab.rotation.z, -steering * velocity * 0.008, dt * 6);
        cab.rotation.x = THREE.MathUtils.lerp(cab.rotation.x, braking ? -0.075 : throttle ? 0.028 : 0, dt * 5);

        if (drifting && Math.abs(velocity) > 8 && steering !== 0) {
          driftCharge = Math.min(5.1, driftCharge + dt);
          if (frame % 3 === 0) {
            const particle = smokeParticles[smokeIndex++ % smokeParticles.length];
            particle.life = 0.52;
            particle.mesh.visible = true;
            particle.mesh.position.set(cab.position.x - Math.sin(heading) * 1.8 + (Math.random() - 0.5) * 1.2, 0.5, cab.position.z - Math.cos(heading) * 1.8);
            particle.vx = (Math.random() - 0.5) * 2;
            particle.vz = (Math.random() - 0.5) * 2;
          }
          if (mission.phase === "dropoff" && !mission.rider.preference.includes("甩尾")) {
            mission.comfort = Math.max(10, mission.comfort - dt * (1.8 - saveRef.current.upgrades.comfort * 0.3));
          }
        }
        if (driftHeld && !drifting && driftCharge > 0.9) {
          boostRemaining = 0.52 + driftCharge * 0.29 + saveRef.current.upgrades.boost * 0.2;
          mission.notification = driftCharge > 3.6 ? "🔥 超級甩尾！水豚渦輪啟動" : driftCharge > 1.8 ? "⚡ 漂移漂亮！加速衝刺" : "💨 甩尾加速";
          mission.notificationTimer = 1.8;
          audio.chime();
          driftCharge = 0;
        }
        if (!drifting) driftCharge = Math.max(0, driftCharge - dt * 2);
        driftHeld = drifting;

        if (mission.phase === "dropoff") {
          mission.timer -= dt;
          if (mission.timer <= 0) {
            mission.combo = 0;
            saveRef.current.rating = Math.max(3, Math.round((saveRef.current.rating - 0.2) * 10) / 10);
            mission.notification = "⏰ 乘客等太久了，下一趟再加油！";
            mission.notificationTimer = 5;
            resetRide(false);
          }
        }
        audio.setEngine(Math.abs(velocity));
      }

      for (const particle of smokeParticles) {
        if (particle.life <= 0) continue;
        particle.life -= dt;
        particle.mesh.position.x += particle.vx * dt;
        particle.mesh.position.z += particle.vz * dt;
        particle.mesh.position.y += dt * 1.05;
        particle.mesh.scale.setScalar(1 + (0.52 - particle.life) * 2.6);
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, particle.life / 0.52) * 0.52;
        if (particle.life <= 0) particle.mesh.visible = false;
      }

      for (const car of traffic) {
        car.progress += car.direction * car.speed * dt;
        if (car.progress > 160) car.progress = -160;
        if (car.progress < -160) car.progress = 160;
        const lane = car.direction > 0 ? 3.1 : -3.1;
        if (car.axis === "z") {
          car.mesh.position.set(car.road * BLOCK + lane, 0, car.progress);
          car.mesh.rotation.y = car.direction > 0 ? 0 : Math.PI;
        } else {
          car.mesh.position.set(car.progress, 0, car.road * BLOCK - lane);
          car.mesh.rotation.y = car.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        if (active && mission.collisionCooldown <= 0 && distanceTo(cab.position, car.mesh.position) < 3.5 && Math.abs(velocity) > 4) {
          velocity *= -0.32;
          mission.comfort = Math.max(7, mission.comfort - 13 + saveRef.current.upgrades.comfort * 1.4);
          mission.collisionCooldown = 1;
          mission.notification = "🚗 差點撞到別人！注意路口來車";
          mission.notificationTimer = 2.5;
          audio.impact();
        }
      }

      const day = (elapsed / 230) % 3;
      if (day < 1) currentSky.copy(skyAfternoon).lerp(skySunset, day);
      else if (day < 2) currentSky.copy(skySunset).lerp(skyNight, day - 1);
      else currentSky.copy(skyNight).lerp(skyAfternoon, day - 2);
      scene.background = currentSky;
      if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(currentSky);
      const nightAmount = day > 1 ? Math.sin(((day - 1) / 2) * Math.PI) : 0;
      sunlight.intensity = THREE.MathUtils.lerp(2.3, 0.23, nightAmount);
      ambient.intensity = THREE.MathUtils.lerp(2.3, 0.75, nightAmount);
      for (const lamp of city.lampLights) (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + nightAmount * 4.2;
      if (frame % 7200 === 0 && frame > 0) weather = weather === "sunny" ? "rain" : "sunny";
      rain.visible = weather === "rain";
      if (rain.visible) {
        rain.position.set(cab.position.x, 0, cab.position.z);
        const positions = rainGeometry.attributes.position as THREE.BufferAttribute;
        for (let index = 0; index < 700; index++) {
          const y = positions.getY(index) - dt * 19;
          positions.setY(index, y < 0 ? 35 : y);
        }
        positions.needsUpdate = true;
      }
      city.ferris.rotation.z = Math.sin(elapsed * 0.08) * 0.04;
      city.sea.material.color.setHSL(0.55, 0.43, 0.56 - nightAmount * 0.25);

      for (const marker of [pickupMarker, destinationMarker]) {
        if (!marker.visible) continue;
        const diamond = marker.getObjectByName("diamond");
        if (diamond) {
          diamond.rotation.y += dt * 1.6;
          diamond.position.y = 5 + Math.sin(elapsed * 2.1) * 0.34;
        }
        marker.children[0].scale.setScalar(1 + Math.sin(elapsed * 3) * 0.065);
      }
      waitingRider.rotation.y = Math.sin(elapsed * 0.8) * 0.2;

      if (cameraMode === 0) {
        desiredCamera.set(
          cab.position.x - Math.sin(heading) * (12 + Math.abs(velocity) * 0.13),
          7.5 + Math.abs(velocity) * 0.055,
          cab.position.z - Math.cos(heading) * (12 + Math.abs(velocity) * 0.13),
        );
        cameraTarget.set(cab.position.x + Math.sin(heading) * 1.8, 2, cab.position.z + Math.cos(heading) * 1.8);
      } else if (cameraMode === 1) {
        desiredCamera.set(cab.position.x - Math.sin(heading) * 0.2, 3.7, cab.position.z - Math.cos(heading) * 0.2);
        cameraTarget.set(cab.position.x + Math.sin(heading) * 25, 3.2, cab.position.z + Math.cos(heading) * 25);
      } else {
        desiredCamera.set(cab.position.x - Math.sin(heading) * 17, 22, cab.position.z - Math.cos(heading) * 17);
        cameraTarget.set(cab.position.x, 0, cab.position.z);
      }
      camera.position.lerp(desiredCamera, 1 - Math.exp(-(cameraMode === 1 ? 8 : 3.9) * dt));
      camera.lookAt(cameraTarget);
      camera.fov = THREE.MathUtils.lerp(camera.fov, boostRemaining > 0 ? 69 : cameraMode === 1 ? 71 : 54, dt * 3);
      camera.updateProjectionMatrix();
      sunlight.position.set(cab.position.x + 45, 70, cab.position.z + 35);
      sunlight.target.position.copy(cab.position);
      sunlight.target.updateMatrixWorld();

      frame++;
      if (frame % 8 === 0) {
        const district = cab.position.z > 85 ? "海風碼頭" : cab.position.z < -80 ? "車站商圈" : cab.position.x > 75 ? "夕陽商業街" : cab.position.x < -75 ? "森林住宅區" : "橘子中央公園";
        const hours = (16 + Math.floor(elapsed / 38)) % 24;
        const minutes = Math.floor((30 + elapsed * 1.55) % 60);
        const targetDistance = distanceTo(cab.position, mission.target);
        const bearing = Math.atan2(mission.target.x - cab.position.x, mission.target.z - cab.position.z) - heading;
        setLive({
          ...saveRef.current,
          upgrades: { ...saveRef.current.upgrades },
          speed: Math.round(Math.abs(velocity) * 5.4),
          district,
          phase: mission.phase,
          rider: mission.rider,
          stop: mission.target,
          distance: Math.round(targetDistance),
          timer: Math.max(0, Math.ceil(mission.timer)),
          comfort: Math.round(mission.comfort),
          drift: driftCharge,
          boosting: boostRemaining > 0,
          clock: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
          weather,
          notification: mission.notificationTimer > 0 ? mission.notification : "",
          canInteract: targetDistance < 8 && Math.abs(velocity) < 10,
          music: mission.music,
          navAngle: bearing * 180 / Math.PI,
          combo: mission.combo,
        });
        drawMap(mission.target);
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      actionRef.current = null;
      audio.dispose();
      renderer.dispose();
    };
  }, []);

  const begin = () => {
    startedRef.current = true;
    setStarted(true);
    actionRef.current?.audio();
  };

  const hold = (key: string, active: boolean) => {
    if (active) heldRef.current.add(key);
    else heldRef.current.delete(key);
  };

  const purchase = (key: UpgradeKey) => {
    const current = saveRef.current.upgrades[key];
    const cost = (key === "engine" ? 180 : key === "comfort" ? 150 : 210) * (current + 1);
    if (current >= 3 || saveRef.current.money < cost) return;
    saveRef.current.money -= cost;
    saveRef.current.upgrades[key] += 1;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saveRef.current)); } catch { /* device storage unavailable */ }
    setLive((previous) => ({ ...previous, ...saveRef.current, upgrades: { ...saveRef.current.upgrades } }));
  };

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="卡皮巴拉計程車 3D 城市" />
      <div className="ambient-vignette" />
      <div className="hud">
        <div className="brand-lockup"><div className="brand-name">CAPY<span>CAB</span></div><div className="brand-note">SLOW CITY · GOOD VIBES</div></div>
        <div className="top-cluster"><div className="pill">{live.weather === "rain" ? "🌧" : "🌤"} {live.clock}</div><div className="pill">🪙 <strong>${live.money}</strong></div><div className="pill">★ {live.rating.toFixed(1)}</div></div>
        <div className={`mission-card ${live.phase === "dropoff" ? "on-ride" : ""}`}>
          <div className="mission-overline">{live.phase === "pickup" ? "NEW RIDE REQUEST" : "PASSENGER ON BOARD"}</div>
          <div className="mission-rider"><span className="rider-avatar">{live.rider.emoji}</span><div><div className="mission-title">{live.rider.name}</div><div className="rider-pref">{live.rider.preference}</div></div></div>
          <div className="mission-separator" />
          <div className="mission-destination"><span>{live.phase === "pickup" ? "接客地點" : "目的地"}</span><strong>{live.stop.icon} {live.stop.name}</strong></div>
          <div className="mission-bottom"><span><span className="nav-arrow" style={{ transform: `rotate(${live.navAngle}deg)` }}>↑</span> {live.distance} m</span>{live.phase === "dropoff" && <span className={live.timer < 20 ? "timer-urgent" : ""}>⏱ {live.timer}s</span>}</div>
          {live.phase === "dropoff" && <div className="comfort-track"><div style={{ width: `${live.comfort}%` }} /></div>}
        </div>
        {live.notification && started && <div className="notification">{live.notification}</div>}
        {live.canInteract && started && <div className="interact-prompt"><span>E</span> {live.phase === "pickup" ? "讓乘客上車" : "讓乘客下車"}</div>}
        <div className="level-chip">LV.{live.level}<span> · {live.rides} 趟旅程</span></div>
        {live.drift > 0.25 && <div className="drift-meter"><span>{live.drift > 3.5 ? "SUPER" : live.drift > 1.7 ? "NICE" : "DRIFT"}</span><div><i style={{ width: `${Math.min(live.drift / 5 * 100, 100)}%` }} /></div></div>}
        <canvas ref={mapRef} className="mini-map" width="142" height="142" aria-label="城市導航地圖" />
        <div className="district">📍 {live.district}<small>CAPYBARA BAY</small></div>
        <div className="control-note"><span><i className="key">W A S D</i> 開車</span><span><i className="key">SHIFT</i> 甩尾</span><span><i className="key">E</i> 接送</span><span><i className="key">H</i> 喇叭</span><span><i className="key">M</i> 手機</span></div>
        <div className={`speed-panel ${live.boosting ? "boosting" : ""}`}><div className="speed-value">{live.speed}</div><div className="speed-unit">{live.boosting ? "⚡ BOOST" : "KM / H"}</div></div>
        <button className="phone-trigger" onClick={() => setPhoneOpen((value) => !value)} aria-label="打開水豚手機">📱</button>
        <div className="mobile-controls">
          <div className="steer-buttons"><button onPointerDown={() => hold("KeyA", true)} onPointerUp={() => hold("KeyA", false)} onPointerLeave={() => hold("KeyA", false)}>◀</button><button onPointerDown={() => hold("KeyD", true)} onPointerUp={() => hold("KeyD", false)} onPointerLeave={() => hold("KeyD", false)}>▶</button></div>
          <div className="action-buttons"><button className="brake-touch" onPointerDown={() => hold("KeyS", true)} onPointerUp={() => hold("KeyS", false)} onPointerLeave={() => hold("KeyS", false)}>煞車</button><button className="gas-touch" onPointerDown={() => hold("KeyW", true)} onPointerUp={() => hold("KeyW", false)} onPointerLeave={() => hold("KeyW", false)}>前進</button><button className="interact-touch" onClick={() => actionRef.current?.interact()}>E</button></div>
        </div>
      </div>
      {phoneOpen && started && (
        <aside className="phone-screen" aria-label="水豚手機">
          <div className="phone-top"><span>{live.clock}</span><button onClick={() => setPhoneOpen(false)} aria-label="關閉手機">×</button></div>
          <div className="phone-wallpaper"><span>🍊</span><div>今天也是好日子</div></div>
          <div className="phone-stats"><div><strong>${live.money}</strong><span>錢包</span></div><div><strong>{live.rides}</strong><span>完成趟數</span></div><div><strong>{live.rating.toFixed(1)}</strong><span>評分</span></div></div>
          <div className="phone-apps"><button onClick={() => setGarageOpen(true)}><span>🛠️</span>車庫升級</button><button onClick={() => actionRef.current?.toggleAudio()}><span>{live.music ? "🎵" : "🔇"}</span>{live.music ? "音效開啟" : "音效關閉"}</button><button onClick={() => actionRef.current?.horn()}><span>📣</span>按個喇叭</button><button onClick={() => actionRef.current?.interact()}><span>🚕</span>接送乘客</button></div>
          <div className="phone-quote">「再忙也要看看海。」</div>
        </aside>
      )}
      {garageOpen && (
        <section className="garage-overlay" onClick={(event) => { if (event.target === event.currentTarget) setGarageOpen(false); }}>
          <div className="garage-card"><button className="garage-close" onClick={() => setGarageOpen(false)}>×</button><div className="garage-eyebrow">CAPY CUSTOMS</div><h2>小黃升級車庫</h2><p>把賺來的小費，變成更舒服的下一趟旅程。</p>
            {(["engine", "comfort", "boost"] as UpgradeKey[]).map((key) => {
              const level = live.upgrades[key];
              const cost = (key === "engine" ? 180 : key === "comfort" ? 150 : 210) * (level + 1);
              const label = key === "engine" ? "⚡ 暖呼呼引擎" : key === "comfort" ? "🛋️ 雲朵座椅" : "🔥 漂移小渦輪";
              const detail = key === "engine" ? "提升加速度與最高速度" : key === "comfort" ? "減少碰撞影響、增加小費" : "增加甩尾加速的持續時間";
              return <div className="upgrade-row" key={key}><div><strong>{label}</strong><span>{detail}</span><span className="upgrade-dots">{"●".repeat(level)}{"○".repeat(3 - level)}</span></div><button disabled={level >= 3 || live.money < cost} onClick={() => purchase(key)}>{level >= 3 ? "MAX" : `$${cost}`}</button></div>;
            })}
            <div className="garage-wallet">目前錢包：<strong>${live.money}</strong></div>
          </div>
        </section>
      )}
      {!started && (
        <section className="intro" aria-label="遊戲開始畫面">
          <div className="intro-panel">
            <div className="intro-hero" role="img" aria-label="卡皮巴拉開著黃色計程車遊覽海港城市" />
            <div className="intro-tag">🚕 單人遊玩 · 慢活計程車宇宙</div>
            <h1>CAPY<span>CAB</span></h1>
            <div className="intro-subtitle">卡皮巴拉計程車</div>
            <p className="intro-copy">在一座海風很舒服的小城裡，開著你的小黃接送每位有故事的乘客。偶爾甩尾，永遠 chill。</p>
            <button className="start-button" onClick={begin}>開始今天的營業 →</button>
            <div className="intro-controls">W A S D 開車　·　Shift 甩尾　·　E 接客　·　M 手機</div>
          </div>
        </section>
      )}
    </main>
  );
}
