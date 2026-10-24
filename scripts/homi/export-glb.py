# Build step for HOMI's web assets from the approved master (homatch-video/h2/blender/assets/HOMI_MASTER_film_temp.blend).
# Usage: blender -b <master.blend> --python scripts/homi/export-glb.py -- <output>   (export-glb.py also takes a decimate ratio, 0.45)
# Outputs are committed: public/models/homi/homi.glb and public/images/homi/*.webp. Re-run only when the master changes.
import bpy, sys, os
from mathutils import Vector
out = sys.argv[sys.argv.index('--')+1]
ratio = float(sys.argv[sys.argv.index('--')+2])
objs = {o.name:o for o in bpy.data.objects}
def center(names):
    pts=[]
    for n in names:
        o=objs[n]; pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    v=Vector((0,0,0))
    for p in pts: v+=p
    return v/len(pts)
def group_of(n):
    s = n[5:]
    side = 'L' if n.endswith('_L') else ('R' if n.endswith('_R') else '')
    if s.startswith('Face_Eye') : return 'EYE_'+side
    if s.startswith('Face_Brow'): return 'BROW_'+side
    if s.startswith('Face_Mouth'): return 'MOUTH'
    if s.startswith('Head_'): return 'HEAD'
    if s.startswith('Hand_') or s.startswith('Arm_Wrist') or s.startswith('Arm_Forearm') or s.startswith('Arm_Elbow'): return 'FOREARM_'+side
    if s.startswith('Arm_'): return 'ARM_'+side
    return 'BODY'
groups={}
for n,o in objs.items():
    if o.type=='MESH': groups.setdefault(group_of(n),[]).append(n)
piv = {
 'HEAD': objs['HOMI_Neck_Joint'], 'ARM_L': objs['HOMI_Arm_ShoulderJoint_L'], 'ARM_R': objs['HOMI_Arm_ShoulderJoint_R'],
 'FOREARM_L': objs['HOMI_Arm_Elbow_L'], 'FOREARM_R': objs['HOMI_Arm_Elbow_R'],
}
parent_of = {'EYE_L':'HEAD','EYE_R':'HEAD','BROW_L':'HEAD','BROW_R':'HEAD','MOUTH':'HEAD','FOREARM_L':'ARM_L','FOREARM_R':'ARM_R'}
# unparent everything, apply transforms
for o in list(objs.values()):
    if o.type=='MESH':
        mw=o.matrix_world.copy(); o.parent=None; o.matrix_world=mw
bpy.ops.object.select_all(action='DESELECT')
for o in objs.values():
    if o.type=='MESH': o.select_set(True)
bpy.context.view_layer.objects.active=[o for o in objs.values() if o.type=='MESH'][0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
empties={}
for g,names in groups.items():
    loc = center([piv[g].name]) if g in piv else center(names)
    e=bpy.data.objects.new('HOMI_'+g, None); bpy.context.scene.collection.objects.link(e); e.location=loc; empties[g]=e
bpy.context.view_layer.update()
for g,e in empties.items():
    if g in parent_of:
        p=empties[parent_of[g]]; mw=e.matrix_world.copy(); e.parent=p; e.matrix_world=mw
bpy.context.view_layer.update()
tris=0
for g,names in groups.items():
    bymat={}
    for n in names:
        o=objs[n]; m=o.active_material.name if o.active_material else 'none'
        bymat.setdefault(m,[]).append(o)
    for m,lst in bymat.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in lst: o.select_set(True)
        bpy.context.view_layer.objects.active=lst[0]
        if len(lst)>1: bpy.ops.object.join()
        j=bpy.context.view_layer.objects.active
        j.name=f'HOMI_{g}__{m}'
        if ratio<1 and len(j.data.polygons)>400:
            d=j.modifiers.new('dec','DECIMATE'); d.ratio=ratio
            bpy.ops.object.modifier_apply(modifier='dec')
        mw=j.matrix_world.copy(); j.parent=empties[g]; j.matrix_world=mw
        j.data.calc_loop_triangles(); tris+=len(j.data.loop_triangles)
root=bpy.data.objects.get('HOMI_ROOT')
if root: bpy.data.objects.remove(root)
print('TRIS',tris)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_draco_mesh_compression_enable=True,
  export_draco_mesh_compression_level=7, export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
