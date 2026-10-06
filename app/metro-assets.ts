import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { metroDisplayRoute } from './metro-display-layout';

export type MetroSource = { repository?: string; page?: string; path?: string; file?: string; license: string; sha256: string };
const PARTS = ['animal-driver', 'jfr1-motorcycle-car', 'gangway-shell', 'gangway-collar', 'platform-pocket', 'atrium-main-roof', 'atrium-lantern-roof', 'station-paving', 'atrium-window', 'atrium-roof-clear-bay', 'buffer-stop', 'train-door', 'platform-door', 'lift-door', 'boarding-threshold', 'hanging-display', 'door-display', 'platform', 'platform-railing', 'canopy', 'guideway', 'pier', 'rail', 'bench', 'lift-cabin', 'lift-floor', ...[0, 1, 2].flatMap(station => [0, 1].map(track => `lift-shaft-${station}-${track}`))];
const assetUrl = (url: string) => `${url}?v=metro94-actors-and-lcd`;
type DisplaySurface = { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; material: THREE.MeshBasicMaterial; signature: string };
export type MetroDisplay = { root: THREE.Group; screens: THREE.Mesh[]; texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; surface: DisplaySurface };
export type MetroInstances = { root: THREE.Group; meshes: THREE.InstancedMesh[]; set: (index: number, x: number, y: number, z: number, angle?: number, scaleX?:number) => void; commit: () => void };
export type TrainDisplayData = { names:readonly string[]; english:readonly string[]; current:number; next:number; phase:string; seconds:number; capacity:number; total:number; progress?:number; animation?:number };

/** Only loads externally authored geometry. No generated placeholder meshes. */
export class DownloadedMetroAssets {
  private models = new Map<string, THREE.Group>();
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly materials = new Set<THREE.Material>();
  readonly textures = new Set<THREE.Texture>();
  private bounds = new Map<string, THREE.Box3>();
  private displaySurfaces = new Map<string, DisplaySurface>();

