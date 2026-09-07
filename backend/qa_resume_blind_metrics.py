"""Read-only result aggregation. Never calls an AI model or selects best scores."""
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

tag = sys.argv[1]
if not tag.isalnum():
    raise SystemExit('Use an alphanumeric run tag')
root = Path(__file__).resolve().parents[1] / 'docs/qa'
folder = root / ('2026-09-06-resume-blind-' + tag)
if not (folder / 'finished.json').exists():
    raise SystemExit('Incomplete round: do not calculate final metrics')

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

metrics = {'round': tag, 'stages': {}}
for stage in ('baseline', 'optimization', 'post', 'blind', 'member'):
    paths = [p for p in sorted(folder.glob(stage + '-*.json'))
             if not p.name.startswith(('blind-key-', 'blind-input-'))]
    rows = [read(p) for p in paths]
    passed = [r for r in rows if r['ok']]
    times = [r['seconds'] for r in rows if 'seconds' in r]
    metrics['stages'][stage] = {
        'attempts': len(rows), 'successes': len(passed),
        'failures': dict(Counter(r['error_type'] for r in rows if not r['ok'])),
        'latency_median_seconds': statistics.median(times) if times else None,
        'latency_max_seconds': max(times) if times else None,
    }
    if stage == 'optimization':
        metrics['plans_with_actual_edits'] = sum(bool(r['value']['accepted']) for r in passed)
        metrics['successful_no_op_plans'] = sum(not r['value']['accepted'] for r in passed)
        candidates = [c for r in passed for c in r['value']['changes'] if c['action_kind'] == 'rewrite_now']
        metrics['rewrite_candidates'] = len(candidates)
        metrics['allowed_rewrite_candidates'] = sum(c['safety_status'] == 'allowed' for c in candidates)
        metrics['blocked_rewrite_candidates'] = [
            {'field': c['field_path'], 'reasons': c['safety_findings']} for c in candidates
            if c['safety_status'] != 'allowed'
        ]

metrics['scores'] = read(folder / 'summary.json')
metrics['blind_pairs'] = []
for p in sorted(folder.glob('blind-key-*.json')):
    sample = p.stem.removeprefix('blind-key-')
    result = read(folder / ('blind-' + sample + '.json'))
    if not result['ok']:
        metrics['blind_pairs'].append({'id': sample, 'ok': False})
        continue
    key = read(p)
    result = result['value']
    preferred = result.get('preferredId')
    metrics['blind_pairs'].append({
        'id': sample, 'ok': True,
        'preference': 'tie' if preferred == 'tie' else next((k for k, v in key.items() if v == preferred), 'invalid'),
        'after': next((d for d in result['documents'] if d['id'] == key['after']), None),
    })
(folder / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in metrics.items() if k != 'scores'}, ensure_ascii=False, indent=2))
