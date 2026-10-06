import bpy,sys,json,pathlib,os
root=pathlib.Path(__file__).resolve().parents[1]
source_dir=root/'public/models/motorcycle-rider/source'
work=root/'.sites-runtime/motorcycle-rider'
work.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source_dir/'cubedBear.fbx'))
source=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.ops.object.select_all(action='DESELECT');source.select_set(True);bpy.context.view_layer.objects.active=source
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='LOOSE');bpy.ops.object.mode_set(mode='OBJECT')
pieces=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in pieces:
 bpy.context.view_layer.objects.active=o
 original_vertices=len(o.data.vertices)
 extent=[max(v.co[a] for v in o.data.vertices)-min(v.co[a] for v in o.data.vertices) for a in range(3)]
 width=min(extent)*.34
 for p in o.data.polygons:p.use_smooth=True
 if original_vertices>=18:
  # The elbow/knee edges are too close for a useful clamped bevel. Round the
  # native limb quads directly while retaining their original skin weights.
  smooth=o.modifiers.new('Smooth native riding limbs','SUBSURF');smooth.levels=2;smooth.render_levels=2
  bpy.ops.object.modifier_move_up(modifier=smooth.name);bpy.ops.object.modifier_apply(modifier=smooth.name)
 else:
  # Keep the face's original contact surfaces. Subdivision of those separate
  # islands would shrink the head away from its eyes and muzzle.
  bevel=o.modifiers.new('Rounded source silhouette','BEVEL');bevel.width=width;bevel.segments=4;bevel.limit_method='ANGLE';bevel.use_clamp_overlap=True
  bpy.ops.object.modifier_move_up(modifier=bevel.name);bpy.ops.object.modifier_apply(modifier=bevel.name)
  weighted=o.modifiers.new('Smooth surface normals','WEIGHTED_NORMAL');weighted.keep_sharp=True
  bpy.ops.object.modifier_move_up(modifier=weighted.name);bpy.ops.object.modifier_apply(modifier=weighted.name)
  if original_vertices==16:
   smooth=o.modifiers.new('Rounded connected torso','SUBSURF');smooth.levels=1;smooth.render_levels=1
   bpy.ops.object.modifier_move_up(modifier=smooth.name);bpy.ops.object.modifier_apply(modifier=smooth.name)
 o.data.validate(verbose=False)
 print('PART',o.name,len(o.data.vertices),width,flush=True)
bpy.ops.object.select_all(action='DESELECT')
for o in pieces:o.select_set(True)
bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join()
model=bpy.context.object;model.name='Rounded native bear skin'
for m in bpy.data.materials:
 m.name='Rider_Fur'
 if m.use_nodes:
  for n in m.node_tree.nodes:
   if n.type=='TEX_IMAGE':n.image=bpy.data.images.load(str(source_dir/'BaseColor.png'),check_existing=True)
   if n.type=='BSDF_PRINCIPLED':n.inputs['Roughness'].default_value=.74;n.inputs['Metallic'].default_value=0
print('MODEL',len(model.data.vertices),len(model.data.polygons),flush=True)
bpy.ops.export_scene.gltf(filepath=str(work/'Cubed_Bear.glb'),export_format='GLB',export_animations=False)
sys.stdout.flush();os._exit(0)
