import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Coordinates } from "./game-core";
import {
  CITY_LINE, CITY_LINE_STATIONS, CITY_LINE_STATION_COLUMNS, CITY_LINE_STATION_HALF, CITY_LINE_TRAIN,
  cityLineTrainState,
} from "./city-line";

/** Car floor above the rail head; platforms are built level with it. */
const FLOOR_ABOVE_RAIL = 1.05;
const PLATFORM_EDGE = CITY_LINE.track + 1.62;
const PLATFORM_OUTER = 8.6;
const PLATFORM_HALF = 26;
const CONCOURSE_DROP = 7.4;

type Materials = Record<"shell" | "roof" | "glass" | "skylight" | "concrete" | "steel" | "rail" | "green" | "paving" | "trainBody" | "trainWindow" | "bogie" | "screen", THREE.MeshStandardMaterial>;

function createMaterials(): Materials {
  const standard = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    shell: standard("#eef1ef", 0.42, 0.08),
    roof: standard("#d9dedd", 0.32, 0.55),
    glass: standard("#22343b", 0.12, 0.45),
    skylight: standard("#58707a", 0.08, 0.5),
    concrete: standard("#c9c6bd", 0.82),
    steel: standard("#8f9699", 0.38, 0.7),
    rail: standard("#6d7072", 0.3, 0.85),
    green: standard("#7cbf3c", 0.4, 0.05),
    paving: standard("#b8b4aa", 0.9),
    trainBody: standard("#f3f5f4", 0.28, 0.2),
    trainWindow: standard("#141c20", 0.08, 0.6),
    bogie: standard("#2c2f31", 0.6, 0.5),
    screen: standard("#9fb7bd", 0.06, 0.3, { transparent: true, opacity: 0.42, depthWrite: false }),
  };
}

function signTexture(id: string, name: string, english: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f6f7f5"; context.fillRect(0, 0, 1024, 256);
    context.fillStyle = "#7cbf3c"; context.fillRect(0, 226, 1024, 30);
    context.beginPath(); context.arc(128, 113, 82, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ffffff"; context.font = "bold 76px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(id, 128, 116);
    context.fillStyle = "#24302b"; context.textAlign = "left"; context.font = "bold 92px 'Noto Sans TC', sans-serif";
    context.fillText(name, 250, 96);
    context.fillStyle = "#5d6b64"; context.font = "500 46px sans-serif";
    context.fillText(english, 254, 182);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/** Long white roof shell: a shallow arch whose eaves curl down, extruded with rounded ends. */
function roofShellGeometry(halfWidth: number, length: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -1.25);
  shape.quadraticCurveTo(-halfWidth - 0.3, 0.05, -halfWidth + 1.8, 0.3);
  shape.quadraticCurveTo(0, 0.85, halfWidth - 1.8, 0.3);
  shape.quadraticCurveTo(halfWidth + 0.3, 0.05, halfWidth, -1.25);
  shape.lineTo(halfWidth - 0.45, -1.25);
  shape.quadraticCurveTo(halfWidth - 0.3, -0.25, halfWidth - 1.9, -0.12);
  shape.quadraticCurveTo(0, 0.4, -halfWidth + 1.9, -0.12);
  shape.quadraticCurveTo(-halfWidth + 0.3, -0.25, -halfWidth + 0.45, -1.25);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, steps: 1, curveSegments: 14, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.35, bevelSegments: 4 });
  geometry.translate(0, 0, -length / 2);
  return geometry;
}

