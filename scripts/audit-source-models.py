import bpy,sys,os,math,json
from mathutils import Vector
directory=sys.argv[1]
for kind in ['tesla','bmw','ferrari','motorcycle']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(directory,kind+'-decoded.glb'))
    print('ASSET',kind,flush=True)
    for o in bpy.context.scene.objects:
        if o.type!='MESH':continue
        coords=[o.matrix_world@Vector(v) for v in o.bound_box]
        bounds=[[round(min(v[i] for v in coords),3),round(max(v[i] for v in coords),3)] for i in range(3)]
        print(o.name,'parent',o.parent.name if o.parent else None,'faces',len(o.data.polygons),'mats',[m.name if m else None for m in o.data.materials],'bounds',bounds,flush=True)
sys.stdout.flush();os._exit(0)
