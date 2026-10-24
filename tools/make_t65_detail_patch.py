from pathlib import Path

project_root = Path(__file__).resolve().parents[1]
target = project_root / 'src/App.tsx'
output = project_root / 'artifacts/t65-detail.patch'
token = '<p className="detail-reason">{selectedPhoto.reason}</p>'
replacement = '<RecommendationExplanation explanation={getRecommendationExplanation(selectedPhoto, activeMode, sentiment)} /><p className="detail-reason">原始分析：{selectedPhoto.reason}</p>'
lines = target.read_text(encoding='utf-8').splitlines()
matches = [line for line in lines if token in line]
if len(matches) != 1:
    raise SystemExit(f'Expected one detail token match, found {len(matches)}')
old_line = matches[0]
new_line = old_line.replace(token, replacement, 1)
patch = f'*** Begin Patch\n*** Update File: {target.as_posix()}\n@@\n-{old_line}\n+{new_line}\n*** End Patch\n'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(patch, encoding='utf-8', newline='\n')
