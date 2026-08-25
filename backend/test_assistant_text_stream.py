import unittest
import gc
import warnings
from unittest.mock import patch

from app.domain.ai import assistant_text_stream, llm_transport
from app.domain.ai.runtime_budget import (
    AiRuntimeBudget,
    AiRuntimeTimeoutError,
    AiStreamConsumerError,
    run_with_total_timeout,
)


class AssistantTextStreamTests(unittest.IsolatedAsyncioTestCase):
    def test_llm_transport_preserves_private_helper_compatibility(self) -> None:
        self.assertIs(
            llm_transport._AssistantTextDeltaTracker,
            assistant_text_stream._AssistantTextDeltaTracker,
        )
        self.assertIs(
            llm_transport._extract_assistant_text_prefix,
            assistant_text_stream._extract_assistant_text_prefix,
        )

    def test_tracker_only_emits_the_assistant_text_json_field(self) -> None:
        events: list[dict] = []
        tracker = assistant_text_stream._AssistantTextDeltaTracker(events.append)

        tracker.update('{"assistantText":"你好\\n')
        tracker.update(
            '世界\\u0021","draftCard":{"summary":"不要泄露"},"suggestedFollowups":[]}'
        )

        self.assertEqual(
            events,
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "你好\n"},
                {"type": "assistant_delta", "delta": "世界!"},
            ],
        )

    async def test_tracker_awaits_async_callbacks(self) -> None:
        events: list[dict] = []

        async def append_event(event: dict) -> None:
            events.append(event)

        tracker = assistant_text_stream._AssistantTextDeltaTracker(append_event)
        await tracker.emit_update('{"assistantText":"done"}')

        self.assertEqual(
            events,
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "done"},
            ],
        )

    def test_tracker_decodes_escaped_surrogate_pair_across_single_char_chunks(self) -> None:
        events: list[dict] = []
        tracker = assistant_text_stream._AssistantTextDeltaTracker(
            events.append,
            max_buffer_chars=10_000,
            max_chunks=10_000,
            max_events=10_000,
        )
        payload = '{"other":"ignored","assistantText":"A\\ud83d\\ude00B"}'

        for char in payload:
            tracker.update(char)

        self.assertEqual(
            "".join(
                event["delta"]
                for event in events
                if event["type"] == "assistant_delta"
            ),
            "A😀B",
        )
        self.assertLessEqual(tracker.scan_operations, len(payload) * 2)

    def test_tracker_processes_one_megabyte_in_ten_thousand_chunks_linearly(self) -> None:
        total_chars = 1024 * 1024
        prefix = '{"assistantText":"'
        suffix = '"}'
        value_length = total_chars - len(prefix) - len(suffix)
        value_chunk_count = 9_998
        base_size, remainder = divmod(value_length, value_chunk_count)
        chunks = [prefix]
        chunks.extend(
            "x" * (base_size + (1 if index < remainder else 0))
            for index in range(value_chunk_count)
        )
        chunks.append(suffix)
        events: list[dict] = []
        tracker = assistant_text_stream._AssistantTextDeltaTracker(
            events.append,
            max_buffer_chars=total_chars,
            max_chunks=10_000,
            max_events=10_000,
        )

        for chunk in chunks:
            tracker.update(chunk)

        self.assertEqual(len(chunks), 10_000)
        self.assertEqual(
            sum(
                len(event["delta"])
                for event in events
                if event["type"] == "assistant_delta"
            ),
            value_length,
        )
        self.assertLessEqual(tracker.scan_operations, total_chars)

    async def test_async_tracker_yields_so_absolute_deadline_can_cancel_tiny_chunks(self) -> None:
        tracker = assistant_text_stream._AssistantTextDeltaTracker(
            max_buffer_chars=200_000,
            max_chunks=200_000,
            max_events=200_000,
        )

        async def consume_tiny_chunks() -> None:
            for _ in range(200_000):
                await tracker.emit_update(" ")

        budget = AiRuntimeBudget(stream_total_timeout_seconds=0.001)
        with patch(
            "app.domain.ai.runtime_budget.get_ai_runtime_budget",
            return_value=budget,
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await run_with_total_timeout(consume_tiny_chunks(), budget=budget)
        self.assertLess(tracker.chunk_count, 200_000)

    def test_tracker_ignores_nested_assistant_text_and_uses_top_level_field(self) -> None:
        events: list[dict] = []
        tracker = assistant_text_stream._AssistantTextDeltaTracker(events.append)

        tracker.update(
            '{"draftCard":{"assistantText":"nested"},"assistantText":"top"}'
        )

        self.assertEqual(
            events,
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "top"},
            ],
        )

    def test_tracker_accepts_escaped_top_level_key(self) -> None:
        events: list[dict] = []
        tracker = assistant_text_stream._AssistantTextDeltaTracker(events.append)

        tracker.update('{"assistant\\u0054ext":"escaped key"}')

        self.assertEqual(events[-1], {"type": "assistant_delta", "delta": "escaped key"})

    def test_tracker_first_top_level_field_wins_even_for_duplicate_or_non_string(self) -> None:
        duplicate_events: list[dict] = []
        duplicate_tracker = assistant_text_stream._AssistantTextDeltaTracker(
            duplicate_events.append
        )
        duplicate_tracker.update(
            '{"assistantText":"first","assistantText":"second"}'
        )
        self.assertEqual(
            "".join(
                event.get("delta", "") for event in duplicate_events
            ),
            "first",
        )

        non_string_events: list[dict] = []
        non_string_tracker = assistant_text_stream._AssistantTextDeltaTracker(
            non_string_events.append
        )
        non_string_tracker.update(
            '{"assistantText":null,"assistantText":"second"}'
        )
        self.assertEqual(non_string_events, [])

    def test_sync_update_closes_async_callback_coroutine_before_raising(self) -> None:
        async def callback(_event: dict) -> None:
            return None

        tracker = assistant_text_stream._AssistantTextDeltaTracker(callback)
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            with self.assertRaises(AiStreamConsumerError):
                tracker.update('{"assistantText":"value"}')
            gc.collect()

        self.assertFalse(
            any("was never awaited" in str(item.message) for item in captured)
        )


if __name__ == "__main__":
    unittest.main()
