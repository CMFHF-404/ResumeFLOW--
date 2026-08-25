import asyncio
import inspect
import json
from typing import Any, Awaitable, Callable, Dict, Optional

from .runtime_budget import (
    AiRuntimeBudgetExceeded,
    AiStreamConsumerError,
    TERMINAL_AI_RUNTIME_ERRORS,
    get_ai_runtime_budget,
)


AssistantTextCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]


async def _emit_assistant_text(
    assistant_text_callback: AssistantTextCallback,
    payload: Dict[str, Any],
) -> None:
    if not assistant_text_callback:
        return
    try:
        result = assistant_text_callback(payload)
        if inspect.isawaitable(result):
            await result
    except TERMINAL_AI_RUNTIME_ERRORS:
        raise
    except Exception as exc:
        raise AiStreamConsumerError(AiStreamConsumerError.public_message) from exc


def _decode_json_string_prefix(
    text: str,
    start: int,
) -> tuple[str, bool, int]:
    if start >= len(text) or text[start] != '"':
        return "", False, start
    index = start + 1
    last_safe_index = index
    escaped = False
    while index < len(text):
        char = text[index]
        if escaped:
            if char == "u":
                unicode_end = index + 5
                if unicode_end > len(text):
                    break
                if not all(
                    item in "0123456789abcdefABCDEF"
                    for item in text[index + 1 : unicode_end]
                ):
                    break
                index = unicode_end
            else:
                index += 1
            escaped = False
            last_safe_index = index
            continue
        if char == "\\":
            escaped = True
            index += 1
            continue
        if char == '"':
            try:
                return json.loads(text[start : index + 1]), True, index + 1
            except json.JSONDecodeError:
                return "", False, start
        if ord(char) < 0x20:
            break
        index += 1
        last_safe_index = index

    if last_safe_index <= start + 1:
        return "", False, last_safe_index
    try:
        decoded = json.loads(f'{text[start:last_safe_index]}"')
    except json.JSONDecodeError:
        return "", False, last_safe_index
    if decoded and 0xD800 <= ord(decoded[-1]) <= 0xDBFF:
        decoded = decoded[:-1]
    return decoded, False, last_safe_index


def _find_json_field_value_start(text: str, field_name: str) -> int | None:
    index = 0
    while index < len(text):
        if text[index] != '"':
            index += 1
            continue
        value, closed, end_index = _decode_json_string_prefix(text, index)
        if not closed:
            return None
        index = end_index
        if value != field_name:
            continue
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] != ":":
            continue
        index += 1
        while index < len(text) and text[index].isspace():
            index += 1
        return index
    return None


def _extract_assistant_text_prefix(text: str) -> str | None:
    value_start = _find_json_field_value_start(text, "assistantText")
    if value_start is None or value_start >= len(text) or text[value_start] != '"':
        return None
    value, _, _ = _decode_json_string_prefix(text, value_start)
    return value


_JSON_ESCAPE_CHARACTERS = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}
_JSON_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")
_ASSISTANT_TEXT_FIELD = "assistantText"
_ASYNC_COOPERATIVE_YIELD_CHUNKS = 64


