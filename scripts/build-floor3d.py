"""Build the TEA AMO miniature floor in Blender and export its WebGL GLB.

Run through Blender MCP or Blender's Python console. Table positions are read
from the same catalog used by Admin and Server, so the floor remains mapped to
the live application rather than a second layout definition.
"""

import json
import math
import random
import re
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
CATALOG = (ROOT / "public/js/data/catalog.js").read_text(encoding="utf-8")
TABLES = json.loads(re.search(r"const DEFAULT_TABLES=(\[.*?\]);", CATALOG).group(1))
ASSETS = ROOT / "public/assets/3d"
ASSETS.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / "assets/3d"
SOURCE.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.data.orphans_purge(do_recursive=True)
for mat in list(bpy.data.materials):
    if mat.users == 0:
        bpy.data.materials.remove(mat)
for image in list(bpy.data.images):
    if image.users == 0:
        bpy.data.images.remove(image)
for collection in list(bpy.data.collections):
    if collection.name != bpy.context.scene.collection.name and collection.users == 0:
        bpy.data.collections.remove(collection)

def collection(name):
    found = bpy.data.collections.get(name)
    if found is None:
        found = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(found)
    return found

COL = {name: collection(name) for name in (
    "ENVIRONMENT", "TABLES", "CHAIRS", "DECOR", "FLOOR_SEATING",
    "BAR", "STAIRS", "AQUARIUM", "PLANTS", "INTERACTION_HELPERS")}

def material(name, color, roughness=0.75, metallic=0, emission=None, alpha=1):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.4
    if alpha < 1:
        mat.surface_render_method = "BLENDED"
    return mat

MAT = {
    "floor": material("MAT_FLOOR_BEIGE_STONE", (0.57, 0.48, 0.37)),
    "tile": material("MAT_FLOOR_TILE_LINE", (0.48, 0.41, 0.33)),
    "wall": material("MAT_WALL_CHARCOAL", (0.075, 0.074, 0.07)),
    "wood": material("MAT_WOOD_TABLE", (0.41, 0.20, 0.085)),
    "wood_edge": material("MAT_WOOD_EDGE", (0.24, 0.105, 0.04)),
    "wood_dark": material("MAT_WOOD_DARK", (0.13, 0.075, 0.045)),
    "chair": material("MAT_CHAIR_GREEN", (0.095, 0.18, 0.13)),
    "chair_brown": material("MAT_CHAIR_BROWN", (0.27, 0.12, 0.07)),
    "booth": material("MAT_BOOTH_RUST", (0.42, 0.075, 0.045)),
    "rug": material("MAT_BOOTH_RUG", (0.40, 0.29, 0.19)),
    "metal": material("MAT_METAL_BRONZE", (0.31, 0.22, 0.12), metallic=0.7),
    "plant": material("MAT_PLANT", (0.055, 0.20, 0.07)),
    "plant_light": material("MAT_PLANT_LIGHT", (0.14, 0.30, 0.095)),
    "pot": material("MAT_POT", (0.13, 0.115, 0.09)),
    "stone": material("MAT_STAIRS_STONE", (0.27, 0.24, 0.21)),
    "stone_top": material("MAT_STAIRS_TOP", (0.39, 0.34, 0.29)),
    "bar_stone": material("MAT_BAR_PALE_STONE", (0.77, 0.69, 0.56)),
    "aquarium": material("MAT_AQUARIUM_BLUE", (0.005, 0.22, 0.35), emission=(0.01, 0.23, 0.42)),
    "glass": material("MAT_AQUARIUM_GLASS", (0.32, 0.72, 0.81), roughness=0.18, alpha=0.32),
    "sand": material("MAT_AQUARIUM_SAND", (0.36, 0.28, 0.17)),
    "candle": material("MAT_CANDLE_AMBER", (0.94, 0.47, 0.08), emission=(1.0, 0.40, 0.04)),
    "flower": material("MAT_FLOWER_CREAM", (0.86, 0.79, 0.57)),
    "halo": material("MAT_STATUS_NEUTRAL", (0.44, 0.45, 0.40), emission=(0.25, 0.26, 0.22)),
    "hitbox": material("MAT_HITBOX_TRANSPARENT", (1, 1, 1), alpha=0),
}

