from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List

from ...config import load_settings
from . import runtime_budget
from .llm_transport import (
    ToolCallingUnsupportedError,
    _call_llm,
    _post_chat_completion,
)
from .response_normalizers import _parse_json_content

settings = load_settings()
logger = logging.getLogger(__name__)
MAX_ASSISTANT_TOOL_CALLS = 8


def _ensure_tool_followup_within_budget(
    messages: List[Dict[str, Any]],
) -> None:
    budget = runtime_budget.get_ai_runtime_budget()
    serialized = json.dumps(
        {
            "model": settings.ai_model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": budget.max_output_tokens,
        },
        ensure_ascii=True,
    ).encode("utf-8")
    if len(serialized) > budget.max_request_body_bytes:
        raise runtime_budget.AiRuntimeBudgetExceeded(
            runtime_budget.AiRuntimeBudgetExceeded.public_message
        )


def _extract_message(response_data: Dict[str, Any]) -> Dict[str, Any]:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    return message


@runtime_budget.ai_wall_clock_limited
async def _call_llm_with_tools(
    messages: List[Dict[str, Any]],
    *,
    tools: List[Dict[str, Any]],
    tool_executor: Callable[[str, Dict[str, Any]], Dict[str, Any]],
    json_mode: bool = True,
) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
        "tools": tools,
        "tool_choice": "auto",
    }
    try:
        data = await _post_chat_completion(payload, request_label="assistant_tool_call")
    except runtime_budget.TERMINAL_AI_RUNTIME_ERRORS:
        raise
    except ToolCallingUnsupportedError:
        logger.warning(
            "[AI Tools] provider explicitly rejected tool calling; falling back to standard assistant generation.",
        )
        return await _call_llm(
            messages,
            json_mode=json_mode,
            request_label="assistant_tool_fallback",
        )

    message = _extract_message(data)
    tool_calls = message.get("tool_calls") or []
    if tool_calls:
        if not isinstance(tool_calls, list):
            raise ValueError("LLM response tool_calls must be a list")
        if len(tool_calls) > MAX_ASSISTANT_TOOL_CALLS:
            raise runtime_budget.AiRuntimeBudgetExceeded(
                runtime_budget.AiRuntimeBudgetExceeded.public_message
            )
        follow_up_messages = [*messages, message]
        _ensure_tool_followup_within_budget(follow_up_messages)
        cached_results: Dict[tuple[str, str], str] = {}
        for tool_call in tool_calls:
            function_call = tool_call.get("function") if isinstance(tool_call, dict) else None
            if not isinstance(function_call, dict):
                continue
            tool_name = str(function_call.get("name") or "")
            raw_arguments = function_call.get("arguments")
            try:
                arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) and raw_arguments.strip() else {}
            except json.JSONDecodeError:
                arguments = {}
            normalized_arguments = arguments if isinstance(arguments, dict) else {}
            cache_key = (
                tool_name,
                json.dumps(
                    normalized_arguments,
                    ensure_ascii=True,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            )
            serialized_result = cached_results.get(cache_key)
            if serialized_result is None:
                tool_result = tool_executor(tool_name, normalized_arguments)
                serialized_result = json.dumps(tool_result, ensure_ascii=False)
                cached_results[cache_key] = serialized_result
            tool_message = {
                "role": "tool",
                "tool_call_id": tool_call.get("id"),
                "name": tool_name,
                "content": serialized_result,
            }
            candidate_messages = [*follow_up_messages, tool_message]
            _ensure_tool_followup_within_budget(candidate_messages)
            follow_up_messages.append(tool_message)
        return await _call_llm(
            follow_up_messages,
            json_mode=json_mode,
            request_label="assistant_tool_followup",
        )
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response missing content")
    return _parse_json_content(content) if json_mode else {"content": content}


def _build_assistant_context_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_selected_experience_full_text",
                "description": "Return full, untruncated STAR text for the selected experience by masterId.",
                "parameters": {
                    "type": "object",
                    "properties": {"masterId": {"type": "string"}},
                    "required": ["masterId"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_selected_resume_context",
                "description": "Return the selected resume snapshot and linked JD context available in the current assistant turn.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_bank_context",
                "description": "Return the bounded experience-library snapshot loaded for this turn. Inspect _meta truncated flags before reasoning about items that may be omitted.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _build_assistant_context_tool_executor(
    payload: Dict[str, Any],
) -> Callable[[str, Dict[str, Any]], Dict[str, Any]]:
    def execute(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name == "get_selected_experience_full_text":
            master_id = str(arguments.get("masterId") or "").strip()
            for item in payload.get("selected_experiences") or []:
                if isinstance(item, dict) and item.get("masterId") == master_id:
                    return {"experience": item.get("full_text") or item}
            return {"experience": None}
        if tool_name == "get_selected_resume_context":
            return {"selected_resume": payload.get("selected_resume")}
        if tool_name == "get_bank_context":
            return {"bank_context": payload.get("bank_context")}
        return {"error": f"Unknown tool: {tool_name}"}

    return execute