/** A flowing facade ribbon: a flattened tube that undulates along the platform. */
function ribbonGeometry(side: number, baseY: number, phase: number, length: number) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const z = -length / 2 + length * i / 24;
    const swell = Math.sin(z * 0.11 + phase);
    points.push(new THREE.Vector3(side * (10.55 + 0.45 * swell), baseY + 0.55 * Math.sin(z * 0.075 + phase * 1.7), z));
  }
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.32, 6, false);
  // Flatten the tube into a fin that leans slightly outward.
  const position = geometry.getAttribute("position");
  const center = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const t = (z + length / 2) / length;
    const anchor = Math.floor(t * 24);
    center.copy(points[Math.min(24, Math.max(0, anchor))]);
    const dy = position.getY(i) - center.y, dx = position.getX(i) - center.x;
    position.setXYZ(i, center.x + dx * 0.35 + side * dy * 0.25, center.y + dy * 1.9, z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Merge mixed indexed / non-indexed primitives into one draw call. */
function merge(parts: THREE.BufferGeometry[]) {
  const normalized = parts.map(part => {
    const flat = part.index ? part.toNonIndexed() : part.clone();
    for (const name of Object.keys(flat.attributes)) if (!["position", "normal", "uv"].includes(name)) flat.deleteAttribute(name);
    flat.clearGroups();
    return flat;
  });
  const merged = mergeGeometries(normalized);
  normalized.forEach(part => part.dispose());
  if (!merged) throw new Error("Green line geometry could not be merged");
  return merged;
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}

export class CityLineScene {
  readonly root = new THREE.Group();
  readonly trains: THREE.Group[] = [];
  private readonly materials = createMaterials();
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly piers: readonly Coordinates[];

  constructor(private readonly scene: THREE.Scene, piers: readonly Coordinates[] | undefined, private readonly ground: (point: Coordinates) => number) {
    this.piers = piers ?? [];
    this.root.name = "海灣綠線 / elevated downtown line, stations and trains";
    this.buildViaduct();
    CITY_LINE_STATIONS.forEach((station, index) => this.buildStation(index));
    for (const [index, side] of [-1, 1].entries()) this.trains.push(this.buildTrain(side, index));
    scene.add(this.root);
    scene.userData.staticShadowRevision = (scene.userData.staticShadowRevision ?? 0) + 1;
    scene.userData.shadowActorsRevision = (scene.userData.shadowActorsRevision ?? 0) + 1;
    this.update(0);
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string, parent: THREE.Object3D = this.root, shadow = true) {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildViaduct() {
    const { x, railY, girderDepth, north, south } = CITY_LINE;
    const length = south - north, centerZ = (north + south) / 2;
    const deckTop = railY - 0.42;
    // Box girder with tapered soffit: one extrusion for the whole line.
    const section = new THREE.Shape();
    section.moveTo(-4.75, 0); section.lineTo(4.75, 0); section.lineTo(4.75, -0.55);
    section.lineTo(2.9, -girderDepth); section.lineTo(-2.9, -girderDepth); section.lineTo(-4.75, -0.55); section.closePath();
    const girder = new THREE.ExtrudeGeometry(section, { depth: length, bevelEnabled: false, steps: 1 });
    girder.translate(x, deckTop, north);
    this.mesh(girder, this.materials.concrete, "Green line box-girder viaduct");
    const details = merge([
      box(0.28, 1.0, length, x - 4.6, deckTop + 0.5, centerZ), box(0.28, 1.0, length, x + 4.6, deckTop + 0.5, centerZ),
      box(1.9, 0.22, length, x - CITY_LINE.track, deckTop + 0.11, centerZ), box(1.9, 0.22, length, x + CITY_LINE.track, deckTop + 0.11, centerZ),
    ]);
    this.mesh(details, this.materials.shell, "Green line parapets and track plinths");
    const rails = merge([-1, 1].flatMap(track => [-0.7175, 0.7175].map(gauge => box(0.08, 0.2, length, x + track * CITY_LINE.track + gauge, deckTop + 0.32, centerZ))));
    this.mesh(rails, this.materials.rail, "Green line running rails", this.root, false);
    // Hammerhead piers on clear ground.
    const shaft = new THREE.CylinderGeometry(1, 1.12, 1, 20).translate(0, 0.5, 0).scale(1.05, 1, 0.82);
    const cap = new RoundedBoxGeometry(6.2, 1.3, 2.6, 2, 0.25);
    const shafts = new THREE.InstancedMesh(shaft, this.materials.concrete, this.piers.length);
    const caps = new THREE.InstancedMesh(cap, this.materials.concrete, this.piers.length);
    this.geometries.push(shaft, cap);
    const matrix = new THREE.Matrix4();
    this.piers.forEach((pier, index) => {
      const base = this.ground(pier) - 0.4;
      const height = deckTop - girderDepth - 1.3 - base;
      shafts.setMatrixAt(index, matrix.makeScale(1, height, 1).setPosition(pier.x, base, pier.z));
      caps.setMatrixAt(index, matrix.makeTranslation(pier.x, deckTop - girderDepth - 0.65, pier.z));
    });
    for (const [mesh, name] of [[shafts, "Green line viaduct piers"], [caps, "Green line pier caps"]] as const) {
      mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); this.root.add(mesh);
    }
  }

  private buildStation(index: number) {
    const station = CITY_LINE_STATIONS[index];
    const group = new THREE.Group();
    group.name = `${station.id} ${station.name}`;
    group.position.set(CITY_LINE.x, 0, station.z);
    this.root.add(group);
    const m = this.materials;
    const ground = this.ground({ x: CITY_LINE.x, z: station.z });
    const platformY = CITY_LINE.railY + FLOOR_ABOVE_RAIL;
    const concourseY = CITY_LINE.railY - CONCOURSE_DROP;
    const roofY = platformY + 6.6;
    const half = CITY_LINE_STATION_HALF;

    // Street-level plaza paving under the station.
    this.mesh(box(half.x * 2, 0.12, half.z * 2, 0, ground + 0.06, 0), m.paving, `${station.id} plaza paving`, group, false);
    // Oval columns carrying the concourse.
    const column = new THREE.CylinderGeometry(0.62, 0.72, 1, 18).translate(0, 0.5, 0).scale(1.15, 1, 0.8);
    const columns = merge(CITY_LINE_STATION_COLUMNS.map(c => column.clone().scale(1, concourseY - 0.7 - ground, 1).translate(c.x, ground, c.z)));
    column.dispose();
    this.mesh(columns, m.shell, `${station.id} columns`, group);

    // Concourse: white slab, dark glazing, white bands.
    this.mesh(new RoundedBoxGeometry(half.x * 2 - 1.2, 0.8, half.z * 2 - 2, 2, 0.3).translate(0, concourseY - 0.4, 0), m.shell, `${station.id} concourse slab`, group);
    this.mesh(box(half.x * 2 - 2, 4.2, half.z * 2 - 4, 0, concourseY + 2.1, 0), m.glass, `${station.id} concourse glazing`, group);
    const bands = merge([0.15, 2.05, 3.95].map(y => new RoundedBoxGeometry(half.x * 2 - 1.6, 0.34, half.z * 2 - 3, 2, 0.15).translate(0, concourseY + y, 0)));
    this.mesh(bands, m.shell, `${station.id} concourse bands`, group);

    // Solid white band between the concourse and the platforms (the track girder runs inside it).
    this.mesh(box(half.x * 2 - 2.4, platformY - 0.5 - (concourseY + 4.2), half.z * 2 - 5, 0, (platformY - 0.5 + concourseY + 4.2) / 2, 0), m.glass, `${station.id} mid-level glazing`, group);
    // Platform level: side platforms, screen doors, outer glazing and fascia.
    const platformWidth = PLATFORM_OUTER - PLATFORM_EDGE;
    const platforms = merge([-1, 1].map(side => box(platformWidth, 0.5, PLATFORM_HALF * 2, side * (PLATFORM_EDGE + platformWidth / 2), platformY - 0.25, 0)));
    this.mesh(platforms, m.paving, `${station.id} side platforms`, group);
    const edges = merge([-1, 1].map(side => box(0.35, 0.02, PLATFORM_HALF * 2, side * (PLATFORM_EDGE + 0.3), platformY + 0.011, 0)));
    this.mesh(edges, m.green, `${station.id} tactile edge`, group, false);
    const doors = merge([-1, 1].map(side => box(0.06, 1.55, PLATFORM_HALF * 2 - 1, side * (PLATFORM_EDGE + 0.1), platformY + 0.78, 0)));
    this.mesh(doors, m.screen, `${station.id} half-height platform screen doors`, group, false);
    const doorFrames = merge([-1, 1].flatMap(side => Array.from({ length: 14 }, (_, i) => box(0.12, 1.62, 0.12, side * (PLATFORM_EDGE + 0.1), platformY + 0.81, -PLATFORM_HALF + 1 + i * (PLATFORM_HALF * 2 - 2) / 13))));
    this.mesh(doorFrames, m.steel, `${station.id} screen door frames`, group, false);
    this.mesh(merge([-1, 1].map(side => box(0.25, 3.4, half.z * 2 - 6, side * (PLATFORM_OUTER + 0.4), platformY + 1.7, 0))), m.glass, `${station.id} platform glazing`, group);
    // Platform floor carried across the concourse-to-platform gap.
    this.mesh(merge([-1, 1].map(side => box(platformWidth + 0.8, CONCOURSE_DROP - 0.2, 0.6, side * (PLATFORM_EDGE + platformWidth / 2), concourseY + (CONCOURSE_DROP - 0.2) / 2 + 0.2, -half.z + 4))), m.shell, `${station.id} stair cores`, group);

    // Flowing white fins wrapping the long sides (the station's signature look).
    const fins: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) fins.push(ribbonGeometry(side, concourseY + 4.6 + i * 1.08, i * 0.9 + (side > 0 ? 1.3 : 0), half.z * 2 - 4));
    this.mesh(merge(fins), m.shell, `${station.id} flowing facade fins`, group);
    fins.forEach(geometry => geometry.dispose());

    // Roof shell, roof supports and the ribbed skylight lantern.
    this.mesh(roofShellGeometry(half.x + 1.4, half.z * 2 - 2).translate(0, roofY, 0), m.roof, `${station.id} roof shell`, group);
    const supports = merge([-1, 1].flatMap(side => [-20, -6, 6, 20].map(z => box(0.45, roofY - platformY - 0.8, 0.45, side * (PLATFORM_OUTER - 0.4), platformY + (roofY - platformY - 0.8) / 2, z))));
    this.mesh(supports, m.steel, `${station.id} roof columns`, group);
    this.mesh(box(4.6, 0.7, 20, 0, roofY + 1.35, 13), m.skylight, `${station.id} skylight lantern`, group, false);
    const slats = merge(Array.from({ length: 11 }, (_, i) => box(4.9, 0.32, 0.22, 0, roofY + 1.82, 3.6 + i * 1.9)));
    this.mesh(slats, m.shell, `${station.id} skylight slats`, group);

    // Ground entrance pavilion with lift and stair to the concourse.
    const entranceZ = -half.z + 4.5;
    this.mesh(box(8.4, 4.4, 6.4, 0, ground + 2.2, entranceZ), m.glass, `${station.id} entrance pavilion`, group);
    this.mesh(new RoundedBoxGeometry(9.4, 0.5, 7.4, 2, 0.2).translate(0, ground + 4.65, entranceZ), m.shell, `${station.id} entrance canopy`, group);
    this.mesh(box(2.6, concourseY - ground, 2.6, 2.4, ground + (concourseY - ground) / 2, entranceZ + 0.6), m.glass, `${station.id} lift shaft`, group);

    // Station name boards on both long sides and on the entrance.
    const texture = signTexture(station.id, station.name, station.english);
    this.textures.push(texture);
    const signMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
    const sign = new THREE.PlaneGeometry(12, 3);
    for (const side of [-1, 1]) {
      const board = this.mesh(sign.clone(), signMaterial, `${station.id} station name board`, group, false);
      board.position.set(side * (half.x - 0.95), concourseY + 2.1, 0);
      board.rotation.y = side * Math.PI / 2;
    }
    const entranceSign = this.mesh(new THREE.PlaneGeometry(7, 1.75), signMaterial, `${station.id} entrance sign`, group, false);
    entranceSign.position.set(0, ground + 3.4, entranceZ - 3.22);
    entranceSign.rotation.y = Math.PI;
    sign.dispose();
  }

  private buildTrain(side: number, index: number) {
    const m = this.materials;
    const train = new THREE.Group();
    train.name = `Green line train ${index + 1}`;
    train.userData.dynamicWorldObject = true;
    const { carLength, gap, cars } = CITY_LINE_TRAIN;
    const span = cars * carLength + (cars - 1) * gap;
    const parts: Record<"body" | "window" | "green" | "bogie", THREE.BufferGeometry[]> = { body: [], window: [], green: [], bogie: [] };
    for (let car = 0; car < cars; car++) {
      const z = -span / 2 + carLength / 2 + car * (carLength + gap);
      const front = car === 0 ? -1 : car === cars - 1 ? 1 : 0;
      parts.body.push(new RoundedBoxGeometry(2.9, 3.35, carLength, 4, 0.55).translate(0, 2.15, z));
      parts.window.push(box(2.94, 0.95, carLength - 3.4, 0, 2.55, z));
      parts.green.push(box(2.93, 0.32, carLength - 1.2, 0, 1.15, z), box(2.93, 0.08, carLength - 2.6, 0, 3.22, z));
      for (const door of [-1, 1]) parts.window.push(box(2.95, 2.0, 1.3, 0, 1.95, z + door * carLength * 0.22));
      parts.bogie.push(box(2.3, 0.8, 2.6, 0, 0.55, z - carLength * 0.32), box(2.3, 0.8, 2.6, 0, 0.55, z + carLength * 0.32));
      if (front) {
        const cab = z + front * (carLength / 2 - 0.35);
        parts.window.push(new RoundedBoxGeometry(2.55, 1.5, 0.5, 3, 0.2).translate(0, 2.55, cab));
        parts.green.push(new RoundedBoxGeometry(2.6, 0.55, 0.42, 2, 0.15).translate(0, 1.35, cab));
      }
    }
    const meshes: Array<[keyof typeof parts, THREE.Material]> = [["body", m.trainBody], ["window", m.trainWindow], ["green", m.green], ["bogie", m.bogie]];
    for (const [key, material] of meshes) {
      const merged = merge(parts[key]);
      parts[key].forEach(geometry => geometry.dispose());
      this.mesh(merged, material, `${train.name} ${key}`, train, key !== "window");
    }
    train.position.set(CITY_LINE.x + side * CITY_LINE.track, CITY_LINE.railY - 0.05, 0);
    train.userData.phase = index * 0.5;
    this.root.add(train);
    return train;
  }

  /** Move the trains along their tracks from simulation time (seconds). */
  update(seconds: number) {
    for (const train of this.trains) {
      const state = cityLineTrainState(seconds, train.userData.phase as number);
      train.position.z = state.z;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.geometries.forEach(geometry => geometry.dispose());
    this.textures.forEach(texture => texture.dispose());
    Object.values(this.materials).forEach(material => material.dispose());
    this.root.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh && !(mesh.material as THREE.Material).userData?.shared) (mesh.material as THREE.Material).dispose(); });
  }
}
