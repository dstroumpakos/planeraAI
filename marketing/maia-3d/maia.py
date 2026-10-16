# Chibi "Atlas" hugging the Earth — test scene, built entirely from script.
# Run:  blender -b --factory-startup --python atlas_chibi.py -- <out_dir> [still|anim]
import bpy, bmesh, math, sys, os
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.dirname(__file__)
MODE = argv[1] if len(argv) > 1 else "still"
os.makedirs(OUT, exist_ok=True)

# ── reset ────────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, color, rough=0.5, sss=0.0, metallic=0.0, emission=None, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        b.inputs["Subsurface Scale"].default_value = 0.08
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1)
        b.inputs["Emission Strength"].default_value = emission[1]
    return m

SKIN = mat("Skin", (0.98, 0.74, 0.60), rough=0.45, sss=0.25)
BLUSH = mat("Blush", (1.0, 0.45, 0.45), rough=0.6)
HAIR = mat("Hair", (0.035, 0.022, 0.016), rough=0.42, coat=0.15)
EYE = mat("Eye", (0.06, 0.035, 0.025), rough=0.08, coat=1.0)
IRIS = mat("Iris", (0.32, 0.20, 0.12), rough=0.15)
SHINE = mat("Shine", (1, 1, 1), rough=0.2, emission=((1, 1, 1), 4.0))
BROW = mat("Brow", (0.08, 0.05, 0.03), rough=0.6)
MOUTH = mat("Mouth", (0.45, 0.16, 0.14), rough=0.5)
HOODIE = mat("Hoodie", (1.0, 0.80, 0.0), rough=0.75)  # Planera yellow
HOODIE_DARK = mat("HoodieTrim", (0.85, 0.62, 0.0), rough=0.8)
PANTS = mat("Pants", (0.06, 0.06, 0.07), rough=0.7)
SHOE = mat("Shoe", (0.05, 0.05, 0.05), rough=0.35)
SOLE = mat("Sole", (0.95, 0.95, 0.93), rough=0.5)

def smooth(obj, levels=2):
    for p in obj.data.polygons:
        p.use_smooth = True
    if levels:
        mod = obj.modifiers.new("Subsurf", "SUBSURF")
        mod.levels = levels
        mod.render_levels = levels
    return obj

