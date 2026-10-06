import bpy,sys,os,math
from mathutils import Vector
models=sys.argv[1];out=sys.argv[2];textures=sys.argv[3]
os.makedirs(out,exist_ok=True)
for kind in (sys.argv[4].split(',') if len(sys.argv)>4 else ['tesla','bmw','ferrari','motorcycle','estate']):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    filename=os.path.join(models,kind+'.glb') if kind!='estate' else os.path.join(out,'estate-qa.glb')
    bpy.ops.import_scene.gltf(filepath=filename)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];bpy.context.view_layer.update()
    vs=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box];lo=Vector([min(v[i] for v in vs) for i in range(3)]);hi=Vector([max(v[i] for v in vs) for i in range(3)]);center=(lo+hi)/2;span=max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z)
    if kind=='estate':
        for m in bpy.data.materials:
            if m.name not in ['Estate_Stone','Estate_Wood']:continue
            bs=m.node_tree.nodes.get('Principled BSDF');prefix='wood' if m.name=='Estate_Wood' else 'travertine'
            for channel,socket in [('color','Base Color'),('roughness','Roughness')]:
                image=bpy.data.images.load(os.path.join(textures,prefix+'-'+channel+'.jpg'));node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
                if channel!='color':image.colorspace_settings.name='Non-Color'
                m.node_tree.links.new(node.outputs['Color'],bs.inputs[socket])
    bpy.ops.mesh.primitive_plane_add(size=span*12,location=(center.x,center.y,lo.z-.015));ground=bpy.context.object
    m=bpy.data.materials.new('Neutral road surface');m.diffuse_color=(.09,.12,.14,1);ground.data.materials.append(m)
    bpy.ops.object.camera_add();camera=bpy.context.object
    camera.location=center+Vector((1.15,1.65,.75))*span if kind!='estate' else center+Vector((.8,-1.05,.77))*span
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=50;bpy.context.scene.camera=camera
    bpy.ops.object.light_add(type='AREA',location=center+Vector((-.6,1.0,1.8))*span);key=bpy.context.object;key.data.energy=220*span*span;key.data.shape='DISK';key.data.size=span*1.8;key.rotation_euler=(center-key.location).to_track_quat('-Z','Y').to_euler()
    world=bpy.data.worlds.new('Clear daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.62,.8,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65;bpy.context.scene.world=world
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=4;scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(out,kind+'.png')
    bpy.ops.render.render(write_still=True);print('RENDERED',kind,flush=True)
sys.stdout.flush();os._exit(0)
