import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import path from 'node:path';
const directory=process.argv[2];
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
for(const name of ['tesla','bmw','ferrari','motorcycle']) {
  const document=await io.read(path.join(directory,`${name}.glb`));
  for(const extension of document.getRoot().listExtensionsUsed())if(extension.extensionName==='KHR_draco_mesh_compression')extension.dispose();
  await io.write(path.join(directory,`${name}-decoded.glb`),document);
  console.log(name,document.getRoot().listMeshes().length,'meshes decoded');
}
