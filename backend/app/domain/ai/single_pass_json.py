"""Decode one JSON response without content checks, repair or regeneration."""
import json
import logging

logger = logging.getLogger(__name__)


def parse_single_pass_json(response):
    if isinstance(response, dict) and 'content' in response:
        response = response['content']
    if isinstance(response, str):
        payload = response.strip()
        # A complete Markdown envelope is presentation, not part of the JSON.
        # Never search prose for an object or repair malformed JSON inside it.
        lines = payload.splitlines()
        if len(lines) >= 3 and lines[0].lower() in ('```json', '```') and lines[-1] == '```':
            payload = '\n'.join(lines[1:-1])
            logger.info('Single-pass JSON: removed complete Markdown envelope')
        response = json.loads(payload)
    if not isinstance(response, dict):
        raise ValueError('JSON root must be an object')
    return response
