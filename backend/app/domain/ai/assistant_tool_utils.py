from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List

from ...config import load_settings
from .llm_transport import _call_llm, _post_chat_completion
from .response_normalizers import _parse_json_content

settings = load_settings()
logger = logging.getLogger(__name__)


def _extract_message(response_data: Dict[str, Any]) -> Dict[str, Any]:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    return message


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
        data = await _post_chat_completion(payload)
        message = _extract_message(data)
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            follow_up_messages = [*messages, message]
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
                tool_result = tool_executor(tool_name, arguments if isinstance(arguments, dict) else {})
                follow_up_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.get("id"),
                        "name": tool_name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )
            return await _call_llm(follow_up_messages, json_mode=json_mode)
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("LLM response missing content")
        return _parse_json_content(content) if json_mode else {"content": content}
    except Exception:
        logger.warning("[AI Tools] tool calling unavailable; falling back to standard assistant generation.", exc_info=True)
        return await _call_llm(messages, json_mode=json_mode)


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
                "description": "Return the user's experience library, certifications, skills, and profile context already loaded for this turn.",
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
