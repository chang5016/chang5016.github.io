"""Lossless preparation of selected original Libre TrainSim maps (Pillow)."""
import hashlib, json, sys
from pathlib import Path
from PIL import Image
root = Path(sys.argv[1])
output = root / 'lossless-textures'
output.mkdir(exist_ok=True)
rows, shared = {}, {}
repair = '--repair' in sys.argv[2:]
for name in ['LightBlue_Plastic.png', 'White.png', 'CorrugatedSteel.png', 'WoodenPlanks.png', 'platform.png', 'Gravel.png', 'Wall.png', 'White_Plastic.png', 'Plastic.png']:
    key = 'Resources/Textures/' + name
    original = root / 'libre-source/src' / key
    if repair and not original.exists():
        continue
    image = Image.open(original)
    digest = hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest()
    encoded = shared.get(digest, output / (original.stem + '.webp'))
    if digest not in shared:
        image.save(encoded, 'WEBP', lossless=True, method=6, icc_profile=image.info.get('icc_profile', b''))
        shared[digest] = encoded
    assert Image.open(encoded).convert('RGBA').tobytes() == image.convert('RGBA').tobytes()
    rows[key] = dict(path=str(encoded.relative_to(root)), originalBytes=original.stat().st_size, bytes=encoded.stat().st_size, decodedRgbaSha256=digest, lossless=True)
if repair:
    key = 'Trains/JFR1/Wagon_WithDriverStand_albedo.png'
    original = root / 'libre-source/src' / key
    image = Image.open(original)
    encoded = output / (original.stem + '.webp')
    image.save(encoded, 'WEBP', lossless=True, method=4)
    assert Image.open(encoded).convert('RGBA').tobytes() == image.convert('RGBA').tobytes()
    rows[key] = dict(path=str(encoded.relative_to(root)), originalBytes=original.stat().st_size, bytes=encoded.stat().st_size, decodedRgbaSha256=hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest(), lossless=True)
    # Godot source AMR packs ambient occlusion R, metalness G, roughness B.
    # glTF/Three expects ambient occlusion R, roughness G, metalness B.
    image = Image.open(root / 'libre-source/src/Trains/JFR1/Wagon_WithDriverStand_amr.png').convert('RGB')
    ao, metalness, roughness = image.split()
    destination = Path(__file__).resolve().parents[2] / 'public/models/metro/downloaded/textures/JFR1-ORM.webp'
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.merge('RGB', (ao, roughness, metalness)).save(destination, 'WEBP', lossless=True, method=4)
(root / 'lossless-textures.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(dict(textures=len(shared), exactPixels=True, bytes=sum(path.stat().st_size for path in shared.values()))))
