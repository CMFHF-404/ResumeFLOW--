"""Frozen live rubric gate. No full benchmark is authorized by a failed gate."""
import os
os.environ['FEISHU_WEBHOOK_URL'] = ''

import asyncio
import copy
import json
import random
import sys
from datetime import datetime, timezone

import qa_resume_blind_benchmark as b
from app.domain.ai.resume_evaluation_audit import audit_reports, AUDIT_VERSION
from app.domain.ai.resume_evaluation_service import _build_full_resume_evaluation_input
from app.database import engine

if b.qa_runtime_fingerprint()['external_notifications_enabled']:
    raise SystemExit('External notifications must be disabled for this QA child process')

tag = sys.argv[1] if len(sys.argv) == 2 else ''
if not tag.isalnum():
    raise SystemExit('Usage: python qa_resume_v4_audit_gate.py NEWALPHANUMERICTAG')
source = b.OUT.with_name(b.OUT.name + '-v3accept20260907a')
b.OUT = b.OUT.with_name(b.OUT.name + '-' + tag)
from qa_resume_v4_rubric_cases import make_cases
evaluation_input, cases = make_cases(source, b.JD, b.ROLE)
artifacts = {'fixtures.json': {'input': evaluation_input, 'cases': cases},
             'protocol.json': {'audit_version': AUDIT_VERSION, 'rounds': 2, 'seeds': [4071, 9832],
                'target_dimension': 'per_case', 'expected': 'all nine labeled verdicts correct in BOTH rounds',
                'gate_contract_version': 2,
                'boundary': 'live audit-only gate; does not prove whole-report validity or score stability',
                'external_notifications': False, 'no_retry_filtering': True}}
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), artifacts)


async def main():
    results = []
    for index, seed in enumerate([4071, 9832], 1):
        ordered = list(cases)
        random.Random(seed).shuffle(ordered)
        name = f'audit-gate-{index}'
        path = b.OUT / (name + '.json')
        if path.exists():
            result = json.loads(path.read_text(encoding='utf-8'))
        else:
            result = await b.call_record(name, lambda: asyncio.wait_for(
                audit_reports([c['report'] for c in ordered], evaluation_input), timeout=40), 'qa-blind-20260906')
        judgments = []
        if result['ok']:
            for case, receipt in zip(ordered, result['value']):
                actual = next(d['verdict'] for d in receipt['dimensions'] if d['dimension'] == case['target_dimension'])
                judgments.append({'case': case['id'], 'dimension': case['target_dimension'], 'expected': case['expected'], 'actual': actual,
                                  'passed': actual == case['expected']})
        results.append({'round': index, 'ok': result['ok'], 'judgments': judgments,
                        'passed': result['ok'] and len(judgments) == len(cases) and all(x['passed'] for x in judgments)})
    passed = all(r['passed'] for r in results)
    b.save('gate-result.json', {'passed': passed, 'rounds': results, 'finished_at': datetime.now(timezone.utc).isoformat()})
    print(json.dumps({'passed': passed, 'rounds': results}, ensure_ascii=False), flush=True)
    await engine.dispose()

asyncio.run(main())
