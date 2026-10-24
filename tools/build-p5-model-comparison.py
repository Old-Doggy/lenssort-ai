from pathlib import Path
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

from scipy.stats import spearmanr


ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = ROOT / 'artifacts' / 'p2-aesthetic-baseline.json'
MUSIQ_PATH = ROOT / 'artifacts' / 'p5-musiq-ava-evaluation.json'
OUTPUT_PATH = ROOT / 'artifacts' / 'p5-model-comparison.json'


def main() -> None:
    baseline = json.loads(BASELINE_PATH.read_text(encoding='utf-8'))
    musiq = json.loads(MUSIQ_PATH.read_text(encoding='utf-8'))
    baseline_by_name = {item['name']: item for item in baseline['results']}
    rows = []
    for item in musiq['results']:
        base = baseline_by_name.get(item['name'])
        if not base or not isinstance(item.get('musiqScore'), (int, float)):
            continue
        rows.append({
            'name': item['name'],
            'musiqScore': item['musiqScore'],
            'laionScore': base.get('aestheticScore'),
            'qualityScore': item.get('currentQualityScore'),
            'category': item.get('currentCategory'),
            'tags': item.get('tags', []),
        })
    musiq_ranked = sorted(rows, key=lambda row: (-row['musiqScore'], row['name']))
    laion_ranked = sorted(rows, key=lambda row: (-row['laionScore'], row['name']))
    musiq_rank = {row['name']: index + 1 for index, row in enumerate(musiq_ranked)}
    laion_rank = {row['name']: index + 1 for index, row in enumerate(laion_ranked)}
    for row in rows:
        row['musiqRank'] = musiq_rank[row['name']]
        row['laionRank'] = laion_rank[row['name']]
        row['rankDeltaLaionMinusMusiq'] = row['laionRank'] - row['musiqRank']
    musiq_values = [row['musiqScore'] for row in rows]
    laion_values = [row['laionScore'] for row in rows]
    risk_tags = {'curation-risk', 'scene-missed', 'person-missed', 'similar-scene'}
    def risk_count(ranked):
        return sum(bool(risk_tags.intersection(row['tags'])) for row in ranked[:10])
    report = {
        'status': 'completed-with-boundaries',
        'phase': 'P5.1',
        'baseline': {
            'name': 'LAION aesthetic predictor V1',
            'sampleCount': len(baseline['results']),
            'averageDurationMs': baseline.get('averageDurationMs'),
            'successCount': baseline.get('successCount'),
        },
        'candidate': {
            'name': 'MUSIQ-AVA fast single-scale',
            'sampleCount': musiq['sampleCount'],
            'successCount': musiq['successCount'],
            'averageDurationMs': musiq['averageDurationMs'],
            'p50DurationMs': musiq['p50DurationMs'],
            'p95DurationMs': musiq['p95DurationMs'],
        },
        'commonSampleCount': len(rows),
        'rankCorrelationSpearman': round(float(spearmanr(musiq_values, laion_values).statistic), 6),
        'riskTaggedInTop10': {
            'laion': risk_count(laion_ranked),
            'musiq': risk_count(musiq_ranked),
            'riskTags': sorted(risk_tags),
        },
        'top10': {
            'laion': [{'name': row['name'], 'score': row['laionScore'], 'tags': row['tags']} for row in laion_ranked[:10]],
            'musiq': [{'name': row['name'], 'score': row['musiqScore'], 'tags': row['tags']} for row in musiq_ranked[:10]],
        },
        'largestRankChanges': [
            {'name': row['name'], 'musiqRank': row['musiqRank'], 'laionRank': row['laionRank'], 'delta': row['rankDeltaLaionMinusMusiq']}
            for row in sorted(rows, key=lambda row: abs(row['rankDeltaLaionMinusMusiq']), reverse=True)[:15]
        ],
        'decision': {
            'useMusiqAsSoleSelector': False,
            'reason': 'MUSIQ changes the ranking substantially and remains susceptible to promoting tagged review-risk photos; this is not enough evidence to replace the current multi-signal curator.',
            'next': 'Keep both outputs offline; do not modify production curator until an independent preference set or manual review supports a weight change.',
        },
        'boundary': '本比较只观察公开模型在 41 张工程回归样本上的排序差异；样本没有独立人工审美金标准，不宣称任何模型的主观审美准确率。风险标签来自既有工程回归提示，也不是人工真值。',
        'output': str(OUTPUT_PATH),
    }
    OUTPUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'commonSampleCount', 'rankCorrelationSpearman', 'riskTaggedInTop10', 'decision', 'output')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
