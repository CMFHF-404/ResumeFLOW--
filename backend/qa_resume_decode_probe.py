"""Isolated decode experiment: python qa_resume_decode_probe.py NEW_RUN_TAG.

Repeat the same tag to resume missing samples under an unchanged frozen contract.
"""
import asyncio
import json
import sys

import qa_resume_blind_benchmark as b
from app.domain.ai import llm_transport as transport


def save_exclusive(name, value):
    # Never replace evidence, even if another process completed this sample first.
    with (b.OUT / name).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


async def main():
    b.reject_retired_numeric_run()
    if len(sys.argv) != 2 or not sys.argv[1].isalnum():
        raise SystemExit('Usage: python qa_resume_decode_probe.py NEW_RUN_TAG')
    from app.database import engine

    original_out = b.OUT
    original_save = b.save
    build = transport._build_gemini_request_body
    source = original_out.with_name(original_out.name + '-wave4')
    sample = json.loads((source / 'optimization-R2M9-1.json').read_text(
        encoding='utf-8'))['value']['resume']
    b.OUT = original_out.with_name(original_out.name + '-decode-' + sys.argv[1])

    def deterministic_body(**kwargs):
        body = build(**kwargs)
        body['generationConfig']['temperature'] = 0
        return body

    try:
        b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), {
            'fixtures.json': {'jd': b.JD, 'target_role': b.ROLE, 'resume': sample},
            'protocol.json': {
                'experiment': 'temperature=0 versus default decoding, identical post-optimization text',
                'temperature': 0, 'repeats': 3,
                'source_run': source.name, 'source_result': 'optimization-R2M9-1.json',
                'scope': 'isolated process; same model, provider and production scorer',
                'resume_policy': 'retain completed successes and failures; run only missing samples',
            },
        })
        # Check all cached results before calling the provider. A partial write
        # is evidence of interruption, not permission to overwrite that attempt.
        missing = []
        for index in (1, 2, 3):
            name = f'evaluation-{index}'
            path = b.OUT / (name + '.json')
            if not path.exists():
                missing.append(name)
                continue
            try:
                result = json.loads(path.read_text(encoding='utf-8'))
                if not isinstance(result, dict) or type(result.get('ok')) is not bool:
                    raise ValueError('invalid result')
                if result['ok'] and 'value' not in result:
                    raise ValueError('missing result value')
                if not result['ok'] and not isinstance(result.get('error_type'), str):
                    raise ValueError('missing failure type')
            except (OSError, ValueError):
                raise SystemExit('Damaged cached sample; use a NEW run tag') from None
        transport._build_gemini_request_body = deterministic_body
        b.save = save_exclusive
        for name in missing:
            await b.call_record(name, lambda: b.evaluate(sample), 'qa-blind-20260906')
    finally:
        b.save = original_save
        b.OUT = original_out
        transport._build_gemini_request_body = build
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
