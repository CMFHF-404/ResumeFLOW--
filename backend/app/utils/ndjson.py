import json
from typing import Any, Dict


def ndjson_line(payload: Dict[str, Any]) -> str:
    """Serialize one streaming event as a newline-delimited JSON record."""
    return json.dumps(payload, ensure_ascii=False) + "\n"
