import bpy,json,pathlib,hashlib,sys
base=pathlib.Path(sys.argv[1]).resolve()
out=pathlib.Path(__file__).resolve().parents[1]/"public/models/animal-riders";out.mkdir(exist_ok=True)
maps={
"bear":{"Bone":"Hips","Bone.001":"Shoulders","Bone.006":"FrontLeg.R","Bone.007":"FrontUpLeg.R","Bone.008":"FrontLowLeg.R","Bone.009":"FrontLeg.L","Bone.010":"FrontUpLeg.L","Bone.011":"FrontLowLeg.L","Bone.012":"BackUpLeg.R","Bone.013":"BackLowLeg.R","Bone.014":"BackUpLeg.L","Bone.015":"BackLowLeg.L"},
"bunny":{"Bone":"Hips","Bone.011":"Shoulders","Bone.012":"Head","Bone.001":"FrontLeg.L","Bone.002":"FrontUpLeg.L","Bone.003":"FrontLowLeg.L","Bone.004":"FrontLeg.R","Bone.005":"FrontUpLeg.R","Bone.006":"FrontLowLeg.R","Bone.007":"BackUpLeg.L","Bone.008":"BackLowLeg.L","Bone.009":"BackUpLeg.R","Bone.010":"BackLowLeg.R","Bone.014":"LongEarA","Bone.016":"LongEarB"},
"pig":{"Bone":"Hips","Bone.005":"Shoulders","Bone.006":"Head","Bone.001":"FrontUpLeg.R","Bone.002":"FrontLowLeg.R","Bone.003":"FrontUpLeg.L","Bone.004":"FrontLowLeg.L","Bone.011":"BackUpLeg.R","Bone.012":"BackLowLeg.R","Bone.014":"BackUpLeg.L","Bone.015":"BackLowLeg.L"}}
records=[]
for kind,mapping in maps.items():
 if kind!="bunny":mapping={old:new.replace(".L",".TEMP").replace(".R",".L").replace(".TEMP",".R") for old,new in mapping.items()}
 source=base/(kind+".blend");bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
 arm=next(o for o in bpy.data.objects if o.type=="ARMATURE")
 arm.animation_data_clear();arm.data.pose_position="POSE"
 for bone in arm.pose.bones:bone.matrix_basis.identity()
 for old,new in mapping.items():arm.data.bones[old].name=new
 bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode="EDIT")
 for limb in ["FrontLowLeg.L","FrontLowLeg.R","BackLowLeg.L","BackLowLeg.R"]+(["LongEarA","LongEarB"] if kind=="bunny" else []):
  bone=arm.data.edit_bones[limb];tip=arm.data.edit_bones.new(limb+"_end");tip.head=bone.tail;tip.tail=bone.tail+(bone.tail-bone.head).normalized()*.03;tip.parent=bone;tip.use_deform=False
 bpy.ops.object.mode_set(mode="OBJECT")
 sourceinfo={"page":"https://juggypuggy.itch.io/low-poly-animals","file":kind+".blend","license":"Juggy Animal Characters licence, commercial/project use with attribution","sha256":hashlib.sha256(source.read_bytes()).hexdigest()}
 arm["downloadedSource"]=sourceinfo;arm["animalCharacter"]=kind
 bpy.ops.object.select_all(action="DESELECT")
 for obj in bpy.data.objects:
  if obj.type not in {"MESH","ARMATURE"}:continue
  obj.select_set(True);obj["downloadedSource"]=sourceinfo
  if obj.type=="MESH":
   for face in obj.data.polygons:face.use_smooth=True
 file=out/(kind+".glb")
 bpy.ops.export_scene.gltf(filepath=str(file),export_format="GLB",use_selection=True,export_extras=True,export_animations=False,export_skins=True,export_all_influences=False,export_def_bones=False)
 records.append({"file":file.name,"bytes":file.stat().st_size,"sha256":hashlib.sha256(file.read_bytes()).hexdigest(),"source":sourceinfo,"adaptation":"Original full downloaded rounded character and skin weights preserved. Blender rest pose export, source bone names standardised, four nondeforming IK contact markers at original limb ends added. No replacement body geometry or old Quaternius animal was used.","originalVertices":sum(len(o.data.vertices) for o in bpy.data.objects if o.type=="MESH")})
 print("EXPORTED",kind,file.stat().st_size,flush=True)
(out/"sources.json").write_text(json.dumps({"files":records},indent=2)+"\n")
(out/"LICENSE.txt").write_bytes((base/"LICENSE_AnimalCharacters.txt").read_bytes())