  async load() {
    const loader = new GLTFLoader(), textures = new Map<string, Promise<THREE.Texture>>(), materialPool = new Map<string, THREE.Material>();
    const fontReady = typeof FontFace !== 'undefined' && document.fonts
      ? new FontFace('Metro Display', 'url(/fonts/metro-display.woff)', { weight: '100 900' }).load().then(font => { document.fonts.add(font); })
      : Promise.resolve();
    await Promise.all([fontReady, ...PARTS.map(async name => {
      const { scene } = await loader.loadAsync(assetUrl(`/models/metro/downloaded/${name}.glb`));
      const pending: Promise<void>[] = [];
      scene.traverse(object => {
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        let owner: THREE.Object3D | null = mesh;
        while (owner && !owner.userData.downloadedSource) owner = owner.parent;
        if (!owner?.userData.downloadedSource?.sha256) throw new Error(`Missing downloaded geometry source: ${name}`);
        mesh.userData.downloadedSource = owner.userData.downloadedSource;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.geometries.add(mesh.geometry);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const pbr = material as THREE.MeshStandardMaterial, url = material.userData.map as string | undefined;
          if (/Lamp|LED/.test(material.name)) {pbr.emissive.set('#fff5e7');pbr.emissiveIntensity=2.4;}
          if (material.name === 'Frame') { pbr.color.set('#c1cbd0'); pbr.metalness=.7; pbr.roughness=.32; }
          if (material.name === 'RoofInside') { pbr.color.set('#e5e8e9'); pbr.metalness=.05; pbr.roughness=.72; }
          if (material.name === 'Roof') { pbr.color.set('#8999a3'); pbr.metalness=.65; pbr.roughness=.55; }
          // The train's albedo already contains baked contact shading. Applying
          // its full AO again was turning the interior nearly black.
          if (/Wagon.*BAKED/.test(material.name)) pbr.aoMapIntensity=.35;
          if (url) {
            if (!textures.has(url)) textures.set(url, new THREE.TextureLoader().loadAsync(assetUrl(url)).then(texture => {
              texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
              this.textures.add(texture); return texture;
            }));
            pending.push(textures.get(url)!.then(texture => {
              pbr.map = texture;
              if (/Beton|Floor|Pflasterstein|Side/.test(material.name)) { pbr.bumpMap = texture; pbr.bumpScale = .012; }
              pbr.needsUpdate = true;
            }));
          }
          if (pbr.transparent) { pbr.depthWrite = false; mesh.castShadow = false; }
          const orm = material.userData.orm as string | undefined;
          if (orm) {
            if (!textures.has(orm)) textures.set(orm, new THREE.TextureLoader().loadAsync(assetUrl(orm)).then(texture => { texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; this.textures.add(texture); return texture; }));
            pending.push(textures.get(orm)!.then(texture => { pbr.aoMap = pbr.roughnessMap = pbr.metalnessMap = texture; pbr.needsUpdate = true; }));
          }
          for(const channel of ['normal','roughness'] as const) {
            const detail=material.userData[channel] as string|undefined;if(!detail)continue;
            if(!textures.has(detail))textures.set(detail,new THREE.TextureLoader().loadAsync(assetUrl(detail)).then(texture=>{texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;this.textures.add(texture);return texture;}));
            pending.push(textures.get(detail)!.then(texture=>{if(channel==='normal'){pbr.normalMap=texture;pbr.normalScale.set(.4,.4);}else pbr.roughnessMap=texture;pbr.needsUpdate=true;}));
          }
          const key = [material.name, pbr.color?.getHex(), pbr.roughness, pbr.metalness, pbr.opacity, url ?? '', orm ?? '',material.userData.normal??'',material.userData.roughness??''].join(':');
          const shared = materialPool.get(key);
          if (shared) {
            if (!Array.isArray(mesh.material)) mesh.material = shared;
            else mesh.material = mesh.material.map(m => m === material ? shared : m);
            pending.push(Promise.all(pending).then(() => material.dispose()));
          } else { materialPool.set(key, material); this.materials.add(material); }
        }
      });
      await Promise.all(pending);
      scene.updateWorldMatrix(true, true);
      this.models.set(name, scene); this.bounds.set(name, new THREE.Box3().setFromObject(scene));
    })]);
    this.finishCabinCeiling();
    this.finishLiftFloor();
    await this.finishPlatformMaterials();
  }

  private async finishPlatformMaterials() {
    const folder='/models/metro/downloaded/textures/';
    const families=[
      {id:'concrete',files:['concrete-diff.jpg','concrete-nor_gl.jpg','concrete-rough.jpg'],meters:1.805,page:'https://polyhaven.com/a/concrete_wall_009'},
      {id:'oak',files:['oak-diff.jpg','oak-nor_gl.jpg','oak-rough.jpg'],meters:1.2,page:'https://polyhaven.com/a/oak_wood_planks'},
      {id:'paint',files:['painted-metal-diff.jpg','painted-metal-nor_gl.jpg','painted-metal-rough.jpg'],meters:2.5,page:'https://polyhaven.com/a/blue_metal_plate'},
      {id:'aluminium',files:['aluminium-color.jpg','aluminium-normalgl.jpg','aluminium-roughness.jpg'],meters:.5,page:'https://ambientcg.com/view?id=Metal032'},
    ];
    const surfaces=new Map<string,{maps:THREE.Texture[];meters:number;page:string}>();
    await Promise.all(families.map(async family=>{
      const maps=await Promise.all(family.files.map(async(file,index)=>{
        const texture=await new THREE.TextureLoader().loadAsync(assetUrl(folder+file));
        texture.colorSpace=index===0?THREE.SRGBColorSpace:THREE.NoColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;
        this.textures.add(texture);return texture;
      }));
      surfaces.set(family.id,{maps,meters:family.meters,page:family.page});
    }));
    const pool=new Map<string,THREE.MeshStandardMaterial>();
    const finish=(source:THREE.MeshStandardMaterial,family:string,role:string,color='#ffffff',metalness=0,roughness=1)=>{
      const key=`${source.name}:${family}:${role}`,shared=pool.get(key);if(shared)return shared;
      const surface=surfaces.get(family)!,material=source.clone();
      material.map=surface.maps[0];material.normalMap=surface.maps[1];material.roughnessMap=surface.maps[2];
      material.bumpMap=material.aoMap=material.metalnessMap=null;
      material.color.set(color);material.metalness=metalness;material.roughness=roughness;
      material.normalScale.setScalar(family==='aluminium'?.12:family==='paint'?.23:.45);
      material.userData.stationFinish={family,role,meters:surface.meters,page:surface.page,license:'CC0'};
      this.materials.add(material);pool.set(key,material);return material;
    };
    for(const name of ['canopy','platform','platform-railing','platform-door','platform-pocket','bench','boarding-threshold','hanging-display','door-display','pier','guideway']) {
      this.models.get(name)!.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material))return;
        const material=mesh.material as THREE.MeshStandardMaterial,label=material.name;
        if(label==='Side'||label==='Beton')mesh.material=finish(material,'concrete',label==='Side'?'platform fascia':'grounded concrete support');
        else if(label==='Steel')mesh.material=finish(material,'paint','painted canopy structure','#dbe8ee',.18,.88);
        else if(label==='Roof')mesh.material=finish(material,'paint','weatherproof metal roof','#dce5e8',.22,.85);
        else if(label==='RoofInside'||label==='Wood')mesh.material=finish(material,'oak',label==='RoofInside'?'oak canopy soffit':'oak bench slats');
        else if(label==='Metal'||label==='GreyMetal'||label==='PSD brushed aluminium')mesh.material=finish(material,'aluminium',label==='Metal'?'brushed metal fitting':'platform door frame','#edf1f3',.94,.75);
        else if(label==='PSD recessed aluminium pocket') {
          // Keep the actual opaque recess: a transparent infill exposed the
          // retracted leaves and made an open platform door look obstructed.
          mesh.material=mesh.geometry.attributes.position.count===12
            ?finish(material,'paint','recessed pocket infill','#d4e1e9',.15,.95)
            :finish(material,'aluminium','recessed pocket frame','#edf1f3',.94,.75);
        }else if(name==='canopy'&&label==='Plastic')mesh.material=finish(material,'aluminium','recessed light housing','#edf1f3',.85,.70);
        else if(name==='canopy'&&label==='LED') {
          const diffuser=material.clone();diffuser.map=null;diffuser.color.set('#fff6e7');diffuser.metalness=0;diffuser.roughness=.45;
          diffuser.emissive.set('#fff1db');diffuser.emissiveIntensity=1.6;mesh.material=diffuser;this.materials.add(diffuser);
        }
      });
    }
    // Instanced screen leaves retain one shared geometry. Their native metre
    // scale is projected once; fittings resized later get a placement-specific
    // projection before spatial batching.
    for(const name of ['platform-door','platform-pocket','bench','hanging-display','door-display'])this.fitSurfaceUv(this.models.get(name)!);
  }

  /** Metric UVs on existing downloaded faces, including vertical surfaces. */
  fitSurfaceUv(root:THREE.Object3D) {
    root.updateWorldMatrix(true,true);
    root.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material))return;
      const meters=mesh.material.userData.stationFinish?.meters as number|undefined;if(!meters)return;
      const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
      const p=geometry.attributes.position,n=geometry.attributes.normal;
      const uv=new THREE.BufferAttribute(new Float32Array(p.count*2),2),world=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],normal=new THREE.Vector3();
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<p.count;i+=3) {
        for(let k=0;k<3;k++)world[k].fromBufferAttribute(p,i+k).applyMatrix4(mesh.matrixWorld);
        normal.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix);
        const x=Math.abs(normal.x),y=Math.abs(normal.y),z=Math.abs(normal.z);
        // Project each source triangle into its dominant physical plane. UVs
        // may repeat, but a 20-m column never stretches a single wall photograph.
        for(let k=0;k<3;k++) {
          const v=world[k];
          if(y>=x&&y>=z)uv.setXY(i+k,v.x/meters,v.z/meters);
          else if(x>=z)uv.setXY(i+k,v.z/meters,v.y/meters);
          else uv.setXY(i+k,v.x/meters,v.y/meters);
        }
      }
      geometry.setAttribute('uv',uv);geometry.userData={...mesh.geometry.userData,metricSurfaceMeters:meters};
      mesh.geometry=geometry;this.geometries.add(geometry);
    });
  }

  private finishLiftFloor() {
    const source=this.material('station-paving','Metro terrazzo / 600 mm module');
    const material=source.clone();material.name='Downloaded station paving / lift cabin floor';
    material.roughness=.88;this.materials.add(material);
    this.models.get('lift-floor')!.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
      mesh.material=material;
      // Ceiling.obj has no authored UVs. Project the original downloaded panel
      // at the paving's physical scale instead of stretching one texel across it.
      const p=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv');
      for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/2,p.getZ(i)/2);
      uv.needsUpdate=true;
    });
  }

  private finishCabinCeiling() {
    let lining:THREE.MeshStandardMaterial|undefined;
    this.models.get('canopy')!.traverse(object=>{
      const mesh=object as THREE.Mesh;
      if(mesh.isMesh&&!Array.isArray(mesh.material)&&mesh.material.name==='RoofInside') lining=(mesh.material as THREE.MeshStandardMaterial).clone();
    });
    if(!lining)throw new Error('Downloaded roof lining material is missing');
    lining.name='Downloaded white plastic / train ceiling lining';
    lining.color.set('#edf0f1');lining.metalness=.05;lining.roughness=.65;
    lining.emissive.set('#c9d4dc');lining.emissiveIntensity=.08;
    lining.bumpMap=lining.map;lining.bumpScale=.002;
    this.models.get('atrium-window')!.traverse(object=>{
      const mesh=object as THREE.Mesh;
      if(mesh.isMesh&&!Array.isArray(mesh.material)&&mesh.material.name==='Glass')lining!.map=(mesh.material as THREE.MeshStandardMaterial).map;
    });
    this.materials.add(lining);
    this.models.get('jfr1-motorcycle-car')!.traverse(object=>{
      const mesh=object as THREE.Mesh;
      if(!mesh.isMesh||Array.isArray(mesh.material)||!/Wagon.*BAKED/.test(mesh.material.name))return;
      const geometry=mesh.geometry,p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index;
      const shell:number[]=[],ceiling:number[]=[];
      for(let i=0;i<(index?.count??p.count);i+=3){
        const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
        const inside=ids.every(id=>p.getY(id)>3.72&&p.getZ(id)>-16.4&&p.getZ(id)<12.98)
          &&ids.reduce((sum,id)=>sum+n.getY(id),0)/3<-.12;
        (inside?ceiling:shell).push(...ids);
      }
      if(!ceiling.length)throw new Error('Downloaded train ceiling faces are missing');
      // Reassign existing triangles only: no new panels, vertices or UVs.
      geometry.setIndex([...shell,...ceiling]);geometry.clearGroups();
      geometry.addGroup(0,shell.length,0);geometry.addGroup(shell.length,ceiling.length,1);
      mesh.material=[mesh.material,lining!];mesh.userData.downloadedCeilingFaces=ceiling.length/3;
    });
  }

  create(name: string) {
    const model = this.models.get(name);
    if (!model) throw new Error(`Downloaded metro part unavailable: ${name}`);
    const result = cloneSkinnedModel(model) as THREE.Group; result.name = `Downloaded metro / ${name}`; return result;
  }

  instances(name: string, count: number): MetroInstances {
    const root = new THREE.Group(), source = this.create(name), meshes: THREE.InstancedMesh[] = [], bases: THREE.Matrix4[] = [];
    root.name = `Instances of downloaded ${name}`; root.userData.dynamicWorldObject = true; source.updateWorldMatrix(true, true);
    source.traverse(object => {
      const part = object as THREE.Mesh; if (!part.isMesh) return;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.name = part.name; mesh.userData = { ...part.userData }; mesh.castShadow = part.castShadow; mesh.receiveShadow = part.receiveShadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh); meshes.push(mesh); bases.push(part.matrixWorld.clone());
    });
    const poses: string[] = [], matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1), axis = new THREE.Vector3(0, 1, 0), composed = new THREE.Matrix4();
    let dirty = false;
    const set = (index: number, x: number, y: number, z: number, angle = 0, scaleX=1) => {
      const key = `${x}:${y}:${z}:${angle}:${scaleX}`; if (poses[index] === key) return; poses[index] = key;
      matrix.compose(position.set(x, y, z), rotation.setFromAxisAngle(axis, angle), scale.set(scaleX,1,1));
      meshes.forEach((mesh, part) => mesh.setMatrixAt(index, composed.multiplyMatrices(matrix, bases[part]))); dirty = true;
    };
    const commit = () => { if (!dirty) return; meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }); dirty = false; };
    return { root, meshes, set, commit };
  }

  getBounds(name: string) { return this.bounds.get(name)!.clone(); }

  material(name:string,label:string) {
    let result:THREE.MeshStandardMaterial|undefined;
    this.models.get(name)?.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh&&!Array.isArray(mesh.material)&&mesh.material.name===label)result=mesh.material as THREE.MeshStandardMaterial;});
    if(!result)throw new Error(`Downloaded material missing: ${name} / ${label}`);
    return result;
  }

  /** Resizes an existing part while preserving its bevels, faces and materials. */
  sized(name: string, width: number, height: number | null, depth: number, x: number, top: number, z: number, angle = 0) {
    const group = new THREE.Group(), model = this.create(name), bounds = this.getBounds(name), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    model.scale.set(width / size.x, height === null ? 1 : height / size.y, depth / size.z);
    model.position.set(-centre.x * model.scale.x, -bounds.max.y * model.scale.y, -centre.z * model.scale.z);
    group.add(model); group.position.set(x, top, z); group.rotation.y = angle; group.name = model.name;
    this.fitSurfaceUv(group);
    return group;
  }

  display(kind: 'hanging-display' | 'door-display', width: number, height: number, channel?: string): MetroDisplay {
    const root = this.create(kind), screens: THREE.Mesh[] = [];
    let surface = channel ? this.displaySurfaces.get(channel) : undefined;
    if (!surface) {
      const canvas = document.createElement('canvas');
      // Match the imported face's physical aspect ratio so the live lettering
      // retains its proportions after the enclosure is fitted to the station.
      const faceAspect = (width * .944991) / (height * .489982 / .6);
      canvas.width = 2048; canvas.height = Math.round(canvas.width / faceAspect);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
      const material = new THREE.MeshBasicMaterial({ map: texture, color: '#ffffff', toneMapped: false, side: THREE.DoubleSide });
      material.name = 'Live pixels on downloaded 3D display face'; this.materials.add(material); this.textures.add(texture);
      surface = { canvas, texture, material, signature: '' }; if (channel) this.displaySurfaces.set(channel, surface);
    }
    root.traverse(object => {
      const mesh = object as THREE.Mesh; if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name === 'Display') { mesh.material = surface!.material; mesh.castShadow = false; screens.push(mesh); }
    });
    if (!screens.length) throw new Error('Downloaded electronic display has no display face');
    root.scale.set(1, height / .6, width / 2);
    this.fitSurfaceUv(root);
    return { root, screens, texture: surface.texture, canvas: surface.canvas, surface };
  }

  paint(display: MetroDisplay, lines: string[], color = '#4ab9df') {
    const signature = color + lines.join('\n'); if (signature === display.surface.signature) return;
    const ctx = display.canvas.getContext('2d'); if (!ctx) return;
    const { width, height } = display.canvas, margin = Math.max(12, height * .05);
    ctx.fillStyle = '#08151f'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 16, height);
    if (lines.length === 4) {
      const row = (height - margin * 2) / 2, size = row * .67;
      lines.forEach((line, index) => {
        const column = index < 2 ? 0 : 1, level = index % 2;
        ctx.font = `${level === 0 ? 800 : 600} ${level === 0 ? size : size * .80}px "Metro Display", system-ui, sans-serif`;
        ctx.fillStyle = index === 0 ? '#ffffff' : index === 1 || index === 2 ? color : '#c8dde8';
        ctx.fillText(line, 44 + column * width / 2, margin + size + level * row, width / 2 - 76);
      });
      display.texture.needsUpdate = true; display.surface.signature = signature; return;
    }
    const spacing = (height - margin * 2) / Math.max(3, lines.length), size = Math.min(70, spacing * .68);
    lines.forEach((line, index) => {
      ctx.font = `${index === 0 ? 800 : 600} ${index === 0 ? size * 1.1 : size}px "Metro Display", system-ui, sans-serif`;
      ctx.fillStyle = index === 0 ? '#ffffff' : index === 1 ? color : '#c8dde8';
      ctx.fillText(line, 44, margin + size * 1.1 + index * spacing, width - 76);
    });
    display.texture.needsUpdate = true; display.surface.signature = signature;
  }

  /** Live LCD pixels on the original imported enclosure and screen faces. */
  paintTrain(display:MetroDisplay,data:TrainDisplayData) {
    const signature=JSON.stringify(data);if(signature===display.surface.signature)return;
    const ctx=display.canvas.getContext('2d');if(!ctx)return;
    const {width:w,height:h}=display.canvas,margin=w*.025;
    const text=(value:string,x:number,y:number,size:number,color='#102b3d',weight=600,max=w)=>{
      ctx.font=`${weight} ${size}px "Metro Display", system-ui, sans-serif`;ctx.fillStyle=color;ctx.fillText(value,x,y,max);
    };
    ctx.fillStyle='#f5f8fa';ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#17658f';ctx.fillRect(0,0,w*.014,h);
    const running=data.phase==='running',route=metroDisplayRoute(data.names.length,data.current,data.next,running?data.progress:0);
    const pulse=.5+.5*Math.sin((data.animation??0)*Math.PI*2);
    text(running?'上一站 LAST STATION':'目前站 THIS STATION',margin,h*.13,h*.096,'#17658f',700,w*.27);
    text(data.names[data.current],margin,h*.41,h*.22,'#102b3d',800,w*.27);
    text(data.english[data.current].toUpperCase(),margin,h*.55,h*.076,'#536775',500,w*.27);
    const nextX=w*.35;
    text('下一站 NEXT STATION',nextX,h*.13,h*.10,'#17658f',700,w*.41);
    text(data.names[data.next],nextX,h*.43,h*.28,'#102b3d',800,w*.41);
    text(data.english[data.next].toUpperCase(),nextX,h*.55,h*.078,'#536775',500,w*.41);
    const right=w*.80,time=`${Math.floor(data.seconds/60)}:${String(data.seconds%60).padStart(2,'0')}`;
    const status=running?'抵達 ARRIVAL':data.phase==='dwell'?'車門已開 OPEN':data.phase==='opening'?'車門開啟 OPENING':'車門關閉 CLOSING';
    text(status,right,h*.13,h*.068,'#17658f',700,w*.18);
    text(time,right,h*.40,h*.21,'#102b3d',800,w*.18);
    text(`機車位 ${data.capacity}/${data.total}`,right,h*.55,h*.070,'#536775',600,w*.18);
    ctx.fillStyle='#e0ebf1';ctx.fillRect(margin,h*.62,w-margin*2,h*.34);
    const start=w*.17,end=w*.81,lineY=h*.73;
    text(`往 ${data.names[route.terminus]}`,margin,h*.91,h*.066,'#17658f',700,w*.12);
    ctx.fillStyle='#9fb5c0';ctx.fillRect(start,lineY-2,end-start,4);
    const stopX=(index:number)=>start+(end-start)*index/Math.max(1,data.names.length-1);
    const marker=stopX(route.marker);
    ctx.fillStyle='#17658f';ctx.fillRect(start,lineY-2,Math.max(0,marker-start),4);
    route.stops.forEach((station,index)=>{
      const x=stopX(index),active=station===data.current,next=station===data.next;
      if(next){ctx.beginPath();ctx.arc(x,lineY,h*(.031+pulse*.009),0,Math.PI*2);ctx.fillStyle=`rgba(229,155,35,${.12+pulse*.13})`;ctx.fill();}
      ctx.beginPath();ctx.arc(x,lineY,h*(active?.025:.019),0,Math.PI*2);ctx.fillStyle=active?'#17658f':next?'#d08a20':'#9fb5c0';ctx.fill();
      text(data.names[station],x-w*.076,h*.866,h*.09,active?'#17658f':'#102b3d',active?800:600,w*.155);
      text(`MB0${station+1}`,x-w*.025,h*.93,h*.054,'#536775',500,w*.06);
    });
    // The line always reads in travel order; its animated vehicle moves right,
    // including the westbound trip, rather than contradicting a fixed diagram.
    text('▶',marker-w*.010,lineY-h*.025,h*.094,'#17658f',800,w*.025);
    if(!running){ctx.fillStyle=data.phase==='dwell'?'#249369':'#cc8230';ctx.fillRect(right,h*.58,w*.18*pulse,h*.018);}
    display.texture.needsUpdate=true;display.surface.signature=signature;
  }

  dispose() {
    this.geometries.forEach(geometry => geometry.dispose()); this.materials.forEach(material => material.dispose()); this.textures.forEach(texture => texture.dispose());
    this.models.clear(); this.bounds.clear(); this.displaySurfaces.clear();
  }
}
