"""Offline Blender authoring; intact vehicle assemblies, metric scale, native lamps.
Inputs are the attributed public source GLBs listed in ASSET-SOURCES.md.
No runtime Draco decoder, geometry cutting, or per-instance mesh copies are needed.
"""
import bpy,bmesh,math,sys,os,json
import numpy as np
from mathutils import Vector,Matrix
src=sys.argv[1];dest=sys.argv[2]
os.makedirs(dest,exist_ok=True)
def bounds(objects):
    bpy.context.view_layer.update()
    vs=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    return Vector([min(v[i] for v in vs) for i in range(3)]),Vector([max(v[i] for v in vs) for i in range(3)])
def material(name,color,roughness=.5,metal=0,emission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=roughness;b.inputs['Metallic'].default_value=metal
    if name=='Paint':b.inputs['Coat Weight'].default_value=.7;b.inputs['Coat Roughness'].default_value=.15
    if emission:b.inputs['Emission Color'].default_value=(*color,1);b.inputs['Emission Strength'].default_value=emission
    return m
def split_object(o,groups):
    """Partition complete source faces into articulated subassemblies, preserving UVs."""
    bm=bmesh.new();bm.from_mesh(o.data);bm.faces.ensure_lookup_table()
    pieces=[]
    for label,predicate in groups:
        chosen=[f.index for f in bm.faces if predicate(f.calc_center_median())]
        if not chosen:continue
        copy=bm.copy();copy.faces.ensure_lookup_table();keep=set(chosen)
        bmesh.ops.delete(copy,geom=[f for f in copy.faces if f.index not in keep],context='FACES')
        mesh=bpy.data.meshes.new(o.name+'_'+label);copy.to_mesh(mesh);copy.free()
        for m in o.data.materials:mesh.materials.append(m)
        p=bpy.data.objects.new(o.name+'_'+label,mesh);bpy.context.collection.objects.link(p)
        p['sourceName']=o.get('sourceName',o.name);p['sourceMaterial']=o.get('sourceMaterial','');p['assembly']=label;pieces.append(p)
    bm.free();bpy.data.objects.remove(o,do_unlink=True);return pieces
def join_material_groups(parent):
    candidates=[o for o in parent.children if o.type=='MESH']
    groups={}
    for o in candidates:
        key=tuple(m.name if m else '' for m in o.data.materials)
        groups.setdefault(key,[]).append(o)
    for key,parts in groups.items():
        if len(parts)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
        parts[0].name=parent.name+'_'+key[0]
for kind,length,rotation,ratio in [('tesla',4.69,math.pi,.95),('bmw',4.93,math.pi,.15),('ferrari',4.527,0,.27),('motorcycle',2.1,-math.pi/2,.047)]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src,kind+'-decoded.glb'))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in list(meshes):
        if kind=='tesla' and o.name.startswith(('Cylinder012','Debris_Tires','WallDeskSpeakers')):
            bpy.data.objects.remove(o,do_unlink=True);meshes.remove(o);continue
        if kind=='bmw' and min((o.matrix_world@Vector(v)).y for v in o.bound_box)>5:
            bpy.data.objects.remove(o,do_unlink=True);meshes.remove(o);continue
        o['sourceName']=o.parent.name if o.parent else o.name
        o['sourceMaterial']=o.data.materials[0].name if o.data.materials else ''
        matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(Matrix.Rotation(rotation,4,'Z')@matrix)
    lo,hi=bounds(meshes);scale=length/(hi.y-lo.y);center=(lo+hi)/2
    transform=Matrix.Scale(scale,4)@Matrix.Translation((-center.x,-center.y,-lo.z))
    for o in meshes:o.data.transform(transform);o.data.update()
    palette={
      'Paint':material('Paint',(.52,.025,.028),.23,.35),'Metal':material('Metal',(.46,.49,.51),.27,.87),
      'Rubber':material('Rubber',(.018,.022,.025),.88),'Trim':material('Trim',(.024,.03,.035),.55),
      'Leather':material('Leather',(.045,.045,.042),.78),'Glass':material('Glass',(.075,.13,.16),.13,.5),
      'Brake':material('Brake',(.65,.01,.008),.23,.1,.25),'Headlight':material('Headlight',(.95,.95,.9),.15,.1,.55),
      'Indicator_Left':material('Indicator_Left',(.85,.23,.006),.23,.1,.05),'Indicator_Right':material('Indicator_Right',(.85,.23,.006),.23,.1,.05),
      'Blue':material('Blue',(.012,.10,.40),.22,.25),'Red':material('Red',(.5,.015,.02),.4,.2),'Gold':material('Gold',(.48,.28,.08),.28,.75),
    }
    for o in meshes:
        for i,m in enumerate(o.data.materials):
            if not m:continue
            n=m.name.lower();name=None
            if kind=='tesla':
                name={'car_paint':'Paint','chrome':'Metal','glass':'Glass','plastic':'Trim','led_phare':'Headlight','material.002':'Brake','material.007':'Brake','material.011':'Metal','material.012':'Metal','material.013':'Rubber','material.014':'Red','material.015':'Leather','material.016':'Glass','material.017':'Glass'}.get(n)
            elif kind=='bmw':
                if n=='body':name='Paint'
                elif n in ['rim1','rim2','disc','metallic_int','int_chro']:name='Metal'
                elif n=='tires':name='Rubber'
                elif n=='glass':name='Glass'
                elif n=='caliper':name='Red'
                elif n.startswith(('black','carbon')) or n=='material_23':name='Trim'
                elif n.startswith(('leather','carpet','int_leather')) or n in ['int_seat','interior','interiorbutt','interior_o','material_31','material_32','material_40','material_43','material_46','int_hud','gball','dashext','leddash','material','badgea','coloured','material_39','dashlight']:name='Leather'
            elif kind=='ferrari':
                if n.startswith('body'):name='Paint'
                elif 'tire' in n:name='Rubber'
                elif n.startswith('taillight_glass'):name='Brake' if o.get('sourceName')=='main' else 'Red'
                elif 'projector_glass' in n:name='Headlight'
                elif 'glass' in n:name='Glass'
            else:
                if n.startswith(('carpaint_second','white')):name='Paint'
                elif n.startswith(('carpaint','blue')):name='Blue'
                elif n.startswith('tire'):name='Rubber'
                elif n.startswith('redglass'):name='Brake'
                elif n.startswith('red'):name='Red'
                elif n.startswith('gold'):name='Gold'
                elif n.startswith(('chrome','mattemetal','brakedisk','rim','bronze','mirror')):name='Metal'
                elif n.startswith('black'):name='Leather' if 'seat' in o.get('sourceName','') else 'Trim'
                elif n.startswith('clearglass'):name='Headlight' if 'HL' in o.get('sourceName','') else 'Glass'
                elif n.startswith('gray'):name='Trim'
            if name:o.data.materials[i]=palette[name]
    if kind in ['tesla','ferrari','motorcycle']:
        output=[]
        for o in meshes:
            original=o.get('sourceMaterial','').lower();source=o.get('sourceName','')
            is_indicator=(kind=='tesla' and original=='led_phare') or (kind=='ferrari' and original=='turn_signal_led') or (kind=='motorcycle' and source=='glass_yellow_front')
            if is_indicator:
                pieces=split_object(o,[('Indicator_Left',lambda p:p.x<0),('Indicator_Right',lambda p:p.x>=0)])
                for p in pieces:
                    p.data.materials.clear();p.data.materials.append(palette[p['assembly']]);p['side']=-1 if p['assembly'].endswith('Left') else 1
                output.extend(pieces)
            else:output.append(o)
        meshes=output
    if kind=='bmw':
        output=[]
        for o in meshes:
            original=o.data.materials[0].name if o.data.materials else ''
            # Identify source wheel objects by the complete original material regions.
            source=o.get('sourceName','')
            if o.get('sourceMaterial','').lower() in ['tires','rim1','rim2','disc','bmwlogo','caliper']:
                output.extend(split_object(o,[(label,lambda p,sx=sx,sy=sy:p.x*sx>=0 and p.y*sy>=0) for label,sx,sy in [('FL',-1,1),('FR',1,1),('RL',-1,-1),('RR',1,-1)]]))
            elif original.lower()=='lights':
                pieces=split_object(o,[('Headlight',lambda p:p.y>.9),('Brake_Left',lambda p:p.y<=.9 and p.x<0),('Brake_Right',lambda p:p.y<=.9 and p.x>=0)])
                for p in pieces:p.data.materials.clear();p.data.materials.append(palette['Headlight' if p['assembly']=='Headlight' else 'Brake'])
                output.extend(pieces)
            else:output.append(o)
        meshes=output
    root=bpy.data.objects.new('Vehicle',None);bpy.context.collection.objects.link(root);root['trafficRig']=True;root['length']=length;root['sourceModel']=kind
    chassis=bpy.data.objects.new('Chassis',None);bpy.context.collection.objects.link(chassis);chassis.parent=root
    wheel_parts={};stationary_front=[]
    for o in meshes:
        source=o.get('sourceName','');label=None
        if kind=='tesla' and source.startswith('wheel'):
            label={'wheel':'FL','wheel.001':'FR','wheel.002':'RR','wheel.003':'RL'}.get(source)
        elif kind=='ferrari' and source.startswith('wheel_'):label=source[-2:].upper()
        elif kind=='bmw':label=o.get('assembly') if o.get('assembly') in ['FL','FR','RL','RR'] else None
        elif kind=='motorcycle':
            if source.startswith(('tire_front','rim_front','brake_disk_front','bolt_front_whe','disk_ABS_front','decal_rim_front')):label='F'
            elif source.startswith(('tire_rear','rim_rear','brake_disk_rear','bolt_rear_wheel','disk_ABS_rear','decal_rim_rear','sproket')):label='R'
            elif source.startswith(('shockabsorber_front','brake_calipper_front','brembo','fender_front','pipe','glass_ribs_front','glass_yellow_front','reflector_small_front01','det_front','bolt_brake_front','bolt_ftont','det_reflector_HL')):stationary_front.append(o)
        if label:wheel_parts.setdefault(label,[]).append(o)
        else:o.parent=chassis
    if len(wheel_parts)!=(2 if kind=='motorcycle' else 4):raise RuntimeError(kind+' missing real wheel groups '+str(wheel_parts.keys()))
    for label,parts in wheel_parts.items():
        rubber=[o for o in parts if any(m and m.name=='Rubber' for m in o.data.materials)]
        lo,hi=bounds(rubber or parts);center=(lo+hi)/2
        pivot=bpy.data.objects.new('Wheel_'+label,None);bpy.context.collection.objects.link(pivot);pivot.parent=root;pivot.location=center
        pivot['front']=label.startswith('F');pivot['side']=-1 if label.endswith('L') else 1 if label.endswith('R') and len(label)==2 else 0;pivot['radius']=(hi.z-lo.z)/2
        roll=bpy.data.objects.new('Roll_'+label,None);bpy.context.collection.objects.link(roll);roll.parent=pivot
        yaw=0
        if kind=='tesla' and label.startswith('F') and rubber:
            vertices=np.array([v.co[:] for v in rubber[0].data.vertices]);_,vectors=np.linalg.eigh(np.cov(vertices.T));axis=vectors[:,0]
            if axis[0]<0:axis=-axis
            yaw=math.atan2(axis[1],axis[0])
        for o in parts:
            o.data.transform(Matrix.Translation(-center));
            if yaw:o.data.transform(Matrix.Rotation(-yaw,4,'Z'))
            o.parent=pivot if kind=='bmw' and o.get('sourceMaterial')=='caliper' else roll;o.matrix_basis=Matrix.Identity(4)
        if kind=='motorcycle' and label=='F':
            for o in stationary_front:o.data.transform(Matrix.Translation(-center));o.parent=pivot;o.matrix_basis=Matrix.Identity(4)
    for o in meshes:
        painted=any(m and m.name=='Paint' for m in o.data.materials)
        optical=any(m and m.name.startswith('Glass') for m in o.data.materials)
        preserve_normals=kind=='ferrari' and (painted or optical)
        if len(o.data.polygons)>1000 and not preserve_normals:
            modifier=o.modifiers.new('Offline silhouette-preserving web reduction','DECIMATE');modifier.ratio=.16 if kind=='motorcycle' and painted else ratio
            bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=modifier.name)
        if painted and not preserve_normals:
            for p in o.data.polygons:p.use_smooth=True
            o.data.normals_split_custom_set([(0,0,0)]*len(o.data.loops))
    for image in bpy.data.images:
        if max(image.size)>1024 and image.source!='GENERATED':
            factor=1024/max(image.size);image.scale(max(1,int(image.size[0]*factor)),max(1,int(image.size[1]*factor)))
    for parent in [chassis]+[o for o in root.children if o.name.startswith('Wheel_')]+[o for o in bpy.context.scene.objects if o.name.startswith('Roll_')]:join_material_groups(parent)
    bpy.ops.object.select_all(action='DESELECT')
    def select_tree(o):
        o.select_set(True)
        for c in o.children:select_tree(c)
    select_tree(root)
    bpy.ops.export_scene.gltf(filepath=os.path.join(dest,kind+'.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_image_format='JPEG',export_jpeg_quality=92)
    count=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH' and o.select_get())
    print('PREPARED',kind,count,'triangles',os.path.getsize(os.path.join(dest,kind+'.glb')),'bytes',flush=True)
sys.stdout.flush();os._exit(0)
