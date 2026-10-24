# Build step for HOMI's web assets from the approved master (homatch-video/h2/blender/assets/HOMI_MASTER_film_temp.blend).
# Usage: blender -b <master.blend> --python scripts/homi/render-stills.py -- <output>   (export-glb.py also takes a decimate ratio, 0.45)
# Outputs are committed: public/models/homi/homi.glb and public/images/homi/*.webp. Re-run only when the master changes.
# Render HOMI pose stills from the approved Blender master (one-off build step).
# Same pivot grouping as the web GLB export, so stills and the live 3D match.
import bpy, sys, math, os
from mathutils import Vector, Euler

out_dir = sys.argv[sys.argv.index('--') + 1]
os.makedirs(out_dir, exist_ok=True)
objs = {o.name: o for o in bpy.data.objects}

def center(names):
    pts = []
    for n in names:
        o = objs[n]; pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    v = Vector((0, 0, 0))
    for p in pts: v += p
    return v / len(pts)

def group_of(n):
    s = n[5:]
    side = 'L' if n.endswith('_L') else ('R' if n.endswith('_R') else '')
    if s.startswith('Face_Eye'): return 'EYE_' + side
    if s.startswith('Face_') or s.startswith('Head_'): return 'HEAD'
    if s.startswith('Hand_') or s.startswith('Arm_Wrist') or s.startswith('Arm_Forearm') or s.startswith('Arm_Elbow'): return 'FOREARM_' + side
    if s.startswith('Arm_'): return 'ARM_' + side
    return 'BODY'

groups = {}
for n, o in objs.items():
    if o.type == 'MESH': groups.setdefault(group_of(n), []).append(n)
piv = {'HEAD': 'HOMI_Neck_Joint', 'ARM_L': 'HOMI_Arm_ShoulderJoint_L', 'ARM_R': 'HOMI_Arm_ShoulderJoint_R',
       'FOREARM_L': 'HOMI_Arm_Elbow_L', 'FOREARM_R': 'HOMI_Arm_Elbow_R'}
parent_of = {'EYE_L': 'HEAD', 'EYE_R': 'HEAD', 'FOREARM_L': 'ARM_L', 'FOREARM_R': 'ARM_R'}

for o in list(objs.values()):
    if o.type == 'MESH':
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
empties = {}
for g, names in groups.items():
    loc = center([piv[g]]) if g in piv else center(names)
    e = bpy.data.objects.new('P_' + g, None); bpy.context.scene.collection.objects.link(e); e.location = loc; empties[g] = e
bpy.context.view_layer.update()
for g, e in empties.items():
    if g in parent_of:
        p = empties[parent_of[g]]; mw = e.matrix_world.copy(); e.parent = p; e.matrix_world = mw
bpy.context.view_layer.update()
for g, names in groups.items():
    for n in names:
        o = objs[n]; mw = o.matrix_world.copy(); o.parent = empties[g]; o.matrix_world = mw
root = objs.get('HOMI_ROOT')
if root: root.hide_render = True

# Blender: character faces -Y; arms rotate about Y (frontal plane). L arm = +X side.
def pose(head=(0, 0, 0), armL=0.0, armR=0.0, foreL=0.0, foreR=0.0, eye=(0, 0), fwd=0.0, foreFwd=0.0, twistL=0.0, twistR=0.0):
    empties['HEAD'].rotation_euler = Euler((math.radians(head[0]), math.radians(head[1]), math.radians(head[2])))
    # fwd / foreFwd swing the arms toward the viewer (about X), e.g. typing.
    empties['ARM_L'].rotation_euler = Euler((math.radians(-fwd), math.radians(-armL), 0))
    empties['ARM_R'].rotation_euler = Euler((math.radians(-fwd), math.radians(armR), 0))
    # twist (about the forearm's own axis, applied first) turns the palm: -90 R / +90 L faces the viewer.
    for s in ('FOREARM_L', 'FOREARM_R'): empties[s].rotation_mode = 'ZXY'
    empties['FOREARM_L'].rotation_euler = Euler((math.radians(-foreFwd), math.radians(-foreL), math.radians(twistL)), 'ZXY')
    empties['FOREARM_R'].rotation_euler = Euler((math.radians(-foreFwd), math.radians(foreR), math.radians(twistR)), 'ZXY')
    for s in ('EYE_L', 'EYE_R'):
        e = empties[s]; e.location = e.location  # eyes follow head; offsets small and optional

POSES = {
    'idle':        dict(),
    'greeting':    dict(armR=100, foreR=65, twistR=-90, head=(0, -6, 0)),
    'thinking':    dict(head=(8, 8, 0), armL=40, foreL=110),
    'searching':   dict(head=(0, 0, 18)),
    'explaining':  dict(armL=35, foreL=70),
    'happy':       dict(armL=60, armR=60, head=(0, 4, 0)),
    'pointing':    dict(armL=85, foreL=5, head=(0, 0, -14)),
    'error':       dict(head=(-6, -8, 0), armR=25, foreR=60),
    'success':     dict(armL=150, armR=150, foreL=20, foreR=20),
    'listening':   dict(head=(0, 7, 0)),
    'encouraging': dict(armR=70, foreR=95, head=(0, 5, 0)),
    'writing':     dict(armL=6, armR=6, foreL=-62, foreR=-62, fwd=30, foreFwd=55, head=(-14, 0, 0)),
    'surprised':   dict(armL=45, foreL=120, armR=45, foreR=120, head=(10, 0, 0)),
}

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.quality = 88
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'

for o in [o for o in scene.objects if o.type in ('CAMERA', 'LIGHT')]:
    bpy.data.objects.remove(o, do_unlink=True)
def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if hasattr(d, 'size'): d.size = size
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.9)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light('key', 'AREA', (1.6, -3.0, 2.6), 900, size=2.5)
light('fill', 'AREA', (-2.4, -2.2, 1.4), 300, size=3)
light('rim', 'AREA', (-1.5, 2.6, 2.2), 700, color=(1.0, 0.72, 0.32), size=2)
if scene.world is None: scene.world = bpy.data.worlds.new('w')
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get('Background')
if bg: bg.inputs[1].default_value = 0.35

cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 85

CROPS = {
    # name: (target z, distance, size)
    'head': ((0, 0, 1.47), 2.1, 256),
    'bust': ((0, 0, 1.05), 4.6, 512),
    'upper': ((0, 0, 1.22), 3.0, 320),
}
for crop, (tz, dist, size) in CROPS.items():
    scene.render.resolution_x = size; scene.render.resolution_y = size
    target = Vector(tz)
    cam.location = target + Vector((0, -dist, 0.08))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for name, p in POSES.items():
        pose(**p); bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out_dir, f'homi-{crop}-{name}.webp')
        bpy.ops.render.render(write_still=True)
print('DONE')
