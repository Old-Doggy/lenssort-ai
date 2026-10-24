from pathlib import Path
import hashlib
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

import torch
import pyiqa


ROOT = Path(__file__).resolve().parent.parent
SAMPLES_PATH = ROOT / 'artifacts' / 'p1-failure-samples.json'
WEIGHT_PATH = ROOT / 'data' / 'p5-models' / 'weights' / 'musiq_ava_ckpt-e8d3f067.pth'
OUTPUT_PATH = ROOT / 'artifacts' / 'p5-musiq-ava-evaluation.json'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest().upper()


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(len(ordered) - 1, lower + 1)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def main() -> None:
    if not WEIGHT_PATH.is_file():
        raise FileNotFoundError(f'MUSIQ weight not found: {WEIGHT_PATH}')
    manifest = json.loads(SAMPLES_PATH.read_text(encoding='utf-8'))
    samples = manifest['samples']
    torch.set_num_threads(min(12, os.cpu_count() or 1))
    load_started = time.perf_counter()
    metric = pyiqa.create_metric(
        'musiq-ava',
        device='cpu',
        pretrained='ava',
        pretrained_model_path=str(WEIGHT_PATH),
        num_class=10,
        longer_side_lengths=[224],
        max_seq_len_from_original_res=0,
    )
    load_ms = (time.perf_counter() - load_started) * 1000
    results = []
    for sample in samples:
        started = time.perf_counter()
        item = {
            'name': sample['name'],
            'source': sample['source'],
            'sha256': sample['sha256'],
            'expectedCategory': sample.get('expectedCategory'),
            'currentCategory': sample.get('currentCategory'),
            'currentQualityScore': sample.get('currentQualityScore'),
            'tags': sample.get('tags', []),
        }
        try:
            with torch.inference_mode():
                raw = metric(sample['source'])
            values = raw.detach().cpu().reshape(-1).tolist()
            if len(values) != 1 or not torch.isfinite(raw).all():
                raise ValueError(f'unexpected MUSIQ output: {list(raw.shape)}')
            item.update({
                'musiqScore': round(float(values[0]), 6),
                'durationMs': round((time.perf_counter() - started) * 1000, 1),
            })
        except Exception as error:
            item.update({
                'error': f'{type(error).__name__}: {error}',
                'durationMs': round((time.perf_counter() - started) * 1000, 1),
            })
        results.append(item)
    successful = [item for item in results if isinstance(item.get('musiqScore'), (int, float))]
    durations = [item['durationMs'] for item in successful]
    ranked = sorted(successful, key=lambda item: (-item['musiqScore'], item['name']))
    for rank, item in enumerate(ranked, 1):
        item['musiqRank'] = rank
    report = {
        'status': 'completed-with-boundaries' if len(successful) == len(results) else 'completed-with-errors',
        'phase': 'P5.1',
        'candidate': 'MUSIQ-AVA via pyiqa, fast single-scale configuration',
        'model': {
            'weight': str(WEIGHT_PATH),
            'weightSha256': sha256(WEIGHT_PATH),
            'weightBytes': WEIGHT_PATH.stat().st_size,
            'longerSideLengths': [224],
            'maxSeqLenFromOriginalRes': 0,
            'device': 'cpu',
            'torch': torch.__version__,
        },
        'sampleCount': len(samples),
        'successCount': len(successful),
        'errorCount': len(results) - len(successful),
        'loadDurationMs': round(load_ms, 1),
        'averageDurationMs': round(sum(durations) / len(durations), 1) if durations else None,
        'p50DurationMs': round(percentile(durations, 0.5), 1) if durations else None,
        'p95DurationMs': round(percentile(durations, 0.95), 1) if durations else None,
        'results': results,
        'ranking': [
            {'name': item['name'], 'score': item['musiqScore'], 'rank': item['musiqRank']}
            for item in ranked
        ],
        'output': str(OUTPUT_PATH),
        'boundary': 'MUSIQ-AVA 分数和排序是公开模型候选输出，不等同于用户主观好看；本轮样本没有独立人工审美金标准，不宣称审美准确率。快速单尺度配置仅用于候选对比，不写入生产精选链路。',
    }
    OUTPUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'candidate', 'sampleCount', 'successCount', 'errorCount', 'averageDurationMs', 'p50DurationMs', 'p95DurationMs', 'output')}, ensure_ascii=False, indent=2))
    print(f'output={OUTPUT_PATH}')


if __name__ == '__main__':
    main()
