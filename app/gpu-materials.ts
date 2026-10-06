import * as THREE from 'three';
import { METRO_STATIONS, METRO_TERRAIN_PATCH, metroConcourse, metroStreetApproach } from './metro-system';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Fn, abs, float, fract, materialColor, materialEmissive, max, min, mix, normalWorld, positionGeometry, positionWorld, smoothstep, step, texture, uniform, varying, vec2, vec3 } from 'three/tsl';

/** Keep the authored PBR maps and their transforms when adding GPU shader nodes. */
export function standardNodeMaterial(source: THREE.MeshStandardMaterial) {
  return new MeshStandardNodeMaterial().copy(source);
}

export function createGpuSky() {
  const skyUniforms = {
    zenith: uniform(new THREE.Color('#4f8fbe')),
    horizon: uniform(new THREE.Color('#dce9ee')),
    hazeColor: uniform(new THREE.Color('#c9dadd')),
    sunDirection: uniform(new THREE.Vector3(-45, 78, -36).normalize()),
  };
  const material = Object.assign(new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false }), { skyUniforms });
  const skyDirection = varying(positionGeometry.normalize());
  material.colorNode = Fn(() => {
    const direction = skyDirection.normalize();
    const height = direction.y.mul(.74).add(.12).clamp(0, 1);
    const graded = mix(skyUniforms.horizon, skyUniforms.zenith, height.pow(.72));
    const haze = smoothstep(.01, .32, max(direction.y, 0)).oneMinus().mul(.48);
    const alignment = max(direction.dot(skyUniforms.sunDirection), 0);
    return mix(graded, skyUniforms.hazeColor, haze)
      .add(vec3(1, .83, .58).mul(alignment.pow(148).mul(.74)))
      .add(vec3(.12, .08, .035).mul(alignment.pow(8)));
  })();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1850, 36, 22), material);
  sky.name = 'WebGPU physically graded Taiwanese city sky'; sky.renderOrder = -100;
  return sky;
}

/** River and tunnel excavation applies to color and native GPU shadow passes. */
export function terrainVisibilityNode(cutStationParcels = true, cutStationPaving = false) {
  const channel = [[616,-980],[616,-820],[624,-560],[628,-260],[616,-30],[630,230],[620,500],[632,820],[628,980]];
  let visible = positionWorld.x.greaterThan(1618).and(positionWorld.x.lessThan(2142))
    .and(abs(positionWorld.z.sub(510)).lessThan(5.35))
    .and(positionWorld.y.lessThan(positionWorld.x.sub(1590).mul(.002).add(61.105237))).not();
  for (let i = 1; i < channel.length; i++) {
    const a = vec2(...channel[i - 1] as [number, number]), b = vec2(...channel[i] as [number, number]);
    const d = b.sub(a), delta = positionWorld.xz.sub(a), t = delta.dot(d).div(d.dot(d));
    const cut = t.greaterThanEqual(0).and(t.lessThanEqual(1)).and(delta.sub(d.mul(t.clamp(0, 1))).length().lessThan(19));
    visible = visible.and(cut.not());
  }
  if (cutStationParcels) for (const station of METRO_STATIONS) {
    const patch = METRO_TERRAIN_PATCH;
    const cut = abs(positionWorld.x.sub(station.x + patch.offsetX)).lessThan(patch.width / 2)
      .and(abs(positionWorld.z.sub(patch.z)).lessThan(patch.depth / 2));
    visible = visible.and(cut.not());
  }
  if (cutStationPaving) for (let index = 0; index < METRO_STATIONS.length; index++) {
    for (const area of [metroConcourse(index), metroStreetApproach(index)]) {
      const cut = abs(positionWorld.x.sub(area.x)).lessThan(area.halfWidth)
        .and(abs(positionWorld.z.sub(area.z)).lessThan(area.halfDepth));
      visible = visible.and(cut.not());
    }
  }
  return visible;
}

export function concreteAggregateNode(aggregate: THREE.Texture) {
  const weights = abs(normalWorld).pow(4);
  const normalized = weights.div(max(weights.dot(vec3(1)), .0001));
  const sample = texture(aggregate, positionWorld.yz.mul(.65)).rgb.mul(normalized.x)
    .add(texture(aggregate, positionWorld.xz.mul(.65)).rgb.mul(normalized.y))
    .add(texture(aggregate, positionWorld.xy.mul(.65)).rgb.mul(normalized.z));
  const joint = smoothstep(.006, .018, abs(fract(positionWorld.y.div(2.4)).sub(.5)).mul(2.4)).oneMinus();
  const damp = smoothstep(0, 1.1, positionWorld.y).oneMinus();
  return materialColor.mul(sample.mul(float(1).sub(joint.mul(.11)).sub(damp.mul(.08))));
}

export function createRiderGpuMotion(modelHeight: number) {
  const body = { pitch: uniform(0), sway: uniform(0), bob: uniform(0), wheelAngle: uniform(0), frontSteer: uniform(0) };
  const lamps = uniform(new THREE.Vector4(.35, 0, 0, .25));
  const local = varying(positionGeometry);
  const pivot = modelHeight * .37;
  const positionNode = Fn(() => {
    const weight = smoothstep(pivot, modelHeight * .64, positionGeometry.y);
    const p = positionGeometry.sub(vec3(0, pivot, 0)).toVar();
    const pitch = body.pitch.mul(weight), sway = body.sway.mul(weight);
    p.yz.assign(vec2(p.y.mul(pitch.cos()).add(p.z.mul(pitch.sin())), p.z.mul(pitch.cos()).sub(p.y.mul(pitch.sin()))));
    p.xy.assign(vec2(p.x.mul(sway.cos()).add(p.y.mul(sway.sin())), p.y.mul(sway.cos()).sub(p.x.mul(sway.sin()))));
    return p.add(vec3(0, body.bob.mul(weight).add(pivot), 0));
  })();
  const lampHeight = step(.16, local.y).mul(step(.57, local.y).oneMinus());
  const red = step(materialColor.g.mul(1.65), materialColor.r).mul(step(materialColor.b.mul(1.8), materialColor.r)).mul(step(.12, materialColor.r));
  const amber = step(materialColor.b.mul(2.4), materialColor.g).mul(step(materialColor.g.mul(1.05), materialColor.r)).mul(step(materialColor.r.mul(.27), materialColor.g));
  const rear = step(.35, local.x).mul(lampHeight), front = step(-.23, local.x).oneMinus().mul(lampHeight);
  const signal = mix(lamps.z, lamps.y, step(0, local.z));
  const head = front.mul(step(.38, local.y)).mul(step(.065, abs(local.z)).oneMinus()).mul(step(.45, min(materialColor.r, min(materialColor.g, materialColor.b))));
  const emissiveNode = materialEmissive
    .add(vec3(1, .025, .008).mul(red.mul(rear).mul(lamps.x)))
    .add(vec3(1, .32, .005).mul(amber.mul(max(rear, front)).mul(step(.045, abs(local.z))).mul(signal)))
    .add(vec3(1, .88, .65).mul(head.mul(lamps.w)));
  return { body, lamps, positionNode, emissiveNode };
}