def grain_texture(name, mat, floor=False):
    size = 256
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(49 if floor else 18)
    pixels = []
    for y in range(size):
        for x in range(size):
            noise = rng.uniform(-.024, .024)
            if floor:
                wave = .025*math.sin(x*.065+math.sin(y*.034)) + .018*math.sin(y*.09)
                value = wave + noise*.55
                rgb = (.61+value, .51+value*.86, .39+value*.72)
            else:
                wave = .075*math.sin(y*.51+math.sin(x*.035)*2) + .034*math.sin(y*.16)
                value = wave + noise
                rgb = (.43+value, .205+value*.52, .082+value*.28)
            pixels.extend((*[max(0, min(1, c)) for c in rgb], 1))
    image.pixels.foreach_set(pixels)
    image.pack()
    nodes = mat.node_tree.nodes
    bsdf = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

grain_texture("TEX_WOOD_GRAIN", MAT["wood"])
grain_texture("TEX_FLOOR_STONE", MAT["floor"], floor=True)

def move_collection(obj, col):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)

def cube(name, loc, size, mat, col, parent=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if parent:
        obj.parent = parent
    obj.location = loc
    obj.data.materials.append(mat)
    move_collection(obj, col)
    if bevel:
        modifier = obj.modifiers.new("Soft corners", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj

def cylinder(name, loc, radius, depth, mat, col, parent=None, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    if parent:
        obj.parent = parent
    obj.location = loc
    obj.data.materials.append(mat)
    move_collection(obj, col)
    return obj

def empty(name, loc, col, parent=None):
    obj = bpy.data.objects.new(name, None)
    col.objects.link(obj)
    if parent:
        obj.parent = parent
    obj.location = loc
    return obj

def plant(name, x, y, scale=1, parent=None, z=0):
    root = empty(name, (x, y, z), COL["PLANTS"], parent)
    cylinder(name + "_POT", (0, 0, 0.16 * scale), 0.18 * scale, 0.30 * scale, MAT["pot"], COL["PLANTS"], root)
    cylinder(name + "_STEM", (0, 0, 0.43 * scale), 0.028 * scale, 0.34 * scale, MAT["wood_dark"], COL["PLANTS"], root, 6)
    for i in range(8):
        a = i * math.tau / 8
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4)
        leaf = bpy.context.object
        leaf.name = name + f"_LEAF_{i}"
        leaf.parent = root
        leaf.location = (math.cos(a)*0.19*scale, math.sin(a)*0.19*scale, 0.55*scale)
        leaf.scale = (.25*scale, .075*scale, .035*scale)
        leaf.data.materials.append(MAT["plant" if i % 2 else "plant_light"])
        move_collection(leaf, COL["PLANTS"])
        leaf.rotation_euler[2] = a
        leaf.rotation_euler[1] = 0.16
    return root

def chair(name, x, y, facing, parent, brown=False):
    mat = MAT["chair_brown" if brown else "chair"]
    root = empty(name, (x, y, 0), COL["CHAIRS"], parent)
    root.rotation_euler[2] = facing
    cube(name + "_SEAT", (0, 0, 0.43), (0.47, 0.46, 0.12), mat, COL["CHAIRS"], root, .04)
    cube(name + "_BACK", (0, 0.21, 0.67), (0.47, 0.10, 0.50), mat, COL["CHAIRS"], root, .035)
    for dx in (-.17, .17):
        for dy in (-.15, .15):
            cube(name + f"_LEG_{dx}_{dy}", (dx, dy, .20), (.045, .045, .38), MAT["wood_dark"], COL["CHAIRS"], root)
    return root

def ring(name, parent, sx, sy):
    root = empty(name, (0, 0, 0), COL["INTERACTION_HELPERS"], parent)
    for side, loc, dims in (
        ("N", (0, sy/2, .042), (sx, .035, .012)),
        ("S", (0, -sy/2, .042), (sx, .035, .012)),
        ("E", (sx/2, 0, .042), (.035, sy, .012)),
        ("W", (-sx/2, 0, .042), (.035, sy, .012)),
    ):
        cube(name + "_" + side, loc, dims, MAT["halo"], COL["INTERACTION_HELPERS"], root)
    return root

def tabletop_decor(name, parent, top_z, dx):
    cylinder(name + "_VASE", (dx, .19, top_z+.09), .095, .17, MAT["pot"], COL["DECOR"], parent)
    for i in range(4):
        a = i*math.tau/4
        cylinder(name + f"_FLOWER_{i}", (dx+math.cos(a)*.065, .19+math.sin(a)*.065, top_z+.19), .042, .06, MAT["flower"], COL["DECOR"], parent, 6)
    cylinder(name + "_CANDLE_BASE", (-dx, -.17, top_z+.025), .065, .05, MAT["metal"], COL["DECOR"], parent)
    cylinder(name + "_CANDLE", (-dx, -.17, top_z+.074), .035, .075, MAT["candle"], COL["DECOR"], parent, 8)

def table(row):
    label = row["name"]
    cx = ((row["x"] + row["w"]/2)/100)*16 - 8
    cy = 6 - ((row["y"] + row["h"]/2)/100)*12
    fw = row["w"]/100*16
    fd = row["h"]/100*12
    group = empty("TABLE_" + label, (cx, cy, 0), COL["TABLES"])
    group["entityType"] = "table"
    group["tableId"] = label
    group["tableKey"] = row["id"]
    group["layout"] = [row["x"], row["y"], row["w"], row["h"]]
    booth = row["kind"] == "floor"
    if booth:
        cube("RUG_"+label, (0, 0, .055), (fw*.94, fd*.94, .06), MAT["rug"], COL["FLOOR_SEATING"], group, .035)
        for side in (-1, 1):
            cube(f"BENCH_{label}_{side}", (side*fw*.32, 0, .21), (fw*.17, fd*.78, .33), MAT["booth"], COL["FLOOR_SEATING"], group, .06)
        top_z = .43
        sx, sy = fw*.42, fd*.43
    else:
        top_z = .72
        sx = fw*(.70 if label != "T1" else .83)
        sy = fd*(.58 if label != "T1" else .62)
        cube("BASE_"+label, (0, 0, .36), (sx*.14, sy*.20, .68), MAT["wood_dark"], COL["TABLES"], group, .04)
    cube("TOP_"+label, (0, 0, top_z-.045), (sx+.08, sy+.08, .10), MAT["wood_edge"], COL["TABLES"], group, .035)
    cube("SURFACE_"+label, (0, 0, top_z), (sx, sy, .06), MAT["wood"], COL["TABLES"], group, .025)
    tabletop_decor(label, group, top_z+.03, min(.25, sx*.28))
    if not booth:
        # Repeated upholstered chairs; the center aisles remain clear.
        length_count = 4 if label == "T1" else (3 if label == "T9" else 2)
        for i in range(length_count):
            px = (i-(length_count-1)/2) * min(.53, sx/(length_count+.2))
            # The back is at local +Y, so the seat faces local -Y.
            chair(f"CHAIR_{label}_N{i+1:02}", px, sy/2+.29, 0, group, label in ("T10", "T5"))
            chair(f"CHAIR_{label}_S{i+1:02}", px, -sy/2-.29, math.pi, group, label in ("T10", "T5"))
    ring("STATUS_"+label, group, fw*.97, fd*.97)
    hit = cube("HITBOX_"+label, (0, 0, .66), (fw*.95, fd*.95, 1.28), MAT["hitbox"], COL["INTERACTION_HELPERS"], group)
    hit["tableId"] = label
    return group

# Room shell with physical gaps at the top, right and main entrance.
cube("FLOOR", (0, 0, -.08), (16.3, 12.3, .18), MAT["floor"], COL["ENVIRONMENT"])
for x in [i*.95 for i in range(-8, 9)]:
    cube(f"TILE_LINE_X_{x:.2f}", (x, 0, .012), (.009, 12, .004), MAT["tile"], COL["ENVIRONMENT"])
for y in [i*.95 for i in range(-6, 7)]:
    cube(f"TILE_LINE_Y_{y:.2f}", (0, y, .012), (16, .009, .004), MAT["tile"], COL["ENVIRONMENT"])
for name, loc, size in (
    ("WALL_LEFT", (-8.05, 0, .70), (.32, 12.45, 1.40)),
    ("WALL_TOP_LEFT", (-5.20, 6.05, .70), (5.7, .32, 1.40)),
    ("WALL_TOP_RIGHT", (3.40, 6.05, .70), (9.1, .32, 1.40)),
    ("WALL_RIGHT_TOP", (8.05, 3.35, .70), (.32, 5.4, 1.40)),
    ("WALL_RIGHT_BOTTOM", (8.05, -3.30, .70), (.32, 5.5, 1.40)),
    ("WALL_BOTTOM_LEFT", (-4.70, -6.05, .70), (6.7, .32, 1.40)),
    ("WALL_BOTTOM_RIGHT", (4.70, -6.05, .70), (6.7, .32, 1.40)),
):
    cube(name, loc, size, MAT["wall"], COL["ENVIRONMENT"], bevel=.025)
for name, loc, size in (
    ("TOP_DOOR_THRESHOLD", (-1.50, 5.84, .025), (1.70, .50, .05)),
    ("RIGHT_DOOR_THRESHOLD", (7.84, 0, .025), (.50, 1.60, .05)),
    ("MAIN_ENTRANCE_THRESHOLD", (0, -5.84, .025), (2.70, .50, .05)),
):
    cube(name, loc, size, MAT["stone_top"], COL["ENVIRONMENT"], bevel=.02)

# Aquarium sits against the back wall, with emissive blue water and a glass face.
cube("AQUARIUM_BASE", (1.90, 5.62, .26), (3.25, .82, .38), MAT["wall"], COL["AQUARIUM"], bevel=.04)
cube("AQUARIUM_WATER", (1.90, 5.60, .72), (3.02, .59, .07), MAT["aquarium"], COL["AQUARIUM"])
cube("AQUARIUM_GLASS", (1.90, 5.21, .70), (3.04, .04, .83), MAT["glass"], COL["AQUARIUM"])
for i, x in enumerate((.31, 3.49)):
    cube(f"AQUARIUM_FRAME_SIDE_{i}", (x, 5.61, .83), (.13, .84, 1.22), MAT["wall"], COL["AQUARIUM"])
for i, y in enumerate((5.18, 6.02)):
    cube(f"AQUARIUM_FRAME_RIM_{i}", (1.90, y, 1.36), (3.27, .12, .09), MAT["wall"], COL["AQUARIUM"])
for i in range(7):
    x = .58 + i*.45
    cylinder(f"AQUARIUM_PLANT_{i}", (x, 5.15, .48), .045, .35+(i%3)*.08, MAT["plant_light"], COL["AQUARIUM"], vertices=6)

# Central stairwell and stepped flight.
cube("STAIRS_CORE", (-1.08, -1.06, .07), (3.55, 3.72, .14), MAT["stone"], COL["STAIRS"], bevel=.03)
cube("STAIRS_LANDING", (-1.90, -1.06, .87), (1.65, 3.60, .08), MAT["stone_top"], COL["STAIRS"])
for i in range(9):
    y = .43 - i*.36
    cylinder_height = .10 + (8-i)*.085
    cube(f"STAIR_{i+1:02}", (.10, y, cylinder_height/2+.05), (.92, .34, cylinder_height), MAT["stone_top"], COL["STAIRS"], bevel=.015)
cube("STAIRS_RAIL", (.68, -1.05, .52), (.06, 3.70, 1.04), MAT["metal"], COL["STAIRS"])

# Bar with warm timber fascia and a pale stone counter.
cube("BAR_BODY", (0, -4.67, .54), (4.35, 1.14, 1.08), MAT["wood_dark"], COL["BAR"], bevel=.16)
cube("BAR_FASCIA", (0, -5.25, .59), (4.18, .055, .80), MAT["wood"], COL["BAR"], bevel=.035)
cube("BAR_COUNTER", (0, -4.60, 1.13), (4.65, 1.30, .13), MAT["bar_stone"], COL["BAR"], bevel=.12)
cube("BAR_WARM_TRIM", (0, -5.27, .14), (4.22, .05, .07), MAT["candle"], COL["BAR"])
cube("BAR_WORKTOP", (0, -4.46, 1.21), (3.7, .45, .035), MAT["wall"], COL["BAR"])
for i in range(5):
    chair(f"BAR_STOOL_{i+1:02}", -1.58+i*.78, -5.55, math.pi, None, True)

# Low plant railing divides the two upper floor booths from the open floor.
cube("PLANT_RAILING", (-5.45, .90, .47), (4.88, .32, .94), MAT["wood_dark"], COL["PLANTS"], bevel=.04)
for i in range(10):
    plant(f"RAILING_PLANT_{i+1:02}", -7.57+i*.47, .91, .47, z=.92)
for i, (x,y) in enumerate(((-7.45,5.24),(-7.42,2.9),(-7.4,-.3),(-7.4,-3.45),(-7.4,-5.45),
                            (7.45,5.0),(7.43,2.8),(7.43,.8),(7.45,-1.7),(7.45,-4.1),
                            (-.28,5.15),(.25,5.05),(4.35,5.17),(-3.25,-.15))):
    plant(f"POT_PLANT_{i+1:02}", x, y, .85 if i%3 else 1.05)
for i, y in enumerate((-5.0,-3.15,-1.25,1.5,3.55,5.15)):
    for x, side in ((-7.72,"L"),(7.72,"R")):
        cube(f"WALL_SCONCE_{side}_{i}", (x,y,.82), (.08,.18,.23), MAT["candle"], COL["DECOR"], bevel=.025)

for row in TABLES:
    table(row)

# Keep semantic table parents and hitboxes, but batch static furniture by
# material within each table. This cuts WebGL draw calls without changing IDs.
# Validate each seat before static meshes are joined for export. The vector
# from the backrest to the seat must point toward its table or the bar.
bpy.context.view_layer.update()
checked_seats = 0
for seat_root in bpy.context.scene.objects:
    if seat_root.type != "EMPTY" or not (seat_root.name.startswith("CHAIR_") or seat_root.name.startswith("BAR_STOOL_")):
        continue
    seat = next(child for child in seat_root.children if child.name.endswith("_SEAT"))
    back = next(child for child in seat_root.children if child.name.endswith("_BACK"))
    focus = (seat_root.parent.matrix_world.translation if seat_root.parent else Vector((0, -4.67, 0)))
    forward = seat.matrix_world.translation - back.matrix_world.translation
    to_focus = focus - seat.matrix_world.translation
    forward.z = to_focus.z = 0
    assert forward.dot(to_focus) > 0, f"{seat_root.name} faces away from its table"
    checked_seats += 1
assert checked_seats == 55, f"Expected 55 chairs and bar stools, found {checked_seats}"

for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)

def semantic_parent(obj):
    current = obj.parent
    while current:
        if current.name.startswith("STATUS_") or current.name.startswith("TABLE_"):
            return current.name
        current = current.parent
    return "ROOM"

batches = {}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH" or obj.name.startswith("HITBOX_"):
        continue
    key = (semantic_parent(obj), obj.data.materials[0].name)
    batches.setdefault(key, []).append(obj)
for (owner, matname), objects in batches.items():
    if len(objects) < 2:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = "BATCH_" + owner + "_" + matname.replace("MAT_", "")
for obj in list(bpy.context.scene.objects):
    if obj.type == "EMPTY" and not obj.children and not (obj.name.startswith("TABLE_") or obj.name.startswith("STATUS_")):
        bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.render.engine = "BLENDER_EEVEE"
scene.world.color = (0.38, 0.34, 0.29)
world = scene.world
world.use_nodes = True
background = next(node for node in world.node_tree.nodes if node.type == "BACKGROUND")
background.inputs["Color"].default_value = (.38, .34, .29, 1)
background.inputs["Strength"].default_value = .55

def area_light(name, loc, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "RECTANGLE"
    data.size = size[0]
    data.size_y = size[1]
    obj = bpy.data.objects.new(name, data)
    COL["ENVIRONMENT"].objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (0, 0, 0)
    return obj

area_light("LIGHT_WARM_KEY", (-3, 0, 9), 1000, (10, 8))
area_light("LIGHT_WARM_FILL", (5, -1, 8), 650, (8, 7))

camera_data = bpy.data.cameras.new("Camera_Production")
camera = bpy.data.objects.new("Camera_Production", camera_data)
COL["ENVIRONMENT"].objects.link(camera)
camera.location = (0, -6.8, 20)
target = Vector((0, 0, 0))
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 19.0
scene.camera = camera
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 70

bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / "tea-amo-floor.blend"))
bpy.ops.export_scene.gltf(
    filepath=str(ASSETS / "tea-amo-floor.glb"),
    export_format="GLB", export_apply=True, export_extras=True,
    export_cameras=False, export_lights=False, export_yup=True,
)
triangles = sum(len(poly.vertices)-2 for obj in scene.objects if obj.type == "MESH" for poly in obj.data.polygons)
print(json.dumps({"tables": [r["name"] for r in TABLES], "objects": len(scene.objects),
                  "triangles_unmodified": triangles, "materials": len(bpy.data.materials),
                  "glb_bytes": (ASSETS / "tea-amo-floor.glb").stat().st_size}))
