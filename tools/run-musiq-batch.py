import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import torch
import pyiqa
from PIL import Image, ImageOps
from torchvision.transforms.functional import to_tensor


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    weight = root / 'data' / 'p5-models' / 'weights' / 'musiq_ava_ckpt-e8d3f067.pth'
    samples = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    if not isinstance(samples, list) or len(samples) > 500:
        raise ValueError('精选批次样本数量无效')
    torch.set_num_threads(min(2, os.cpu_count() or 1))
    started = time.perf_counter()
    metric = pyiqa.create_metric(
        'musiq-ava',
        device='cpu',
        pretrained='ava',
        pretrained_model_path=str(weight),
        num_class=10,
        longer_side_lengths=[224, 384],
        max_seq_len_from_original_res=0,
    )
    results = []
    with torch.inference_mode():
        for index, item in enumerate(samples):
            path = Path(item['path']).resolve()
            row = {'id': item['id'], 'path': str(path), 'sha256': None, 'score': None, 'durationMs': None, 'error': None}
            item_started = time.perf_counter()
            try:
                if not path.is_file() or path.is_symlink():
                    raise FileNotFoundError('精选来源不是普通文件')
                if path.stat().st_size > 128 * 1024 * 1024:
                    raise ValueError('精选图片文件过大')
                with Image.open(path) as image:
                    if image.width * image.height > 80_000_000:
                        raise ValueError('精选图片像素过大')
                    image = ImageOps.exif_transpose(image).convert('RGB')
                    image.thumbnail((1024, 1024))
                    tensor = to_tensor(image).unsqueeze(0)
                raw = metric(tensor)
                value = raw.detach().cpu().reshape(-1).tolist()
                if len(value) != 1 or not torch.isfinite(raw).all():
                    raise ValueError('MUSIQ输出无效')
                row['sha256'] = sha256(path)
                row['score'] = round(float(value[0]), 6)
            except Exception as error:
                row['error'] = f'{type(error).__name__}: {error}'
            row['durationMs'] = round((time.perf_counter() - item_started) * 1000, 1)
            results.append(row)
            print(json.dumps({'completed': index + 1, 'total': len(samples), 'id': item['id']}), flush=True)
    report = {
        'status': 'completed' if all(row['score'] is not None for row in results) else 'completed-with-errors',
        'model': 'MUSIQ-AVA',
        'device': 'cpu',
        'configuration': {'scales': [224, 384], 'originalResolutionPatches': False, 'maxInputEdge': 1024, 'threads': 2},
        'sampleCount': len(samples),
        'successCount': sum(row['score'] is not None for row in results),
        'totalDurationMs': round((time.perf_counter() - started) * 1000, 1),
        'results': results,
    }
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
    return 0 if report['successCount'] else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        raise