class _IncrementalJsonStringDecoder:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._state = "normal"
        self._unicode_digits = ""
        self._pending_high_surrogate: int | None = None
        self.closed = False
        self.invalid = False

    def _decode_codepoint(self, codepoint: int) -> str:
        pending = self._pending_high_surrogate
        if 0xD800 <= codepoint <= 0xDBFF:
            prefix = "\ufffd" if pending is not None else ""
            self._pending_high_surrogate = codepoint
            return prefix
        if 0xDC00 <= codepoint <= 0xDFFF:
            if pending is None:
                return "\ufffd"
            self._pending_high_surrogate = None
            combined = 0x10000 + ((pending - 0xD800) << 10) + (codepoint - 0xDC00)
            return chr(combined)
        prefix = ""
        if pending is not None:
            prefix = "\ufffd"
            self._pending_high_surrogate = None
        return f"{prefix}{chr(codepoint)}"

    def feed(self, char: str) -> tuple[str, bool, bool]:
        if self.closed or self.invalid:
            return "", self.closed, self.invalid

        if self._state == "unicode":
            if char not in _JSON_HEX_DIGITS:
                self.invalid = True
                return "", False, True
            self._unicode_digits += char
            if len(self._unicode_digits) < 4:
                return "", False, False
            codepoint = int(self._unicode_digits, 16)
            self._unicode_digits = ""
            self._state = "normal"
            return self._decode_codepoint(codepoint), False, False

        if self._state == "escape":
            self._state = "normal"
            if char == "u":
                self._state = "unicode"
                self._unicode_digits = ""
                return "", False, False
            decoded = _JSON_ESCAPE_CHARACTERS.get(char)
            if decoded is None:
                self.invalid = True
                return "", False, True
            prefix = ""
            if self._pending_high_surrogate is not None:
                prefix = "\ufffd"
                self._pending_high_surrogate = None
            return f"{prefix}{decoded}", False, False

        if self._pending_high_surrogate is not None and char != "\\":
            prefix = "\ufffd"
            self._pending_high_surrogate = None
        else:
            prefix = ""
        if char == "\\":
            self._state = "escape"
            return prefix, False, False
        if char == '"':
            self.closed = True
            return prefix, True, False
        if ord(char) < 0x20:
            self.invalid = True
            return "", False, True
        return f"{prefix}{char}", False, False


