import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {METRO_STATIONS, METRO_FLOOR} from '../../app/metro-system.ts';
import {fallbackTerrainElevation} from '../../app/world-terrain.ts';

// Refit the already downloaded shaft without replacing its original frame,
// glazing, materials or UVs. Keep both portals at their exact native dimensions.
const directory=new URL('../../public/models/metro/downloaded/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('sources.json',directory),'utf8'));
const io=new NodeIO();
for(const [station,{x}] of METRO_STATIONS.entries())for(const track of [0,1]) {
  const file=`lift-shaft-${station}-${track}.glb`,row=manifest.files.find(row=>row.file===file);
  const lower=fallbackTerrainElevation({x,z:-794})+.06,rise=METRO_FLOOR-lower;
  // v86 predates the survey metadata; its three source parcels are known.
  // Source roofs have a small lip, so their maximum Y is not the travel datum.
  const oldLower=row.stationDesignLower??fallbackTerrainElevation({x:[-750,120,960][station],z:-794})+.06;
  const oldRise=METRO_FLOOR-oldLower;
  if(Math.abs(oldRise-rise)<.0001){row.stationDesignLower=lower;continue;}
  const document=await io.read(new URL(file,directory).pathname);
  const bottom=5.3,top=oldRise-.12,factor=(rise-.12-bottom)/(top-bottom);
  const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
    const positions=primitive.getAttribute('POSITION'),p=positions.getArray();
    const normals=primitive.getAttribute('NORMAL'),n=normals?.getArray();
    for(let i=0;i<p.length;i+=3) {
      const y=p[i+1];
      p[i+1]=y<=bottom?y:y>=top?y+rise-oldRise:bottom+(y-bottom)*factor;
      if(n&&y>bottom&&y<top){n[i+1]/=factor;const length=Math.hypot(n[i],n[i+1],n[i+2]);for(let axis=0;axis<3;axis++)n[i+axis]/=length;}
      for(let axis=0;axis<3;axis++){minimum[axis]=Math.min(minimum[axis],p[i+axis]);maximum[axis]=Math.max(maximum[axis],p[i+axis]);}
    }
    positions.setArray(p);if(n)normals.setArray(n);
  }
  const adaptation='Original downloaded Lift-Subway shaft refitted to the relocated street parcel. Only the travel span changes length; all original portal, footing, glass and steel geometry, original UVs and motorcycle clearance remain. Lower and upper portals match the surveyed street and 21.6 m platform.';
  for(const node of document.getRoot().listNodes())node.setExtras({...node.getExtras(),adaptation,stationDesignLower:lower});
  await io.write(new URL(file,directory).pathname,document);
  const bytes=await fs.readFile(new URL(file,directory));
  Object.assign(row,{bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bounds:[minimum,maximum],adaptation,stationDesignLower:lower});
  console.log(JSON.stringify({file,lower,rise}));
}
await fs.writeFile(new URL('sources.json',directory),JSON.stringify(manifest,null,2)+'\n');
