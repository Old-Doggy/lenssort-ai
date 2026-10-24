from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
import json, random

root = Path(__file__).resolve().parents[1] / 'data/eval/similarity_cases'
root.mkdir(parents=True, exist_ok=True)
for old in root.iterdir():
    if old.is_file():
        old.unlink()

W, H = 512, 384

def make_scene(seed: int, palette: tuple[str, str, str]) -> Image.Image:
    random.seed(seed)
    image = Image.new('RGB', (W, H), palette[0])
    draw = ImageDraw.Draw(image)
    for y in range(H):
        t = y / (H - 1)
        color = tuple(round((1 - t) * int(palette[0][i:i+2], 16) + t * int(palette[1][i:i+2], 16)) for i in (1, 3, 5))
        draw.line((0, y, W, y), fill=color)
    draw.rectangle((0, 250, W, H), fill=palette[2])
    draw.ellipse((70, 42, 185, 157), fill='#f7d36b', outline='#fff1ae', width=5)
    draw.polygon([(0, 270), (80, 170), (170, 270)], fill='#345264', outline='#183b4c')
    draw.polygon([(130, 270), (250, 125), (390, 270)], fill='#426a68', outline='#1e4b55')
    draw.polygon([(280, 270), (405, 155), (512, 270)], fill='#31515e', outline='#193b4a')
    draw.rectangle((330, 185, 360, 250), fill='#d77e55')
    draw.rectangle((320, 205, 370, 250), outline='#f4bd74', width=4)
    for x in range(22, W, 42):
        draw.line((x, 270, x + random.randint(-12, 12), 330), fill='#244b4e', width=3)
    return image

def save(image: Image.Image, name: str, quality: int | None = None):
    path = root / name
    if path.suffix.lower() in {'.jpg', '.jpeg'}:
        image.convert('RGB').save(path, quality=quality or 90, optimize=True)
    else:
        image.save(path)

base = make_scene(7, ('#ffd1a1', '#5b8991', '#214b58'))
base2 = make_scene(8, ('#d0e5ff', '#5574a0', '#263b63'))
base3 = make_scene(9, ('#f1c6b9', '#92749e', '#4a426d'))

cases = []

def add(case_id, title, left, right, expected, risk, note):
    left_name = f'{case_id}_a.png'
    right_name = f'{case_id}_b.png'
    save(left, left_name)
    save(right, right_name)
    cases.append({
        'id': case_id,
        'title': title,
        'left': left_name,
        'right': right_name,
        'expectedNearDuplicate': expected,
        'riskType': risk,
        'note': note,
    })

add('case01_exact', '同图复制', base.copy(), base.copy(), True, 'true-positive-control', '同像素内容，文件名不同')
reencoded = root / 'case02_reencoded_b.jpg'
base.convert('RGB').save(reencoded, quality=28, optimize=True)
save(base, 'case02_reencoded_a.png')
cases.append({'id': 'case02_reencoded', 'title': 'JPEG 重编码', 'left': 'case02_reencoded_a.png', 'right': 'case02_reencoded_b.jpg', 'expectedNearDuplicate': True, 'riskType': 'compression', 'note': '内容不变但压缩伪影增加'})
add('case03_brightness', '亮度变化', base.copy(), ImageEnhance.Brightness(base).enhance(0.72), True, 'illumination', '同场景显著变暗')
add('case04_crop', '中心裁剪', base.copy(), base.crop((36, 20, 476, 350)).resize((W, H), Image.Resampling.LANCZOS), True, 'crop', '主体保留但边缘被裁掉')
add('case05_flip', '水平翻转', base.copy(), base.transpose(Image.Transpose.FLIP_LEFT_RIGHT), True, 'orientation', '镜像后内容相同但方向改变')
rotated = base.rotate(90, expand=True).resize((W, H), Image.Resampling.LANCZOS)
add('case06_rotate', '九十度旋转', base.copy(), rotated, True, 'rotation', '内容相同但方向和长宽比改变')
shifted = Image.new('RGB', (W, H), '#808080')
shifted.paste(base, (18, 0))
add('case07_shift', '轻微平移', base.copy(), shifted, True, 'translation', '主体向右平移并产生边缘补色')
flat_a = Image.new('RGB', (W, H), '#c84f50')
flat_b = Image.new('RGB', (W, H), '#ad5452')
add('case08_flat_color', '纯色近邻', flat_a, flat_b, False, 'false-positive', '内容完全不同但低频结构极其简单')
pattern_a = Image.new('RGB', (W, H), '#d6b070')
draw = ImageDraw.Draw(pattern_a)
for y in range(0, H, 32):
    draw.line((0, y, W, y), fill='#a9784e', width=7)
for x in range(0, W, 64):
    draw.line((x, 0, x, H), fill='#f0d296', width=4)
pattern_b = Image.new('RGB', (W, H), '#d3ae73')
draw = ImageDraw.Draw(pattern_b)
for y in range(8, H, 32):
    draw.line((0, y, W, y), fill='#a26e4c', width=7)
for x in range(18, W, 64):
    draw.line((x, 0, x, H), fill='#eed08e', width=4)
add('case09_pattern', '周期纹理错位', pattern_a, pattern_b, False, 'false-positive', '重复纹理相位不同，感知结构可能接近')
add('case10_scene', '相近配色不同场景', base2, base3, False, 'false-positive', '颜色和构图层级相近但对象不同')

manifest = {'canvas': [W, H], 'cases': cases}
(root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
