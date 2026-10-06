import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";

test("gameplay and showroom retain the original PBR model", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("const DRIVING_MODEL = CHARACTER_MODEL;"));
  const document = await new NodeIO().read(new URL("../public/models/capybara-premium-original.glb", import.meta.url).pathname);
  assert.equal(document.getRoot().listTextures().length, 3);
  assert.ok(document.getRoot().listMaterials()[0].getNormalTexture());
});

test("the playable rider loads a real GLB mesh instead of a directional Sprite", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  assert.match(source, /new GLTFLoader\(\)\.load\(CHARACTER_MODEL/);
  assert.doesNotMatch(source, /const (?:character|model|scooter) = new THREE\.Sprite\(/);
  assert.doesNotMatch(source, /const (?:character|model|scooter)Material = new THREE\.SpriteMaterial\(/);
  assert.doesNotMatch(source, /function createDistrict\(/);
  assert.match(source, /new OrbitControls\(camera, canvas\)/);
  assert.match(source, /constrainedDevice \? 1 : 1\.2/);
  assert.match(source, /constrainedDevice \? 768 : 1024/);
  assert.match(source, /world\.nearbyStaticObstacles\(state, 42, vertical\.height\)/);
});

test("the complete supplied road pack stays curated while only the dimension-matched landmark bridge is visible", async () => {
  const modelPath = new URL("../public/models/supplied-road-pack-optimized.glb", import.meta.url).pathname;
  const bytes = await readFile(modelPath);
  const document = await new NodeIO().read(modelPath);
  const nodeNames = document.getRoot().listNodes().map((node) => node.getName());
  for (const name of ["RoadStraight", "RoadCurve", "RoadCross", "SingleLaneStraight", "HighwayStraight", "HighwayCurve", "FreewayStraight", "FreewayCurve", "FreewayRamp", "FreewayMerge", "StackInterchange", "SuspensionBridge", "HighwayBridge", "ParkingLotCenter", "ParkingLotEntrance", "TunnelCurve", "TunnelPortal"]) {
    assert.ok(nodeNames.includes(`SuppliedRoadPack_${name}`), `The curated road pack is missing ${name}`);
  }
  assert.ok(bytes.length < 2_000_000, `The web road pack is too heavy at ${bytes.length} bytes`);
  assert.equal(document.getRoot().listMeshes().length, 31);
  assert.equal(document.getRoot().listMaterials().length, 1, "All supplied modules should share one palette material");
  assert.equal(document.getRoot().listTextures().length, 1, "Reuse the supplied embedded road palette rather than adding texture requests");
  const triangles = document.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  assert.ok(triangles < 18_000, `The selected city-road, bridge and interchange modules contain ${triangles} triangles`);
  const source = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  assert.match(source, /supplied-road-pack-optimized\.glb\?v=landmark-bridge-8/);
  assert.match(source, /Dimension-matched supplied road-pack landmark bridge/);
  assert.match(source, /Supplied suspension bridge fitted only to the matching river span/);
  assert.match(source, /render_width: 16/);
  assert.match(source, /suspension\.scale\.set\(0\.78, 0\.17, 1\)/);
  assert.match(source, /620 - suspensionCenter\.x/);
  assert.match(source, /authored at local Y≈15/);
  assert.match(source, /\+ 3\.22, -300/);
  assert.doesNotMatch(source, /\+ 5\.74, -300/);
  assert.match(source, /useSuppliedSignatureBridge/);
  assert.match(source, /createMountainTunnel/);
  assert.match(source, /Three-dimensional elevated-road support pillars/);
  assert.match(source, /Continuous structural bridge box girders/);
  assert.match(source, /Continuous architectural bridge-edge fascias/);
  assert.match(source, /Integrated arched cross-river bridge ribs/);
  assert.match(source, /北城分離式出口/);
  assert.match(source, /Welded elevated-road junction platforms/);
  assert.match(source, /Tapered architectural pier shafts/);
  assert.doesNotMatch(source, /Supplied four-level stack interchange embedded in the downtown expressway/);
  assert.doesNotMatch(source, /GridForge-snapped supplied elevated-highway modules/);
  assert.doesNotMatch(source, /GridForge-snapped supplied urban bridge modules/);
  assert.doesNotMatch(source, /createSnappedModules/);
  assert.doesNotMatch(source, /fallback\.visible = false/);
});

test("moving traffic loads complete realistic vehicles and new downloaded articulated animal riders", async () => {
  const source=await readFile(new URL("../app/real-world-map.ts",import.meta.url),"utf8");
  for(const kind of ["tesla","bmw","ferrari-spider","motorcycle"]) {
    const modelPath=new URL(`../public/models/traffic-real/${kind}.glb`,import.meta.url).pathname;
    const bytes=await readFile(modelPath);assert.equal(bytes.toString("ascii",0,4),"glTF");
    assert.ok(bytes.length<8_000_000,"Bounded detailed vehicle download, shared by the entire fleet");
    const document=await new NodeIO().read(modelPath);
    const wheels=document.getRoot().listNodes().filter(n=>/^Wheel_[FR](?:[LR])?$/.test(n.getName()));
    assert.equal(wheels.length,kind==="motorcycle"?2:4);
    assert.ok(document.getRoot().listMaterials().some(m=>m.getName().startsWith("Brake")));
    assert.ok(source.includes("/models/traffic-real/"+kind+".glb"));
  }
  for(const kind of ["bear","bunny","pig"]) {
    const document=await new NodeIO().read(new URL(`../public/models/animal-riders/${kind}.glb`,import.meta.url).pathname);
    assert.ok(document.getRoot().listMeshes().length>0);assert.ok(document.getRoot().listSkins().length>0,"Preserve an articulated animal");
  }
  assert.match(source,/fitScooterRider/);assert.match(source,/trafficReady/);
  const credits=await readFile(new URL("../public/models/traffic-real/ASSET-SOURCES.md",import.meta.url),"utf8");
  for(const author of ["David_Holiday","vecarz","vicent091036","Nik Lever"])assert.ok(credits.includes(author));
  assert.ok((await stat(new URL("../public/models/traffic-real/motorcycle-source.glb",import.meta.url))).size>1_000_000);
});

test("the playable GLB is the user's exact intact high-detail single-character Tripo model", async () => {
  const modelPath = new URL("../public/models/capybara-premium-original.glb", import.meta.url).pathname;
  const bytes = await readFile(modelPath);
  const metadata = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  const document = await new NodeIO().read(modelPath);
  const meshes = document.getRoot().listMeshes();
  const materials = document.getRoot().listMaterials();
  const textures = document.getRoot().listTextures();
  assert.equal(metadata.asset.generator, "Tripo");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "a2769c9c299c04c9699fd578bec536f076d9be309dc26a3232e15019aaefee7e", "Ship the exact original uploaded model without replacing or cutting it");
  assert.equal(meshes.length, 1, "Preserve the supplied single continuous premium character mesh");
  assert.equal(document.getRoot().listNodes().length, 1, "Do not invent replacement body parts or detach geometry");
  assert.equal(document.getRoot().listAnimations().length, 0, "The source is static; animate its original geometry non-destructively at runtime");
  assert.equal(materials.length, 1, "Preserve the supplied unified PBR material");
  assert.equal(textures.length, 3, "Preserve the supplied base-color, normal and metallic/roughness textures");
  assert.ok(materials[0].getBaseColorTexture(), "The original 2K base-color texture must remain attached");
  assert.ok(materials[0].getNormalTexture(), "The original normal-detail texture must remain attached");
  assert.ok(materials[0].getMetallicRoughnessTexture(), "The original metallic/roughness texture must remain attached");

  let indices = 0;
  let vertices = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const node of document.getRoot().listNodes()) {
    const nodeMesh = node.getMesh();
    if (!nodeMesh) continue;
    const translation = node.getWorldTranslation();
    for (const primitive of nodeMesh.listPrimitives()) {
      indices += primitive.getIndices()?.getCount() ?? 0;
      const positions = primitive.getAttribute("POSITION");
      if (!positions) continue;
      vertices += positions.getCount();
      const minimum = positions.getMin([]);
      const maximum = positions.getMax([]);
      minX = Math.min(minX, minimum[0] + translation[0]);
      minY = Math.min(minY, minimum[1] + translation[1]);
      minZ = Math.min(minZ, minimum[2] + translation[2]);
      maxX = Math.max(maxX, maximum[0] + translation[0]);
      maxY = Math.max(maxY, maximum[1] + translation[1]);
      maxZ = Math.max(maxZ, maximum[2] + translation[2]);
    }
  }

  assert.equal(vertices, 285179, "Preserve every original premium-model vertex");
  assert.equal(indices, 1504272, "Preserve all 501,424 original high-detail triangles");
  assert.equal(bytes.length, 16965544, "Preserve the exact uploaded GLB bytes");
  assert.ok(maxX - minX > 0.99, "Preserve the scooter's full original side-to-side model axis");
  assert.ok(maxY - minY > 0.85, "Preserve the complete high-detail character's full height");
  assert.ok(maxZ - minZ > 0.35, "Preserve the complete original three-dimensional width");
  assert.ok(Math.abs(minX + maxX) < 0.001, "Center the isolated rider on the game origin");
  assert.ok(Math.abs(minY) < 0.001, "Place the scooter wheels on the road");
});

test("the supplied model is normalized, grounded and shown in both driving and 360° inspection", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  assert.match(source, /capybara-premium-original\.glb\?v=original-285179-front-fixed/);
  assert.match(source, /function prepareCharacterModel\(model: THREE\.Group, renderer: WebGPURenderer\)/);
  assert.match(source, /new THREE\.Box3\(\)\.setFromObject\(model\)/);
  assert.match(source, /-bounds\.min\.y \* scale \+ 0\.035/);
  assert.match(source, /surface\.map, surface\.normalMap, surface\.metalnessMap, surface\.roughnessMap/);
  assert.equal((source.match(/prepareCharacterModel\(asset\.scene, renderer\)/g) ?? []).length, 2);
  assert.match(source, /disabled=\{!hud\.ready\}/);
  assert.match(source, /ready: characterLoaded/);
  assert.match(source, /bindCharacterRig\(asset\.scene\)/);
  assert.match(source, /applyCharacterMotion\(characterRig, visualMotion,/);
  assert.match(source, /const CHARACTER_FORWARD_FLIP = Math\.PI/);
  assert.match(source, /\(size\.x > size\.z \? Math\.PI \/ 2 : Math\.PI\) \+ CHARACTER_FORWARD_FLIP/);
  assert.match(source, /model\.rotation\.y = modelHeading/);
  assert.match(source, /vehicle\.rotation\.x = characterMotion\.chassisPitch/);
  assert.match(source, /material\.positionNode = gpuMotion\.positionNode/);
  const gpuMotion = await readFile(new URL('../app/gpu-materials.ts',import.meta.url),'utf8');
  assert.match(gpuMotion, /smoothstep\(pivot, modelHeight \* .64, positionGeometry\.y\)/);
  assert.match(gpuMotion, /body\.bob\.mul\(weight\)/);
  assert.match(source, /loadingProgress/);
  assert.doesNotMatch(source, /update\(\{ ready: true, message \}\)/);
});

test("renderer builds an original physical Taiwanese city without requiring an external map at runtime", async () => {
  const source = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /tile\.openstreetmap\.org/);
  assert.match(source, /https:\/\/tiles\.openfreemap\.org\/planet/);
  assert.doesNotMatch(source, /PHOTO2|TAIWAN_ORTHOPHOTO_TILES|queueAerialNeighborhood|activeAerialRequests/);
  assert.doesNotMatch(layout, /wmts\.nlsc\.gov\.tw/);
  assert.match(source, /feature\.toGeoJSON\(/);
  for (const layer of ["transportation", "building", "park", "landuse", "waterway", "water", "poi"]) {
    assert.match(source, new RegExp(`features\\("${layer}"\\)`));
  }
  for (const feature of ["renderAuthoredDistrict", "clearAuthoredDistrict", "renderParkLandmarks", "identifySchoolCampuses", "renderSchoolLandmarks", "renderRiverChannels", "renderElevatedRoads", "renderStreetLighting", "renderStreetLife", "renderRecognizableLandmarks"]) {
    assert.match(source, new RegExp(feature));
  }
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /this\.renderAuthoredDistrict\(\)/);
  assert.match(source, /renderRoads\(/);
  assert.match(source, /renderBuildings\(/);
  assert.match(source, /CanvasTexture/);
  assert.match(source, /wallGeometry\(/);
  assert.match(source, /facadeWallGeometry\(/);
  assert.match(source, /scaledOutline\(/);
  assert.match(ui, /ORIGINAL 3D WORLD/);
  assert.match(ui, /FICTIONAL TAIWANESE CITY/);
  assert.doesNotMatch(ui, /PHOTO2/);
  assert.match(layout, /capybara-premium-original\.glb\?v=original-285179-front-fixed/);
});

test("the game city includes physical curbs, real lane markings, crosswalks and aligned generated Taiwanese facades", async () => {
  const source = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  for (const material of ["asphalt", "paving", "laneGeometries", "curbGeometries", "whiteMarkingGeometries", "crossingGeometries", "facades", "roof"]) {
    assert.match(source, new RegExp(material));
  }
  for (const appearance of ["aged", "office", "market", "residential"]) {
    const asset = await readFile(new URL(`../public/textures/taiwan-facade-${appearance}.webp`, import.meta.url));
    assert.equal(asset.toString("ascii", 0, 4), "RIFF", `The ${appearance} facade must be a production WebP image`);
    assert.ok(asset.length > 15000, `The ${appearance} facade must preserve visible surface detail`);
    assert.match(source, new RegExp(`taiwan-facade-${appearance}\\.webp`));
  }
  const signage = await readFile(new URL("../public/textures/taiwan-storefront-signboards-atlas.webp", import.meta.url));
  assert.equal(signage.toString("ascii", 0, 4), "RIFF", "Generated storefront signage must ship as a production WebP atlas");
  assert.ok(signage.length > 80000, "Storefront signage must retain readable generated typography and frame detail");
  assert.match(source, /taiwan-storefront-signboards-atlas\.webp/);
  const verticalSignage = await readFile(new URL("../public/textures/taiwan-authentic-vertical-signs-atlas.webp", import.meta.url));
  assert.equal(verticalSignage.toString("ascii", 0, 4), "RIFF", "Vertical side-suspended signs must ship as a production WebP atlas");
  assert.ok(verticalSignage.length > 50000, "Vertical lightboxes must retain their metal frames and readable top-to-bottom characters");
  assert.match(source, /taiwan-authentic-vertical-signs-atlas\.webp/);
  assert.match(source, /\[\.\.\.verticalLabels\[index\]\]\.forEach/);
  assert.match(source, /new THREE\.Vector3\(0\.92, 2\.45, 0\.18\)/);
  assert.match(source, /Setback Taiwanese sidewalks that stop before road junctions/);
  assert.match(source, /Driveable Taiwanese mountain road with switchbacks and guardrails/);
  assert.match(source, /Raised high-visibility mountain asphalt surface/);
  assert.match(source, /Continuous mountain-road shoulder markings/);
  assert.match(source, /Coherent landscaped hillside estate/);
  assert.doesNotMatch(source, /taiwan-hillside-villa-facade-atlas\.webp/);
  assert.match(source, /createHillsideEstate\(/);
  assert.match(source, /createEstateFinish\(/);
  assert.match(source, /Terrain-fitted driveway retaining walls/);
  assert.match(source, /High-resolution mountain terrain fitted around the driveable road/);
  assert.match(source, /new THREE\.PlaneGeometry\(1320, 740, 220, 124\)/);
  assert.doesNotMatch(source, /Villa driveway/);
  assert.match(source, /addArchitecturalDetails/);
  assert.match(source, /Photographic floor-aligned modular Taiwanese street blocks/);
  assert.match(source, /Modular Taiwanese stepped roof terraces/);
  assert.match(source, /new THREE\.InstancedMesh/);
  assert.match(source, /storefronts/);
  for (const detail of ["windows", "airConditioners", "shopSigns", "arcadeColumns", "roofTanks", "parkedScooters"]) {
    assert.match(source, new RegExp(detail));
  }
  assert.match(source, /日日早餐/);
  assert.match(source, /this\.textures\.facades\.length/);
  assert.match(source, /mesh\.castShadow = true/);
});

test("the driving world uses a graded sky, physical reflections and high-quality moving shadows", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  const gpu = await readFile(new URL('../app/gpu-materials.ts',import.meta.url),'utf8');
  assert.match(source, /const createCinematicSky = createGpuSky/);
  assert.match(gpu, /new MeshBasicNodeMaterial/);
  const outdoor = await readFile(new URL("../app/outdoor-environment.ts", import.meta.url), "utf8");
  assert.match(outdoor, /new PMREMGenerator\(renderer\)/);
  assert.match(source, /setOutdoorReflection/);
  assert.match(source, /scene\.environment = reflection\.texture/);
  assert.match(source, /sun\.shadow\.mapSize\.set\(constrainedDevice \? 768 : 1024/);
  assert.match(source, /sun\.shadow\.normalBias/);
  assert.match(source, /sky\.position\.set\(visual\.x/);
  assert.match(source, /createSoftCloudLayer/);
  assert.match(source, /Soft layered Taiwanese fair-weather clouds/);
  assert.match(gpu, /haze = smoothstep/);
  assert.doesNotMatch(source, /broadClouds/);
});

test("the driver receives a full-city navigation map, speed cheat and live FPS counter with fixed image quality", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  assert.match(source, /function CityNavigationMap/);
  assert.ok(!source.includes("stepPerformanceProfile"));
  assert.match(source, /海灣市全域導航/);
  assert.match(source, /MOUNTAIN_ROAD_POINTS/);
  assert.match(source, /BracketLeft/);
  assert.match(source, /BracketRight/);
  assert.match(source, /speedMultiplier/);



  assert.doesNotMatch(source, /constrainedDevice \? 0\.74 : 0\.84/);

  assert.match(source, /map-city-expressway/);
  assert.match(source, /new GpuShadowCache\(scene, sun\)/);
  const shadow = await readFile(new URL('../app/gpu-shadow-cache.ts',import.meta.url),'utf8');
  assert.match(shadow, /staticLight\.shadow\.autoUpdate = false/);
  assert.match(shadow, /movingLight\.shadow\.autoUpdate = true/);


});

test("vehicle model, third-person chase camera, manual controls and road spawn match the driving direction", async () => {
  const source = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  const map = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  assert.match(source, /rider\.rotation\.y = -visual\.heading/);
  assert.match(source, /DEFAULT_CAMERA_PITCH = 0\.24/);
  assert.match(source, /DEFAULT_CAMERA_DISTANCE = 7\.8/);
  assert.match(source, /headSurge = damp/);
  assert.match(source, /headHeave = damp/);
  assert.match(source, /headRoll = damp/);
  assert.match(source, /actualDistance = damp\(actualDistance, orbitDistance/);
  assert.match(source, /visual\.x - Math\.sin\(cameraAngle\) \* horizontal/);
  assert.doesNotMatch(source, /driverEyeHeight/);
  assert.match(source, /keys\.current\.has\("KeyW"\)/);
  assert.match(source, /keys\.current\.has\("KeyA"\)/);
  assert.match(source, /aria-label="油門前進"/);
  assert.match(source, /aria-label="向左轉"/);
  assert.doesNotMatch(source, /stepAiRider/);
  assert.match(source, /world\.spawnPoint/);
  assert.match(source, /addEventListener\("blur", releaseControls\)/);
  assert.match(map, /spawnPoint/);
  assert.match(map, /this\.spawnPoint = \{ x: -92, z: -110, heading: Math\.PI \/ 2 \}/);
  assert.match(map, /outline,/);
});

test("real roads track gentle elevation while physical buildings stay rigid and overpasses remain rideable", async () => {
  const source = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  const game = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  assert.match(source, /elevation-tiles-prod\/terrarium/);
  assert.match(source, /decodeTerrariumElevation/);
  assert.match(source, /conformGeometryToTerrain/);
  assert.match(source, /terrainBaseY/);
  assert.match(source, /terrainAnchorX/);
  assert.match(source, /terrainAnchorZ/);
  assert.match(source, /conformGeometryToTerrain\(geometry, true\)/);
  assert.match(source, /this\.elevatedSegments/);
  assert.match(source, /new THREE\.PlaneGeometry\(5000, 5000, 96, 96\)/);
  assert.match(source, /refreshTerrainMeshes/);
  assert.match(game, /world\.elevationAt\(state, state\.heading, vertical\.height\)/);
  assert.match(game, /world\.gradeAt\(state, state\.heading, vertical\.height\)/);
  assert.match(game, /characterMotion\.chassisPitch \+ roadPitch/);
});

test("actual road intersections include animated traffic lights and moving street traffic", async () => {
  const source = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  const game = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  for (const feature of ["intersectionCandidates", "createTrafficSignals", "trafficLightColor", "signalAhead", "createRoadTraffic", "updateRoadTraffic", "nearbyTraffic", "RoundedBoxGeometry"]) {
    assert.match(source, new RegExp(feature));
  }
  assert.match(game, /闖紅燈/);
  assert.match(game, /前方紅燈/);
  assert.match(game, /world\.nearbyTraffic\(state, vertical\.height\)/);
  assert.match(game, /world\.updateRoadTraffic\(simulationSeconds, dt, state, vertical\.height\)/);
  assert.match(game, /world\.interpolateRoadTraffic\(alpha,/);
  assert.doesNotMatch(game, /trafficStride/);
});

test("user-supplied Taiwanese street and park models are web-optimized and Draco-enabled", async () => {
  const map = await readFile(new URL("../app/real-world-map.ts", import.meta.url), "utf8");
  const street = await stat(new URL("../public/models/environment/taiwan-street-intact.glb", import.meta.url));
  const park = await stat(new URL("../public/models/environment/park-facilities-optimized.glb", import.meta.url));
  const decoder = await stat(new URL("../public/draco/draco_decoder.wasm", import.meta.url));
  assert.ok(street.size < 20_000_000, "Budget must preserve complete architecture, not force destructive cropping");
  assert.ok(park.size < 2_500_000, "Park facilities must stay below the city streaming budget");
  assert.ok(decoder.size > 100_000);
  assert.match(map, /new DRACOLoader/);
  assert.match(map, /taiwan-street-intact\.glb/);
  assert.doesNotMatch(map, /taiwan-lowrise-street-final\.glb/);
  assert.match(map, /park-facilities-optimized\.glb/);
});

test("street compression preserves every complete source surface and full bounds", async () => {
  const bytes = await readFile(new URL("../public/models/environment/taiwan-street-intact.glb", import.meta.url));
  const report = JSON.parse(await readFile(new URL("../public/models/environment/taiwan-street-intact.integrity.json", import.meta.url), "utf8"));
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  const triangles = gltf.meshes.flatMap(mesh => mesh.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
  assert.equal(triangles, 826904);
  assert.equal(report.before.triangles, triangles);
  assert.equal(report.after.triangles, triangles);
  assert.deepEqual(report.after.surfaces, report.before.surfaces);
  assert.equal(report.spatialCropping, false);
  assert.equal(report.simplified, false);
  assert.equal(report.removedLinePrimitives, 24);
  assert.equal(report.outputSha256, createHash("sha256").update(bytes).digest("hex"));
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(report.after.min[axis] - report.before.min[axis]) < 0.02);
    assert.ok(Math.abs(report.after.max[axis] - report.before.max[axis]) < 0.02);
  }
  assert.ok(report.after.max[2] - report.after.min[2] > 4692, "Retain the entire shop row, not just its front fragment");
});

test("scooter uses engine audio, exhaust, original-mesh wheel rotation, manual turbo and seated passengers", async () => {
  const game = await readFile(new URL("../app/CommercialTaxiGame.tsx", import.meta.url), "utf8");
  const effects = await readFile(new URL("../app/driving-effects.ts", import.meta.url), "utf8");
  const vertical = await readFile(new URL("../app/vehicle-vertical-physics.ts", import.meta.url), "utf8");
  assert.match(effects, /class ScooterAudio/);
  assert.match(effects, /createOscillator/);
  assert.match(effects, /panningModel = "HRTF"/);
  assert.match(effects, /createDynamicsCompressor/);
  assert.match(effects, /tyreGain/);
  assert.match(effects, /windGain/);
  assert.match(effects, /landing\(strength: number\)/);
  assert.match(effects, /class ScooterExhaust/);
  assert.match(effects, /new THREE\.InstancedMesh/);
  assert.match(vertical, /velocity -= 9\.81 \* dt/);
  assert.match(vertical, /grounded = false/);
  assert.match(game, /stepVerticalVehicle/);
  assert.match(game, /shadow\.position\.set\(visual\.x, terrainElevation/);
  assert.match(game, /rig\.updateWheels\(motion\.wheelAngle/);
  assert.match(game, /createRigidScooterWheels\(staticMesh, model\)/);
  assert.match(game, /stepTurboCharge/);
  assert.match(game, /keys\.current\.has\("KeyF"\)/);
  assert.match(game, /vehicle\.add\(passenger\)/);
  assert.match(game, /marker\.add\(passenger\)/);
  assert.match(game, /aria-label="渦輪加速"/);
});
