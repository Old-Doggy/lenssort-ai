import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
records = json.loads((root / 'artifacts/similarity-eval-records.json').read_text(encoding='utf-8'))
manifest = json.loads((root / 'data/eval/similarity_cases/manifest.json').read_text(encoding='utf-8'))
by_title = {record['title']: record for record in records}

def hamming(left, right):
    return sum((int(a, 16) ^ int(b, 16)).bit_count() for a, b in zip(left, right))

rows = []
for case in manifest['cases']:
    left = by_title[case['left']]
    right = by_title[case['right']]
    d_distance = hamming(left['dHash'], right['dHash'])
    p_distance = hamming(left['pHash'], right['pHash'])
    same_group = bool(left['similarityGroupId']) and left['similarityGroupId'] == right['similarityGroupId']
    rows.append({
        **case,
        'dHashDistance': d_distance,
        'pHashDistance': p_distance,
        'detectedNearDuplicate': same_group,
        'leftGroup': left['similarityGroupId'],
        'rightGroup': right['similarityGroupId'],
        'leftNear': left['isNearDuplicate'],
        'rightNear': right['isNearDuplicate'],
    })

(root / 'artifacts/similarity-eval-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
expected = sum(row['expectedNearDuplicate'] for row in rows)
detected = sum(row['detectedNearDuplicate'] for row in rows)
correct = sum(row['expectedNearDuplicate'] == row['detectedNearDuplicate'] for row in rows)
print(json.dumps({'cases': len(rows), 'expectedNearDuplicate': expected, 'detectedNearDuplicate': detected, 'correctPairDecisions': correct}, ensure_ascii=False, indent=2))
for row in rows:
    print(f"{row['id']} d={row['dHashDistance']} p={row['pHashDistance']} expected={row['expectedNearDuplicate']} detected={row['detectedNearDuplicate']}")