class _AssistantTextDeltaTracker:
    def __init__(
        self,
        callback: AssistantTextCallback = None,
        *,
        max_buffer_chars: int | None = None,
        max_chunks: int | None = None,
        max_events: int | None = None,
    ):
        self._callback = callback
        self._started = False
        budget = get_ai_runtime_budget()
        self._max_buffer_chars = (
            max_buffer_chars
            if max_buffer_chars is not None
            else budget.max_assistant_buffer_chars
        )
        self._max_chunks = (
            max_chunks if max_chunks is not None else budget.max_sse_events
        )
        self._max_events = (
            max_events if max_events is not None else budget.max_sse_events
        )
        self._total_chars = 0
        self._chunk_count = 0
        self._event_count = 0
        self._scan_operations = 0
        self._state = "search"
        self._containers: list[str] = []
        self._top_level_expects_key = False
        self._string_decoder = _IncrementalJsonStringDecoder()
        self._string_is_top_level_key = False
        self._candidate_parts: list[str] = []
        self._candidate_overflow = False

    @property
    def chunk_count(self) -> int:
        return self._chunk_count

    @property
    def scan_operations(self) -> int:
        return self._scan_operations

    def _start_string(self, *, is_top_level_key: bool) -> None:
        self._string_decoder.reset()
        self._string_is_top_level_key = is_top_level_key
        self._candidate_parts = []
        self._candidate_overflow = False
        self._state = "string"

    def _append_candidate_fragment(self, fragment: str) -> None:
        if not fragment or self._candidate_overflow:
            return
        current_length = sum(len(part) for part in self._candidate_parts)
        remaining = len(_ASSISTANT_TEXT_FIELD) + 1 - current_length
        if remaining <= 0:
            self._candidate_overflow = True
            return
        self._candidate_parts.append(fragment[:remaining])
        if len(fragment) > remaining or current_length + len(fragment) > len(
            _ASSISTANT_TEXT_FIELD
        ):
            self._candidate_overflow = True

    def _reserve_input_budget(self, raw_chunk: str) -> None:
        next_total_chars = self._total_chars + len(raw_chunk)
        if next_total_chars > self._max_buffer_chars:
            raise AiRuntimeBudgetExceeded(
                "AI assistant text exceeded the cumulative buffer budget."
            )
        next_chunk_count = self._chunk_count + 1
        if next_chunk_count > self._max_chunks:
            raise AiRuntimeBudgetExceeded(
                "AI assistant text exceeded the chunk-count budget."
            )
        self._total_chars = next_total_chars
        self._chunk_count = next_chunk_count

    def _reserve_event_budget(self, events: list[Dict[str, Any]]) -> None:
        next_event_count = self._event_count + len(events)
        if next_event_count > self._max_events:
            raise AiRuntimeBudgetExceeded(
                "AI assistant text exceeded the event-count budget."
            )
        self._event_count = next_event_count

    def _events_for_chunk(self, raw_chunk: str) -> list[Dict[str, Any]]:
        if not raw_chunk:
            return []
        self._reserve_input_budget(raw_chunk)
        events: list[Dict[str, Any]] = []
        delta_parts: list[str] = []
        index = 0
        while index < len(raw_chunk) and self._state != "done":
            char = raw_chunk[index]
            self._scan_operations += 1
            if self._state == "search":
                if char == '"':
                    self._start_string(
                        is_top_level_key=(
                            self._containers == ["{"]
                            and self._top_level_expects_key
                        )
                    )
                elif char in "{[":
                    self._containers.append(char)
                    if self._containers == ["{"]:
                        self._top_level_expects_key = True
                elif char == "}" and self._containers[-1:] == ["{"]:
                    self._containers.pop()
                    if not self._containers:
                        self._state = "done"
                elif char == "]" and self._containers[-1:] == ["["]:
                    self._containers.pop()
                elif char == "," and self._containers == ["{"]:
                    self._top_level_expects_key = True
                index += 1
                continue

            if self._state == "string":
                fragment, closed, invalid = self._string_decoder.feed(char)
                if self._string_is_top_level_key:
                    self._append_candidate_fragment(fragment)
                index += 1
                if invalid:
                    self._state = "done"
                elif closed:
                    if self._string_is_top_level_key:
                        self._state = "after_key"
                    else:
                        self._state = "search"
                continue

            if self._state == "after_key":
                if char.isspace():
                    index += 1
                    continue
                if char == ":":
                    candidate = "".join(self._candidate_parts)
                    self._top_level_expects_key = False
                    self._state = (
                        "before_value"
                        if not self._candidate_overflow
                        and candidate == _ASSISTANT_TEXT_FIELD
                        else "search"
                    )
                    index += 1
                    continue
                self._state = "done"
                index += 1
                continue

            if self._state == "before_value":
                if char.isspace():
                    index += 1
                    continue
                if char != '"':
                    self._state = "done"
                    index += 1
                    continue
                self._string_decoder.reset()
                self._state = "value"
                index += 1
                if not self._started:
                    self._started = True
                    events.append({"type": "assistant_text_reset"})
                continue

            fragment, closed, invalid = self._string_decoder.feed(char)
            if fragment:
                delta_parts.append(fragment)
            index += 1
            if invalid or closed:
                self._state = "done"

        if delta_parts:
            events.append(
                {"type": "assistant_delta", "delta": "".join(delta_parts)}
            )
        self._reserve_event_budget(events)
        return events

    def update(self, raw_chunk: str) -> list[Dict[str, Any]]:
        events = self._events_for_chunk(raw_chunk)
        if self._callback:
            for event in events:
                try:
                    result = self._callback(event)
                    if inspect.isawaitable(result):
                        if inspect.iscoroutine(result):
                            result.close()
                        raise RuntimeError(
                            "Use emit_update for async assistant text callbacks."
                        )
                except TERMINAL_AI_RUNTIME_ERRORS:
                    raise
                except Exception as exc:
                    raise AiStreamConsumerError(
                        AiStreamConsumerError.public_message
                    ) from exc
        return events

    async def emit_update(self, raw_chunk: str) -> None:
        for event in self._events_for_chunk(raw_chunk):
            await _emit_assistant_text(self._callback, event)
        if (
            self._chunk_count > 0
            and self._chunk_count % _ASYNC_COOPERATIVE_YIELD_CHUNKS == 0
        ):
            await asyncio.sleep(0)
