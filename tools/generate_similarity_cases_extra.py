from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
import json

root = Path(__file__).resolve().parents[1] / 'data/eval/similarity_cases_extra'
for path in root.iterdir():
    if path.is_file():
        path.unlink()
W, H = 512, 384

def base_scene():
    image = Image.new('RGB', (W, H), '#ffd1a1')
    draw = ImageDraw.Draw(image)
    for y in range(H):
        t = y / (H - 1)
        color = (round(255 * (1-t) + 91*t), round(209 * (1-t) + 137*t), round(161 * (1-t) + 145*t))
        draw.line((0, y, W, y), fill=color)
    draw.rectangle((0, 250, W, H), fill='#214b58')
    draw.ellipse((70, 42, 185, 157), fill='#f7d36b', outline='#fff1ae', width=5)
    draw.polygon([(0, 270), (80, 170), (170, 270)], fill='#345264', outline='#183b4c')
    draw.polygon([(130, 270), (250, 125), (390, 270)], fill='#426a68', outline='#1e4b55')
    draw.polygon([(280, 270), (405, 155), (512, 270)], fill='#31515e', outline='#193b4a')
    draw.rectangle((330, 185, 360, 250), fill='#d77e55')
    draw.rectangle((320, 205, 370, 250), outline='#f4bd74', width=4)
    return image

def alternate_scene(kind):
    image = Image.new('RGB', (W, H), '#ffd1a1' if kind == 1 else '#f0c99d')
    draw = ImageDraw.Draw(image)
    for y in range(H):
        t = y / (H - 1)
        color = (round(250 * (1-t) + (95 if kind == 1 else 105)*t), round(205 * (1-t) + (126 if kind == 1 else 142)*t), round(155 * (1-t) + (170 if kind == 1 else 150)*t))
        draw.line((0, y, W, y), fill=color)
    draw.rectangle((0, 250, W, H), fill='#214b58' if kind == 1 else '#294e5b')
    draw.ellipse((335, 50, 460, 175), fill='#f5c46a', outline='#fff1ae', width=4)
    draw.rectangle((70, 165, 120, 250), fill='#c97854')
    draw.rectangle((55, 190, 135, 250), outline='#f4bd74', width=4)
    draw.polygon([(0, 270), (120, 140), (240, 270)], fill='#3b5967', outline='#1d3e4c')
    draw.polygon([(180, 270), (315, 120), (450, 270)], fill='#416b68', outline='#214c55')
    return image

def save(img, name):
    path = root / name
    if path.suffix.lower() in {'.jpg', '.jpeg'}:
        img.convert('RGB').save(path, quality=76, optimize=True)
    else:
        img.save(path)

base = base_scene()
cases = []
def add(case_id, title, left, right, expected, risk, note):
    left_name, right_name = f'{case_id}_a.png', f'{case_id}_b.png'
    save(left, left_name); save(right, right_name)
    cases.append({'id':case_id,'title':title,'left':left_name,'right':right_name,'expectedNearDuplicate':expected,'riskType':risk,'note':note})

add('case11_rotate5', '小角度旋转', base, base.rotate(5, resample=Image.Resampling.BICUBIC, expand=False, fillcolor='#808080'), True, 'rotation', '真实近重复但边缘出现旋转填充')
add('case12_rotate180', '一百八十度旋转', base, base.rotate(180, resample=Image.Resampling.BICUBIC, expand=False), True, 'rotation', '真实近重复但方向完全倒置')
add('case13_crop60', '重度中心裁剪', base, base.crop((102, 77, 410, 307)).resize((W,H), Image.Resampling.LANCZOS), True, 'crop', '仅保留中心主体')
add('case14_crop80', '中度中心裁剪', base, base.crop((51, 38, 461, 346)).resize((W,H), Image.Resampling.LANCZOS), True, 'crop', '保留大部分主体但边缘变化')
shift = Image.new('RGB', (W,H), '#808080'); shift.paste(base, (58, 18))
add('case15_shift_large', '大幅平移', base, shift, True, 'translation', '主体平移并产生双侧补色')
add('case16_zoom', '中心放大', base, base.crop((64, 48, 448, 336)).resize((W,H), Image.Resampling.LANCZOS), True, 'scale', '主体尺度变化')
add('case17_blur', '强模糊', base, base.filter(ImageFilter.GaussianBlur(radius=7)), True, 'blur', '内容一致但细节显著减少')
add('case18_contrast', '强对比度变化', base, ImageEnhance.Contrast(base).enhance(1.8), True, 'contrast', '内容一致但对比度显著提高')
add('case19_alt_scene_a', '相似布局不同对象一', alternate_scene(1), alternate_scene(2), False, 'false-positive', '色彩、地平线和主体层级相近但对象位置不同')
flat = Image.new('RGB', (W,H), '#214b58'); draw=ImageDraw.Draw(flat); draw.rectangle((0,220,W,H), fill='#345264'); draw.ellipse((80,60,190,170), fill='#f7d36b'); draw.rectangle((340,150,410,250), fill='#d77e55')
add('case20_alt_scene_b', '相似布局不同对象二', alternate_scene(1), flat, False, 'false-positive', '同样的色块层级但没有相同主体结构')
(root/'manifest.json').write_text(json.dumps({'canvas':[W,H],'cases':cases}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'cases':len(cases),'root':str(root)}, ensure_ascii=False))
