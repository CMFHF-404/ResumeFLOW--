"""Frozen, exclusive output and resumable attempt records for diagnostic probes."""
import asyncio
import hashlib
import json
import uuid
from contextlib import contextmanager
from pathlib import Path

import qa_resume_blind_benchmark as benchmark


def save_exclusive(name, value):
    with (benchmark.OUT / name).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def cached_result(name):
    path = benchmark.OUT / (name + '.json')
    if not path.exists():
        return None
    try:
        result = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(result, dict) or type(result.get('ok')) is not bool:
            raise ValueError('invalid result')
        if result['ok'] and 'value' not in result:
            raise ValueError('missing value')
        if not result['ok'] and not ('error_type' in result or 'causes' in result):
            raise ValueError('missing failure')
        return result
    except (OSError, ValueError):
        raise SystemExit('Damaged probe result; use a NEW run tag') from None


@contextmanager
def frozen_probe(output, entrypoint, artifacts, cases):
    original_out, original_save = benchmark.OUT, benchmark.save
    benchmark.OUT = output
    lock = None
    try:
        hashes = benchmark.qa_algorithm_hashes(entrypoint)
        helper = Path(__file__)
        hashes[helper.name] = hashlib.sha256(helper.read_bytes()).hexdigest()
        benchmark.prepare_frozen_wave_output(hashes, artifacts)
        # Reject all damaged samples before opening any billing/provider session.
        for name in cases:
            cached_result(name)
        lock_path = output / '.active'
        try:
            lock = lock_path.open('x')
        except FileExistsError:
            raise SystemExit('Probe already active or interrupted; use a NEW run tag') from None
        benchmark.save = save_exclusive
        yield
    finally:
        if lock is not None:
            lock.close()
            lock_path.unlink()
        benchmark.OUT, benchmark.save = original_out, original_save


async def run_case(name, operation):
    previous = cached_result(name)
    if previous is not None:
        return previous
    output = benchmark.OUT
    attempt = output / ('attempt-' + name + '-' + uuid.uuid4().hex)
    attempt.mkdir()
    benchmark.OUT = attempt
    try:
        result = await operation()
    except asyncio.CancelledError:
        save_exclusive('interrupted.json', {'ok': False, 'error_type': 'CancelledError'})
        raise
    finally:
        benchmark.OUT = output
    result = {**result, 'attempt_id': attempt.name}
    save_exclusive(name + '.json', result)
    return result
