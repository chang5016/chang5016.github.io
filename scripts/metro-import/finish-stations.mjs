import path from 'node:path';
import {T,fs,outputDir,loadObj,bounds,transform,select,clone,removeComponents,removeSourceFaces,writeGLB} from './model-tools.mjs';
const manifest=JSON.parse(await fs.readFile(path.join(outputDir,'sources.json'),'utf8'));
async function save(name,model,adaptation){
 const row=await writeGLB(model,path.join(outputDir,name+'.glb'),adaptation);
 manifest.files=manifest.files.filter(f=>f.file!==row.file);manifest.files.push(row);
 console.log(JSON.stringify({file:row.file,bounds:row.bounds,triangles:row.triangles}));
}
// One complete, authored window including its glazing, rebate and four frames.
// Select whole original connected components, never cut a window into fragments.
const window=select(await loadObj('Resources/Objects/TrainStationBuilding4'),m=>/Windows/.test(m.name));
removeComponents(window,b=>!(b.min.x<-7&&b.max.x<-7&&b.min.y>.8&&b.max.y<2.7&&b.min.z>2.6&&b.max.z<4.1));
const wb=bounds(window),wc=wb.getCenter(new T.Vector3());
transform(window,new T.Matrix4().makeTranslation(-wc.x,-wb.min.y,-wc.z));
transform(window,new T.Matrix4().makeScale(2.7581379,2.7581379,2.7581379));
await save('atrium-window',window,'One complete framed glazed window from the externally authored TrainStationBuilding4. Whole source components retained at uniform scale 2.7581379; repeated as modular curtain-wall bays, with deliberate road and railway portals. No generated facade planes.');
const roof=await loadObj('Resources/Objects/Platform_double_roofing');
for(const mesh of roof.children){
 const p=mesh.geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),base=1.41625297,eave=5.382836819;
  const height=y<base?y-1.11096799:y<=eave?.30528498+(y-base)*(31.69471502/(eave-base)):32+(y-eave)*2;
  const lateral=mesh.material.name==='Beton'?1:1+3*T.MathUtils.smoothstep(y,3.8,5.1);
  p.setXYZ(i,x*lateral,height,z*9/7.878441811);
 }
 mesh.geometry.computeVertexNormals();
}
await save('atrium-roof-bay',roof,'Complete original Platform_double_roofing with its tree-column, branched steel arms, concrete foot, finished inner roof and recessed LED fixtures. Adapted as a 44 m spanning, 33 m tall, 9 m axial civic atrium bay; original thin columns retain their width while the authored branches widen at the head.');
const clearRoof=clone(roof);
removeSourceFaces(clearRoof,(v,n)=>/Beton|Steel/.test(n)&&Math.min(...v.map(p=>p[1]))<31.4);
await save('atrium-roof-clear-bay',clearRoof,'Same downloaded roof bay, with its central column and low branches removed as whole source faces over the train and platform passage. Original roof, light fixtures and top chords remain, supported by continuous imported longitudinal girders and remote perimeter piers.');
const buffer=await loadObj('Resources/Objects/bumper'),bb=bounds(buffer),bc=bb.getCenter(new T.Vector3());
transform(buffer,new T.Matrix4().makeTranslation(-bc.x,-bb.min.y,-bc.z));
transform(buffer,new T.Matrix4().makeScale(1.8,1.8,1.8));
await save('buffer-stop',buffer,'Complete downloaded railway buffer stop: rubber collision pads, braced steel frame and red-white stop target. Uniform scale 1.8 to the widened JFR1 gauge. Placed beyond the terminal stopping berth with a protected run-off deck.');
manifest.version=3;manifest.stationArchitecture='downloaded glazed civic atrium spanning both lift towers';
await fs.writeFile(path.join(outputDir,'sources.json'),JSON.stringify(manifest,null,2)+'\n');