def sphere(name, loc, scale, material, parent=None, rot=(0, 0, 0), seg=32, sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.rotation_euler = rot
    o.data.materials.append(material)
    smooth(o, sub)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o

def tube(name, points, radius, material, parent=None, taper_end=1.0):
    cd = bpy.data.curves.new(name, "CURVE")
    cd.dimensions = "3D"
    cd.bevel_depth = radius
    cd.bevel_resolution = 6
    cd.use_fill_caps = True
    sp = cd.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    sp.bezier_points[-1].radius = taper_end
    o = bpy.data.objects.new(name, cd)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o

# ── rig empties ──────────────────────────────────────────────────────────────
ROOT = empty("Root", (0, 0, 0))
BODY = empty("Body", (0, 0, 0), ROOT)          # breathing / bob
HEAD_PIVOT = Vector((0, 0, 1.92))
HEAD = empty("HeadRig", HEAD_PIVOT, BODY)       # tilt
HC = Vector((0, 0, 0.78))                       # head centre, local to HeadRig

def on_head(dir_vec, r=1.0):
    return HC + Vector(dir_vec).normalized() * r

# ── head ─────────────────────────────────────────────────────────────────────
head = sphere("Head", HEAD_PIVOT + HC, (1.0, 0.94, 0.92), SKIN, seg=48)
head.parent = HEAD; head.location = HC
for side in (-1, 1):
    ear = sphere(f"Ear{side}", (0, 0, 0), (0.12, 0.08, 0.18), SKIN, seg=24)
    ear.parent = HEAD; ear.location = on_head((side, 0.05, -0.1), 0.95)
    # eyes: big glossy anime eyes
    eye_dir = Vector((0.36 * side, -0.9, -0.12))
    eye = sphere(f"Eye{side}", (0, 0, 0), (0.17, 0.07, 0.23), EYE, seg=32)
    eye.parent = HEAD; eye.location = on_head(eye_dir, 0.9)
    eye.rotation_euler = (0, 0, math.radians(-21 * side))
    iris = sphere(f"Iris{side}", (0, 0, 0), (0.11, 0.03, 0.13), IRIS, seg=24)
    iris.parent = HEAD; iris.location = on_head(eye_dir + Vector((0, 0, -0.08)), 0.955)
    iris.rotation_euler = eye.rotation_euler
    for k, (dx, dz, s) in enumerate(((-0.05, 0.08, 0.055), (0.05, -0.08, 0.03))):
        sh = sphere(f"Shine{side}{k}", (0, 0, 0), (s, s * 0.5, s), SHINE, seg=16, sub=0)
        sh.parent = HEAD; sh.location = on_head(eye_dir + Vector((dx * side, 0, dz)), 0.975)
    blush = sphere(f"Blush{side}", (0, 0, 0), (0.13, 0.02, 0.07), BLUSH, seg=16)
    blush.parent = HEAD; blush.location = on_head((0.55 * side, -0.82, -0.36), 0.955)
    blush.rotation_euler = (0, 0, math.radians(-34 * side))
    brow = tube(f"Brow{side}", [on_head((0.2 * side, -0.9, 0.2), 0.985), on_head((0.36 * side, -0.88, 0.24), 0.995), on_head((0.52 * side, -0.8, 0.2), 0.985)], 0.022, BROW, HEAD)
mouth = tube("Mouth", [on_head((-0.06, -0.97, -0.42), 0.975), on_head((0, -0.98, -0.44), 0.98), on_head((0.06, -0.97, -0.42), 0.975)], 0.016, MOUTH, HEAD)

# ── hair: a cap plus a crown of soft spikes, bangs falling over the brow ─────
cap = sphere("HairCap", (0, 0, 0), (1.07, 1.03, 1.03), HAIR, seg=64, sub=2)
cap.parent = HEAD; cap.location = HC + Vector((0, 0.16, 0.2))

import random
random.seed(7)
def spike(name, base_dir, length, width, droop, twist=0.0):
    d = Vector(base_dir).normalized()
    base = on_head(d, 0.92)
    # spike tip: outward along the normal, bent toward `droop` (usually down/back)
    tip = base + d * length * 0.32 + Vector(droop) * length
    mid = base + (tip - base) * 0.45 + d * length * 0.3  # bulge outward: volume, then fall
    t = tube(name, [base, mid, tip], width, HAIR, HEAD, taper_end=0.05)
    return t

# crown and back
for i in range(95):
    az = random.uniform(-180, 180)
    el = random.uniform(5, 85)
    d = (math.cos(math.radians(el)) * math.sin(math.radians(az)),
         math.cos(math.radians(el)) * math.cos(math.radians(az)),
         math.sin(math.radians(el)))
    if d[1] < -0.55 and d[2] < 0.55:
        continue  # keep the face clear; bangs handle the front
    out = Vector((d[0], d[1], 0)).normalized() if abs(d[0]) + abs(d[1]) > 0.01 else Vector((0, 1, 0))
    swirl = Vector((random.uniform(-0.3, 0.3), random.uniform(-0.05, 0.25), random.uniform(-0.95, -0.35)))
    spike(f"Spike{i}", d, random.uniform(0.45, 0.85), random.uniform(0.17, 0.25), out * 0.3 + swirl)
# bangs over the forehead
for i, x in enumerate((-0.62, -0.45, -0.28, -0.1, 0.08, 0.26, 0.44, 0.62)):
    d = (x, -0.62, 0.72)
    spike(f"Bang{i}", d, random.uniform(0.62, 0.78), random.uniform(0.11, 0.15), (x * 0.35 + random.uniform(-0.15, 0.15), -0.38, -0.8))
# side locks
for side in (-1, 1):
    for k, z in enumerate((0.35, 0.05)):
        spike(f"Side{side}{k}", (0.92 * side, -0.3 + 0.25 * k, z), 0.62, 0.14, (0.2 * side, -0.1, -0.9))

# ── Maia: longer hair, a ponytail with a yellow scrunchie, a clip, soft lashes ─
SCRUNCHIE = mat("Scrunchie", (1.0, 0.82, 0.0), rough=0.7)
LIPS = mat("Lips", (0.85, 0.36, 0.38), rough=0.45)
LASHES = mat("Lashes", (0.04, 0.025, 0.02), rough=0.5)
# long locks falling past the cheeks to the shoulders
for side in (-1, 1):
    for k, (y, z, ln) in enumerate(((-0.42, 0.1, 1.15), (-0.18, 0.15, 1.25), (0.08, 0.2, 1.3), (0.32, 0.25, 1.2))):
        spike(f"Lock{side}{k}", (0.95 * side, y, z), ln, 0.16, (0.12 * side, 0.08 + 0.05 * k, -1.0))
# hair falling down the back
for k, x in enumerate((-0.5, -0.25, 0.0, 0.25, 0.5)):
    spike(f"BackHair{k}", (x, 0.95, 0.15), 1.2, 0.2, (x * 0.2, 0.15, -1.0))
# ponytail from the crown, swinging back and down, with a yellow scrunchie
PT = on_head((0.62, 0.3, 0.7), 1.04)  # side ponytail, on the side facing the camera
cd = bpy.data.curves.new("ScrunchieC", "CURVE")
scr = sphere("Scrunchie", (0, 0, 0), (0.17, 0.17, 0.11), SCRUNCHIE, seg=32)
scr.parent = HEAD; scr.location = PT; scr.rotation_euler = (0, math.radians(55), math.radians(-15))
for k in range(9):
    a = 2 * math.pi * k / 9
    off = Vector((0.07 * math.cos(a), 0.05 * math.sin(a), 0.03 * math.sin(a)))
    tip = PT + off * 2 + Vector((0.5 + random.uniform(-0.1, 0.1), 0.2 + random.uniform(-0.1, 0.1), -1.05))
    mid = PT + off + Vector((0.42, 0.1, 0.02))
    tube(f"Ponytail{k}", [PT + off, mid, tip], 0.11, HAIR, HEAD, taper_end=0.05)
# a little yellow hair clip in the bangs
clip = sphere("HairClip", (0, 0, 0), (0.2, 0.055, 0.07), SCRUNCHIE, seg=24)
clip.parent = HEAD; clip.location = on_head((-0.5, -0.66, 0.56), 1.2); clip.rotation_euler = (0, math.radians(30), math.radians(-25))
# lash flicks (not named "Eye…" so blinks leave them be)
for side in (-1, 1):
    # just a small flick off the outer corner of the eye (a full lash line read as a second brow)
    tube(f"Lash{side}", [on_head((0.47 * side, -0.85, 0.04), 0.975), on_head((0.55 * side, -0.8, 0.1), 0.975)], 0.016, LASHES, HEAD, taper_end=0.2)
# pinker lips
m = bpy.data.objects.get("Mouth")
if m:
    m.data.materials[0] = LIPS

# ── body: hoodie, hood, pants, sneakers ──────────────────────────────────────
torso = sphere("Hoodie", (0, 0, 1.18), (0.62, 0.5, 0.7), HOODIE, seg=40)
torso.parent = BODY
hem = sphere("HoodieHem", (0, 0, 0.66), (0.6, 0.48, 0.13), HOODIE_DARK, seg=32)
hem.parent = BODY
hood = sphere("Hood", (0, 0.32, 1.78), (0.6, 0.32, 0.26), HOODIE, seg=32)
hood.parent = BODY
for side in (-1, 1):
    tube(f"Drawstring{side}", [Vector((0.14 * side, -0.48, 1.62)), Vector((0.15 * side, -0.52, 1.4)), Vector((0.13 * side, -0.5, 1.22))], 0.018, SOLE, BODY)
    leg = sphere(f"Leg{side}", (0.26 * side, 0, 0.42), (0.23, 0.25, 0.36), PANTS, seg=32)
    leg.parent = BODY
    pocket = sphere(f"Pocket{side}", (0.43 * side, -0.05, 0.42), (0.06, 0.15, 0.13), PANTS, seg=16)
    pocket.parent = BODY
    shoe = sphere(f"Shoe{side}", (0.27 * side, -0.12, 0.1), (0.2, 0.32, 0.12), SHOE, seg=32)
    shoe.parent = BODY
    sole = sphere(f"Sole{side}", (0.27 * side, -0.12, 0.03), (0.21, 0.33, 0.05), SOLE, seg=32)
    sole.parent = BODY

# ── the Earth: procedural continents, clouds and an atmosphere glow ──────────
GLOBE = empty("GlobeRig", (0.82, -0.5, 1.22), BODY)
R = 0.7

earth_m = bpy.data.materials.new("Earth")
earth_m.use_nodes = True
nt = earth_m.node_tree; N = nt.nodes; L = nt.links
bsdf = N["Principled BSDF"]
tc = N.new("ShaderNodeTexCoord")
noise = N.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 1.6; noise.inputs["Detail"].default_value = 9; noise.inputs["Roughness"].default_value = 0.62
L.new(tc.outputs["Object"], noise.inputs["Vector"])
land = N.new("ShaderNodeValToRGB"); land.color_ramp.elements[0].position = 0.475; land.color_ramp.elements[1].position = 0.49
L.new(noise.outputs["Fac"], land.inputs["Fac"])
noise2 = N.new("ShaderNodeTexNoise"); noise2.inputs["Scale"].default_value = 6; noise2.inputs["Detail"].default_value = 6
L.new(tc.outputs["Object"], noise2.inputs["Vector"])
landcol = N.new("ShaderNodeValToRGB")
landcol.color_ramp.elements[0].color = (0.08, 0.32, 0.07, 1); landcol.color_ramp.elements[1].color = (0.55, 0.45, 0.25, 1)
L.new(noise2.outputs["Fac"], landcol.inputs["Fac"])
ocean = N.new("ShaderNodeValToRGB")
ocean.color_ramp.elements[0].color = (0.004, 0.025, 0.16, 1); ocean.color_ramp.elements[1].color = (0.01, 0.09, 0.36, 1)
L.new(noise.outputs["Fac"], ocean.inputs["Fac"])
mixc = N.new("ShaderNodeMix"); mixc.data_type = "RGBA"
L.new(land.outputs["Color"], mixc.inputs["Factor"])
L.new(ocean.outputs["Color"], mixc.inputs[6]); L.new(landcol.outputs["Color"], mixc.inputs[7])
L.new(mixc.outputs[2], bsdf.inputs["Base Color"])
rough = N.new("ShaderNodeMapRange"); rough.inputs["To Min"].default_value = 0.32; rough.inputs["To Max"].default_value = 0.8
L.new(land.outputs["Color"], rough.inputs["Value"])
L.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
# city lights on the land, faint
bsdf.inputs["Emission Color"].default_value = (1.0, 0.75, 0.35, 1)
cities = N.new("ShaderNodeTexNoise"); cities.inputs["Scale"].default_value = 40
L.new(tc.outputs["Object"], cities.inputs["Vector"])
cmask = N.new("ShaderNodeMath"); cmask.operation = "MULTIPLY"
cthr = N.new("ShaderNodeMath"); cthr.operation = "GREATER_THAN"; cthr.inputs[1].default_value = 0.68
L.new(cities.outputs["Fac"], cthr.inputs[0])
L.new(cthr.outputs[0], cmask.inputs[0]); L.new(land.outputs["Color"], cmask.inputs[1])
cstr = N.new("ShaderNodeMath"); cstr.operation = "MULTIPLY"; cstr.inputs[1].default_value = 0.6
L.new(cmask.outputs[0], cstr.inputs[0]); L.new(cstr.outputs[0], bsdf.inputs["Emission Strength"])

earth = sphere("Earth", (0, 0, 0), (R, R, R), earth_m, GLOBE, seg=64, sub=1)
earth.parent = GLOBE; earth.location = (0, 0, 0)

cloud_m = bpy.data.materials.new("Clouds")
cloud_m.use_nodes = True
nt = cloud_m.node_tree; N = nt.nodes; L = nt.links
cb = N["Principled BSDF"]; cb.inputs["Base Color"].default_value = (1, 1, 1, 1); cb.inputs["Roughness"].default_value = 0.9
ctc = N.new("ShaderNodeTexCoord")
cn = N.new("ShaderNodeTexNoise"); cn.inputs["Scale"].default_value = 3.2; cn.inputs["Detail"].default_value = 10; cn.inputs["Distortion"].default_value = 0.6
L.new(ctc.outputs["Object"], cn.inputs["Vector"])
cr = N.new("ShaderNodeValToRGB"); cr.color_ramp.elements[0].position = 0.6; cr.color_ramp.elements[1].position = 0.78
L.new(cn.outputs["Fac"], cr.inputs["Fac"])
L.new(cr.outputs["Color"], cb.inputs["Alpha"])
clouds = sphere("Clouds", (0, 0, 0), (R * 1.015,) * 3, cloud_m, seg=64, sub=1)
clouds.parent = GLOBE; clouds.location = (0, 0, 0)

atmo_m = bpy.data.materials.new("Atmosphere")
atmo_m.use_nodes = True
nt = atmo_m.node_tree; N = nt.nodes; L = nt.links
N.remove(N["Principled BSDF"])
out = N["Material Output"]
lw = N.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.12
em = N.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (0.35, 0.65, 1.0, 1); em.inputs["Strength"].default_value = 1.2
tr = N.new("ShaderNodeBsdfTransparent")
mx = N.new("ShaderNodeMixShader")
L.new(lw.outputs["Facing"], mx.inputs["Fac"]); L.new(tr.outputs[0], mx.inputs[1]); L.new(em.outputs[0], mx.inputs[2])
L.new(mx.outputs[0], out.inputs["Surface"])
atmo = sphere("Atmosphere", (0, 0, 0), (R * 1.03,) * 3, atmo_m, seg=64, sub=1)
atmo.parent = GLOBE; atmo.location = (0, 0, 0)
for m in (cloud_m, atmo_m):
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        m.blend_method = "BLEND"

# ── arms hugging the globe (sleeves + hands) ────────────────────────────────
def globe_point(d, k=1.0):
    return GLOBE.location + Vector(d).normalized() * R * k

HAND_SIZE = (0.13, 0.085, 0.15)  # flat side (y) presses against the globe

def hand_on_globe(name, hand_dir):
    """A hand resting ON the globe: outside the cloud and atmosphere shells
    (so they never draw over it), with its palm flattened against the surface."""
    n = Vector(hand_dir).normalized()
    pos = GLOBE.location + n * (R * 1.03 + HAND_SIZE[1] * 0.8)
    h = sphere(name, pos, HAND_SIZE, SKIN, BODY, seg=24)
    h.location = pos
    h.rotation_euler = n.to_track_quat("Y", "Z").to_euler()
    return h

def arm(side, points, hand_dir):
    """Sleeve through `points` (shoulder → … → near the hand), hand resting on the globe."""
    h = hand_on_globe(f"Hand{side}", hand_dir)
    sleeve_end = h.location + (points[-1] - h.location).normalized() * 0.17
    tube(f"Sleeve{side}", [*points, sleeve_end], 0.15, HOODIE, BODY, taper_end=0.85)
    cuff = sphere(f"Cuff{side}", sleeve_end, (0.13, 0.13, 0.13), HOODIE_DARK, BODY, seg=24)
    cuff.location = sleeve_end
    return h

# A hug: the arm on the globe's side goes behind it and its hand comes round the
# far (right) side; the other arm crosses in front of the body to hold the left side.
arm("R", [Vector((0.5, -0.05, 1.62)), Vector((0.95, 0.35, 1.62)), Vector((1.55, 0.2, 1.3))], (0.9, 0.25, -0.3))
arm("L", [Vector((-0.52, -0.05, 1.6)), Vector((-0.38, -0.85, 1.22))], (-0.78, -0.6, -0.05))

# head leans toward the globe, like the reference
HEAD.rotation_euler = (math.radians(4), math.radians(-7), math.radians(8))

# ── floor, lights, camera ────────────────────────────────────────────────────
# soft contact shadow so he stands on whatever card he's placed on
shadow_m = bpy.data.materials.new("BlobShadow")
nt = shadow_m.node_tree if shadow_m.node_tree else None
shadow_m.use_nodes = True
N = shadow_m.node_tree.nodes; Lk = shadow_m.node_tree.links
sb = N["Principled BSDF"]; sb.inputs["Base Color"].default_value = (0, 0, 0, 1); sb.inputs["Roughness"].default_value = 1
stc = N.new("ShaderNodeTexCoord")
sg = N.new("ShaderNodeTexGradient"); sg.gradient_type = "SPHERICAL"
Lk.new(stc.outputs["Object"], sg.inputs["Vector"])
sp = N.new("ShaderNodeMath"); sp.operation = "POWER"; sp.inputs[1].default_value = 1.8
Lk.new(sg.outputs["Fac"], sp.inputs[0])
sm = N.new("ShaderNodeMath"); sm.operation = "MULTIPLY"; sm.inputs[1].default_value = 0.6
Lk.new(sp.outputs[0], sm.inputs[0]); Lk.new(sm.outputs[0], sb.inputs["Alpha"])
try:
    shadow_m.surface_render_method = "BLENDED"
except Exception:
    shadow_m.blend_method = "BLEND"
bpy.ops.mesh.primitive_plane_add(size=2, location=(0.25, -0.2, 0.002))
blob = bpy.context.object; blob.name = "BlobShadow"; blob.scale = (1.35, 0.8, 1)
blob.data.materials.append(shadow_m)
blob.visible_shadow = False

world = bpy.data.worlds.new("World"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.011, 0.012, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

def area(name, loc, target, energy, size, color):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.size = size; ld.color = color
    o = bpy.data.objects.new(name, ld); bpy.context.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o

area("Key", (-3.5, -5, 4.5), (0, 0, 1.8), 650, 3.0, (1.0, 0.95, 0.9))
area("Fill", (4, -4, 1.5), (0, 0, 1.4), 180, 5.0, (0.85, 0.9, 1.0))
area("Rim", (2.5, 4.5, 3.5), (0, 0, 1.6), 1400, 2.0, (1.0, 0.62, 0.3))
area("RimL", (-3, 4, 2.5), (0, 0, 1.4), 600, 2.0, (1.0, 0.7, 0.4))

cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 70
cam = bpy.data.objects.new("Cam", cam_d); bpy.context.collection.objects.link(cam)
cam.location = (1.6, -10.5, 2.4)
target = Vector((0.12, 0, 1.55))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
cam_d.dof.use_dof = True; cam_d.dof.focus_distance = (target - cam.location).length; cam_d.dof.aperture_fstop = 4.0

# ── Planera logo on the hoodie (ink, like embroidery) ────────────────────────
TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tex")

def image_mat(name, path, emission=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N = m.node_tree.nodes; Lk = m.node_tree.links
    b = N["Principled BSDF"]; b.inputs["Roughness"].default_value = rough
    tex = N.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(path)
    tex.interpolation = "Cubic"
    Lk.new(tex.outputs["Color"], b.inputs["Base Color"])
    Lk.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    if emission:
        Lk.new(tex.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emission
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    return m

def decal(name, path, size, loc, rot, parent=None, wrap_to=None, emission=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name
    o.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=16)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.data.materials.append(image_mat(name + "Mat", path, emission))
    if wrap_to:
        sw = o.modifiers.new("Wrap", "SHRINKWRAP"); sw.target = wrap_to; sw.offset = 0.008
    if parent:
        mw = o.matrix_world.copy(); o.parent = parent; o.matrix_world = mw
    return o

# shorter drawstrings so the logo sits clear on the chest
for side in (-1, 1):
    ds = bpy.data.objects.get(f"Drawstring{side}")
    if ds:
        bpy.data.objects.remove(ds)
    tube(f"Drawstring{side}", [Vector((0.13 * side, -0.47, 1.66)), Vector((0.14 * side, -0.5, 1.61))], 0.018, SOLE, BODY)
decal("HoodieLogo", os.path.join(TEX, "logo_ink.png"), (0.38, 0.117), (-0.06, -0.6, 1.47), (math.radians(90), 0, 0), parent=BODY, wrap_to=torso)

# ── the Planera office behind him ────────────────────────────────────────────
office = bpy.data.collections.new("Office"); scene.collection.children.link(office)
def to_office(o):
    for c in o.users_collection:
        c.objects.unlink(o)
    office.objects.link(o)
    return o

def box(name, loc, size, material, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bv = o.modifiers.new("Bevel", "BEVEL"); bv.width = bevel; bv.segments = 4
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(material)
    return to_office(o)

def cyl(name, loc, r, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=48)
    o = bpy.context.object; o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(material)
    return to_office(o)

WALL = mat("Wall", (0.93, 0.91, 0.86), rough=0.9)
YELLOW_WALL = mat("YellowWall", (1.0, 0.82, 0.0), rough=0.85)
WOOD = bpy.data.materials.new("Wood"); WOOD.use_nodes = True
wn = WOOD.node_tree.nodes; wl = WOOD.node_tree.links
wb = wn["Principled BSDF"]; wb.inputs["Roughness"].default_value = 0.4
wtc = wn.new("ShaderNodeTexCoord")
planks = wn.new("ShaderNodeTexBrick")
planks.inputs["Scale"].default_value = 1.0
planks.inputs["Brick Width"].default_value = 2.4; planks.inputs["Row Height"].default_value = 0.28
planks.inputs["Mortar Size"].default_value = 0.006
planks.inputs["Color1"].default_value = (0.55, 0.38, 0.24, 1); planks.inputs["Color2"].default_value = (0.66, 0.48, 0.31, 1)
planks.inputs["Mortar"].default_value = (0.25, 0.16, 0.1, 1)
wl.new(wtc.outputs["Object"], planks.inputs["Vector"])
grain = wn.new("ShaderNodeTexNoise"); grain.inputs["Scale"].default_value = 3; grain.inputs["Detail"].default_value = 4
wl.new(wtc.outputs["Object"], grain.inputs["Vector"])
gmix = wn.new("ShaderNodeMix"); gmix.data_type = "RGBA"; gmix.blend_type = "MULTIPLY"; gmix.inputs["Factor"].default_value = 0.25
wl.new(planks.outputs["Color"], gmix.inputs[6]); wl.new(grain.outputs["Color"], gmix.inputs[7])
wl.new(gmix.outputs[2], wb.inputs["Base Color"])
DESK = mat("Desk", (0.95, 0.94, 0.92), rough=0.4)
METAL = mat("Metal", (0.08, 0.08, 0.09), rough=0.35, metallic=1.0)
LEAF = mat("Leaf", (0.12, 0.42, 0.14), rough=0.55)
POT = mat("Pot", (0.96, 0.95, 0.93), rough=0.5)
CASE = mat("Suitcase", (1.0, 0.8, 0.0), rough=0.35, coat=0.6)
SCREEN = mat("Screen", (0.05, 0.05, 0.06), rough=0.2, emission=((1.0, 0.86, 0.1), 2.5))
LAMP = mat("LampGlow", (1, 0.9, 0.7), emission=((1.0, 0.82, 0.55), 12.0))

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4, 0)); to_office(bpy.context.object).data.materials.append(WOOD)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 3.6, 4), rotation=(math.radians(90), 0, 0))
wall = bpy.context.object; wall.scale = (24, 8, 1); to_office(wall).data.materials.append(WALL)
# yellow brand panel with the Planera sign on it
box("BrandPanel", (2.85, 3.55, 2.75), (2.9, 0.06, 2.2), YELLOW_WALL, bevel=0.01)
sign = decal("PlaneraSign", os.path.join(TEX, "logo_ink.png"), (2.3, 0.71), (2.85, 3.5, 3.05), (math.radians(90), 0, 0))
to_office(sign)
# world map poster on the cream wall
bpy.ops.mesh.primitive_plane_add(size=1, location=(-2.75, 3.52, 2.9), rotation=(math.radians(90), 0, 0))
poster = bpy.context.object; poster.scale = (1.7, 1.05, 1); to_office(poster).data.materials.append(earth_m)
box("PosterFrame", (-2.75, 3.56, 2.9), (1.82, 0.04, 1.17), METAL, bevel=0.01)
# desk with a laptop showing the app's yellow
box("DeskTop", (2.6, 2.2, 1.02), (2.6, 1.0, 0.07), DESK)
for dx in (-1.15, 1.15):
    box(f"DeskLeg{dx}", (2.6 + dx, 2.2, 0.5), (0.06, 0.9, 1.0), METAL, bevel=0.01)
box("LaptopBase", (2.3, 2.1, 1.07), (0.75, 0.5, 0.03), METAL, bevel=0.01)
box("LaptopScreen", (2.3, 2.38, 1.33), (0.75, 0.03, 0.5), SCREEN, bevel=0.01)
cyl("Mug", (3.1, 2.0, 1.13), 0.08, 0.16, CASE)
# plant in the corner
cyl("PlantPot", (-3.0, 2.4, 0.35), 0.32, 0.7, POT)
random.seed(3)
for i in range(14):
    a = random.uniform(0, 2 * math.pi); h = random.uniform(0.9, 1.9)
    leaf = sphere(f"Leaf{i}", (-3.0 + 0.45 * math.cos(a), 2.4 + 0.35 * math.sin(a), h), (0.12, 0.32, 0.06), LEAF, seg=16, sub=0)
    leaf.rotation_euler = (random.uniform(-0.6, 0.6), random.uniform(-0.6, 0.6), a)
    to_office(leaf)
# yellow suitcase beside him — ready to travel
box("Suitcase", (-1.25, 0.45, 0.5), (0.62, 0.34, 0.86), CASE, bevel=0.08)
box("SuitcaseHandle", (-1.25, 0.45, 1.0), (0.26, 0.06, 0.12), METAL, bevel=0.02)
# pendant lamps
for x in (4.0,):
    cyl(f"LampCord{x}", (x, 1.6, 4.3), 0.01, 1.6, METAL)
    cyl(f"LampShade{x}", (x, 1.6, 3.45), 0.28, 0.22, METAL)
    to_office(sphere(f"LampBulb{x}", (x, 1.6, 3.32), (0.12, 0.12, 0.08), LAMP, seg=16, sub=0))
# warm window light from the left
sun = area("Window", (-6, -1, 4), (0, 1, 1.4), 1600, 5.0, (1.0, 0.9, 0.75))

def office_visible(show):
    office.hide_render = not show
    blob.hide_render = show
    sun.hide_render = not show
    scene.render.film_transparent = not show

# ── render settings ──────────────────────────────────────────────────────────
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        pass
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
try:
    scene.eevee.use_raytracing = True
    scene.eevee.taa_render_samples = 48
except Exception:
    pass

# ── animation: a slow hug-and-breathe loop while the Earth turns ─────────────
FRAMES = 120
BLINKS = (40, 100)
scene.frame_start, scene.frame_end = 1, FRAMES
scene.render.fps = 24
prefs = bpy.context.preferences.edit
def key(obj, path, frame, value):
    setattr(obj, path, value); obj.keyframe_insert(path, frame=frame)
for f, sc in ((1, 1.0), (31, 1.025), (61, 1.0), (91, 1.025), (121, 1.0)):
    key(BODY, "scale", f, (1, 1, sc))
hr = HEAD.rotation_euler.copy()
for f, dz in ((1, 0), (61, 4), (121, 0)):
    key(HEAD, "rotation_euler", f, (hr.x, hr.y, hr.z + math.radians(dz)))
# Frame 121 == frame 1, and a full 360 degrees with linear keys, so it loops cleanly.
prefs.keyframe_new_interpolation_type = "LINEAR"
key(GLOBE, "rotation_euler", 1, (math.radians(-18), 0, 0))
key(GLOBE, "rotation_euler", FRAMES + 1, (math.radians(-18), 0, math.radians(360)))
prefs.keyframe_new_interpolation_type = "BEZIER"
# blink
for e in [o for o in bpy.data.objects if o.name.startswith(("Eye", "Iris", "Shine"))]:
    base = e.scale.copy()
    for f0 in BLINKS:
        for f, k in ((f0, 1.0), (f0 + 2, 0.08), (f0 + 4, 1.0)):
            key(e, "scale", f, (base.x, base.y, base.z * k))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "atlas_chibi.blend"))

