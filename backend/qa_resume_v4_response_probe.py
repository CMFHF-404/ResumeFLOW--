"""One diagnostic request; retain only response shape, never provider text."""
import os
os.environ['FEISHU_WEBHOOK_URL'] = ''
import asyncio
import hashlib
import json
import sys
from pathlib import Path
import qa_resume_blind_benchmark as b
from app.domain.ai import llm_transport
from app.domain.ai.resume_evaluation_audit import audit_reports
from app.database import engine

tag = sys.argv[1] if len(sys.argv) == 2 else ''
if not tag.isalnum():
    raise SystemExit('Alphanumeric unique probe tag required')
source = b.OUT.with_name(b.OUT.name + '-v4audit20260907a')
fixture = json.loads((source / 'fixtures.json').read_text(encoding='utf-8'))
b.OUT = b.OUT.with_name(b.OUT.name + '-' + tag)
if b.OUT.exists():
    raise SystemExit('Probe already exists; never overwrite or automatically retry')
assert not b.qa_runtime_fingerprint()['external_notifications_enabled']
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), {
    'fixtures.json': fixture,
    'protocol.json': {'purpose': 'one response-shape diagnostic; not acceptance', 'attempts': 1,
                      'timeout_seconds': 40, 'external_notifications': False}})
shape = {}
original_build = llm_transport._build_gemini_request_body
original_parse = llm_transport._parse_json_content_candidates

def observe_build(**kwargs):
    body = original_build(**kwargs)
    config = body['generationConfig']
    schema = config.get('responseJsonSchema')
    shape['request'] = {'json_mime': config.get('responseMimeType') == 'application/json',
                        'schema_present': isinstance(schema, dict),
                        'schema_hash': hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()}
    return body

def observe_parse(candidates):
    value = candidates[0].strip() if candidates else ''
    shape['response'] = {'candidate_count': len(candidates), 'assembled_chars': len(value),
        'assembled_sha256': hashlib.sha256(value.encode()).hexdigest(),
        'starts_json_object': value.startswith('{'), 'has_open_brace': '{' in value,
        'has_close_brace': '}' in value, 'has_markdown_heading': value.startswith('#'),
        'has_code_fence': '```' in value, 'mentions_reports_key': '"reports"' in value,
        'mentions_report_alias': 'REPORT_001' in value,
        'has_verdict_vocabulary': any(word in value for word in ('符合', '不符合', '不确定'))}
    return original_parse(candidates)

llm_transport._build_gemini_request_body = observe_build
llm_transport._parse_json_content_candidates = observe_parse

async def main():
    try:
        await b.call_record('response-probe', lambda: asyncio.wait_for(
            audit_reports([c['report'] for c in fixture['cases']], fixture['input']), timeout=40), 'qa-blind-20260906')
    finally:
        b.save('response-shape.json', shape)
        print(json.dumps(shape), flush=True)
        await engine.dispose()

asyncio.run(main())
