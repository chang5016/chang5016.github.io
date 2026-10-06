import bpy,sys,os
from mathutils import Vector,Matrix
src,dest=sys.argv[1:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
    world=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(world)
bpy.context.view_layer.update()
verts=[Vector(v) for o in meshes for v in o.bound_box]
lo=Vector([min(v[i] for v in verts) for i in range(3)]);hi=Vector([max(v[i] for v in verts) for i in range(3)])
scale=12.5/(hi.z-lo.z);center=(lo+hi)/2
transform=Matrix.Scale(scale,4)@Matrix.Translation((-center.x,-center.y,-lo.z))
root=bpy.data.objects.new('ArchitectResidence',None);bpy.context.collection.objects.link(root)
original_materials={m:m.name.lower().replace('_','').replace('.','') for m in bpy.data.materials}
for m,n in original_materials.items():
    m.name='Architect_Glass' if 'gladd' in n or 'glass' in n else 'Architect_DarkMetal' if 'frame' in n or 'rail' in n or n in ['material6','material11'] else 'Architect_Wood' if n in ['material8','material5','material12'] else 'Architect_Travertine'
for o in meshes:
    o.data.transform(transform);o.parent=root
    uv=o.data.uv_layers.active or o.data.uv_layers.new(name='Metric architectural UV')
    for face in o.data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]));axes=[i for i in range(3) if i!=axis]
        for loop in face.loop_indices:
            point=o.data.vertices[o.data.loops[loop].vertex_index].co;uv.data[loop].uv=(point[axes[0]]/2,point[axes[1]]/2)
root['author']='zigurat architecture studio';root['license']='CC-BY-4.0';root['completeSourceGeometry']=True
os.makedirs(os.path.dirname(dest),exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dest,export_format='GLB',export_extras=True,export_yup=True)
print('PREPARED VILLA',sum(len(o.data.polygons) for o in meshes),os.path.getsize(dest),'bytes',flush=True)
sys.stdout.flush();os._exit(0)
