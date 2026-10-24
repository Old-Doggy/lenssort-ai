import json
import struct
import zipfile
from pathlib import Path

root = Path.cwd()
source = root / 'data' / 'p2-candidates' / 'aesthetic' / 'sa_0_4_vit_b_32_linear.pth'
output = root / 'artifacts' / 'p2-laion-aesthetic-weights.json'

with zipfile.ZipFile(source) as archive:
    names = archive.namelist()
    data_files = [name for name in names if name.endswith('/data/0') or name.endswith('/data/1')]
    if len(data_files) != 2:
        raise RuntimeError(f'Expected two tensor payloads, found: {data_files}')
    tensors = []
    for name in sorted(data_files):
        payload = archive.read(name)
        if len(payload) % 4 != 0:
            raise RuntimeError(f'Non-float32 tensor payload: {name}, bytes={len(payload)}')
        tensors.append(list(struct.unpack('<' + 'f' * (len(payload) // 4), payload)))

weight = next(values for values in tensors if len(values) == 512)
bias = next(values for values in tensors if len(values) == 1)[0]
report = {
    'status': 'verified',
    'candidate': 'LAION aesthetic predictor V1 · ViT-B/32 linear head',
    'source': 'data/p2-candidates/aesthetic/sa_0_4_vit_b_32_linear.pth',
    'license': 'MIT (source repository license)',
    'weightDimension': len(weight),
    'bias': bias,
    'weight': weight,
    'boundary': 'The linear head is only valid with compatible CLIP ViT-B/32 image embeddings; this extraction does not claim aesthetic accuracy.',
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: report[key] for key in ['status', 'candidate', 'weightDimension', 'bias', 'boundary']}, ensure_ascii=False, indent=2))