def aim(loc, target, lens):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = lens
    cam_d.dof.focus_distance = (Vector((0.3, -0.4, 1.7)) - Vector(loc)).length

office_visible(MODE.startswith("office"))
if MODE.startswith("office"):
    # 4:3 hero shot: Atlas left of centre, the office softly out of focus behind
    scene.render.resolution_x, scene.render.resolution_y = 960, 720
    aim((2.2, -9.2, 2.25), (0.75, 0, 1.85), 42)
    cam_d.dof.use_dof = True; cam_d.dof.aperture_fstop = 2.0
if MODE == "face":
    aim((0.5, -6.5, 2.85), (0.0, 0, 2.62), 85); cam_d.dof.use_dof = False
    scene.render.resolution_x = scene.render.resolution_y = 560
    scene.frame_set(1); scene.render.filepath = os.path.join(OUT, "face.png")
    bpy.ops.render.render(write_still=True)
elif MODE == "avatar":
    # chat avatar: head and shoulders, transparent
    aim((0.6, -7.5, 2.75), (0.05, 0, 2.45), 70); cam_d.dof.use_dof = False
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.frame_set(1); scene.render.filepath = os.path.join(OUT, "avatar.png")
    bpy.ops.render.render(write_still=True)
elif MODE in ("still", "office_still"):
    scene.frame_set(1)
    scene.render.filepath = os.path.join(OUT, MODE + ".png")
    bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(OUT, "frames_" + MODE, "f_")
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(animation=True)
print("DONE", MODE)
