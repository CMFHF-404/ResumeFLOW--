import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

from app.config import (
    derive_qwen_responses_base_url,
    normalize_ai_provider_base_url,
    resolve_ai_fast_lane_credentials,
    validate_gemini_model,
    validate_ai_responses_base_url_origin,
    validate_openai_primary_provider_urls,
    validate_openai_responses_streaming_model,
)
from app.ai_model_capabilities import (
    resolve_openai_reasoning_effort,
    supports_openai_sampling_temperature,
)

load_dotenv()

DEFAULT_ROUTE_PROFILE = "gemini_primary"
DEFAULT_AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_AI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
VALID_ROUTE_PROFILES = {
    "gemini_primary",
    "hybrid_gemini_aifast",
    "openai_primary",
    "qwen_primary",
}


@dataclass(frozen=True)
class ProbeRoute:
    lane: str
    provider: str
    api_key: Optional[str]
    base_url: str
    model: str
    transport: str


def is_qwen_model(model: str) -> bool:
    return model.strip().lower().startswith("qwen")


def mask_secret(value: Optional[str]) -> str:
    if not value:
        return "<missing>"
    if len(value) <= 8:
        return f"{value[:1]}***"
    return f"{value[:5]}...{value[-4:]}"


def normalize_base_url(value: str, default: str = "") -> str:
    return (value or default).rstrip("/")


def configured_secret(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip()
    return normalized or None


def is_production_deployment() -> bool:
    mode = os.getenv("RESUMEFLOW_DEPLOYMENT_MODE", "local").strip().lower()
    if mode not in {"local", "production"}:
        raise RuntimeError(
            "Invalid RESUMEFLOW_DEPLOYMENT_MODE: expected local or production"
        )
    return mode == "production"


def provider_from_base_url(base_url: str, model: str) -> str:
    normalized = (base_url or "").lower()
    if "aifast" in normalized or model.lower().startswith("aifast"):
        return "aifast"
    if "dashscope" in normalized or "aliyun" in normalized or is_qwen_model(model):
        return "dashscope"
    if "googleapis" in normalized or "generativelanguage" in normalized:
        return "gemini"
    return "openai_compatible"


def route_profile() -> str:
    normalized = os.getenv("AI_ROUTE_PROFILE", DEFAULT_ROUTE_PROFILE).strip().lower()
    if normalized not in VALID_ROUTE_PROFILES:
        valid = ", ".join(sorted(VALID_ROUTE_PROFILES))
        raise RuntimeError(f"Invalid AI_ROUTE_PROFILE: {normalized}. Expected one of: {valid}")
    return normalized


def resolve_gemini_route(lane: str) -> ProbeRoute:
    base_url = normalize_base_url(
        os.getenv("GEMINI_BASE_URL"),
        DEFAULT_GEMINI_BASE_URL,
    )
    if is_production_deployment():
        base_url = normalize_ai_provider_base_url(
            base_url,
            "GEMINI_BASE_URL",
            production=True,
        )
    return ProbeRoute(
        lane=lane,
        provider="gemini",
        api_key=configured_secret(os.getenv("GEMINI_API_KEY")),
        base_url=base_url,
        model=validate_gemini_model(
            os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        ),
        transport="gemini_generate_content"
        if lane != "thinking"
        else "gemini_stream_generate_content",
    )


def resolve_openai_route(lane: str, *, fast: bool = False) -> ProbeRoute:
    ai_base_url = normalize_base_url(os.getenv("AI_BASE_URL"), DEFAULT_AI_BASE_URL)
    configured_base_url = os.getenv("AI_FAST_BASE_URL") if fast else os.getenv("AI_BASE_URL")
    if fast:
        api_key, base_url = resolve_ai_fast_lane_credentials(
            ai_api_key=configured_secret(os.getenv("AI_API_KEY")),
            ai_base_url=ai_base_url,
            configured_fast_api_key=os.getenv("AI_FAST_API_KEY"),
            configured_fast_base_url=configured_base_url,
        )
    else:
        api_key = configured_secret(os.getenv("AI_API_KEY"))
        base_url = ai_base_url
    if is_production_deployment():
        base_url = normalize_ai_provider_base_url(
            base_url,
            "AI_FAST_BASE_URL" if fast and configured_base_url else "AI_BASE_URL",
            production=True,
        )
    configured_model = os.getenv("AI_FAST_MODEL") if fast else os.getenv("AI_MODEL")
    model = configured_model or os.getenv("AI_MODEL")
    profile = route_profile()
    if model is None or not model.strip():
        raise RuntimeError(
            f"Invalid AI_MODEL: it must be explicitly configured when "
            f"AI_ROUTE_PROFILE={profile}"
        )
    model = model.strip()
    if model.lower().startswith("gemini"):
        model_env = "AI_FAST_MODEL" if configured_model and fast else "AI_MODEL"
        raise RuntimeError(
            f"Invalid {model_env}: a Gemini model cannot be used with "
            f"AI_ROUTE_PROFILE={profile}"
        )
    if profile == "openai_primary" and not fast:
        responses_base_url = normalize_base_url(
            os.getenv("AI_RESPONSES_BASE_URL"),
            derive_qwen_responses_base_url(base_url),
        )
        if is_production_deployment():
            responses_base_url = normalize_ai_provider_base_url(
                responses_base_url,
                "AI_RESPONSES_BASE_URL",
                production=True,
            )
        validate_openai_primary_provider_urls(
            ai_base_url=base_url,
            ai_responses_base_url=responses_base_url,
            ai_base_url_is_explicit=bool(
                configured_base_url and configured_base_url.strip()
            ),
        )
        validate_openai_responses_streaming_model(
            model=model,
            responses_base_url=responses_base_url,
        )
    return ProbeRoute(
        lane=lane,
        provider=provider_from_base_url(base_url, model),
        api_key=api_key,
        base_url=base_url,
        model=model,
        transport="chat_completion",
    )


def resolve_route(lane: str) -> ProbeRoute:
    profile = route_profile()
    if profile == "gemini_primary":
        return resolve_gemini_route(lane)
    if lane == "resume_parse":
        return resolve_openai_route(lane, fast=True)
    if profile in {"openai_primary", "qwen_primary"}:
        if lane == "thinking":
            route = resolve_openai_route(lane)
            responses_base_url = normalize_base_url(
                os.getenv("AI_RESPONSES_BASE_URL"),
                derive_qwen_responses_base_url(route.base_url),
            )
            if is_production_deployment():
                responses_base_url = normalize_ai_provider_base_url(
                    responses_base_url,
                    "AI_RESPONSES_BASE_URL",
                    production=True,
                )
            if profile == "openai_primary":
                validate_openai_primary_provider_urls(
                    ai_base_url=route.base_url,
                    ai_responses_base_url=responses_base_url,
                    ai_base_url_is_explicit=True,
                )
                validate_openai_responses_streaming_model(
                    model=route.model,
                    responses_base_url=responses_base_url,
                )
            validate_ai_responses_base_url_origin(
                ai_base_url=route.base_url,
                ai_responses_base_url=responses_base_url,
            )
            return ProbeRoute(
                lane=lane,
                provider=route.provider,
                api_key=route.api_key,
                base_url=responses_base_url,
                model=route.model,
                transport=(
                    "qwen_responses_stream"
                    if profile == "qwen_primary"
                    else "responses_stream"
                ),
            )
        return resolve_openai_route(lane)
    if os.getenv("GEMINI_API_KEY"):
        return resolve_gemini_route(lane)
    return resolve_openai_route(lane)


def print_route(route: ProbeRoute) -> None:
    print(f"\n--- {route.lane} lane ---")
    print(f"Provider: {route.provider}")
    print(f"Transport: {route.transport}")
    print(f"Base URL: {route.base_url}")
    print(f"Model: {route.model}")
    print(f"API Key: {mask_secret(route.api_key)}")


def gemini_url(route: ProbeRoute, action: str) -> str:
    base_url = route.base_url
    normalized = base_url.lower()
    if not normalized.endswith("/v1beta") and not normalized.endswith("/v1"):
        base_url = f"{base_url}/v1beta"
    suffix = "?alt=sse" if action == "streamGenerateContent" else ""
    return f"{base_url}/models/{route.model}:{action}{suffix}"


def supports_gemini_response_mime_type(model: Optional[str]) -> bool:
    normalized = (model or "").strip().lower()
    if normalized.startswith(("gemini-3.1-flash-lite", "gemini-3.5-flash-lite")):
        return True
    return not normalized.startswith("gemini-3")


def is_gemini3_model(model: Optional[str]) -> bool:
    return (model or "").strip().lower().startswith("gemini-3")


def gemini3_thinking_level_from_budget(budget_tokens: int) -> str:
    if budget_tokens < 0:
        return "high"
    if budget_tokens == 0:
        return "minimal"
    if budget_tokens <= 1_024:
        return "low"
    if budget_tokens <= 8_192:
        return "medium"
    return "high"


def build_gemini_probe_generation_config(route: ProbeRoute) -> Dict[str, Any]:
    config: Dict[str, Any] = {}
    if not is_gemini3_model(route.model):
        config["temperature"] = 0.2
    if supports_gemini_response_mime_type(route.model):
        config["responseMimeType"] = "application/json"
    return config


def build_gemini_stream_probe_generation_config(route: ProbeRoute) -> Dict[str, Any]:
    config = build_gemini_probe_generation_config(route)
    if is_gemini3_model(route.model):
        config["thinkingConfig"] = {
            "includeThoughts": True,
            "thinkingLevel": gemini3_thinking_level_from_budget(128),
        }
    else:
        config["thinkingConfig"] = {
            "includeThoughts": True,
            "thinkingBudget": 128,
        }
    return config


def has_gemini_stream_probe_evidence(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    usage_metadata = payload.get("usageMetadata")
    if isinstance(usage_metadata, dict) and usage_metadata:
        return True
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        return False
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        finish_reason = candidate.get("finishReason")
        if isinstance(finish_reason, str) and finish_reason.strip():
            return True
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            if part.get("thought") is True:
                return True
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return True
    return False


async def test_openai_chat(route: ProbeRoute) -> bool:
    if not route.api_key:
        print("Skipped: missing API key.")
        return False
    headers = {
        "Authorization": f"Bearer {route.api_key}",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {
        "model": route.model,
        "messages": [{"role": "user", "content": "Return a tiny JSON object: {\"ok\": true}"}],
    }
    if is_qwen_model(route.model):
        payload["enable_thinking"] = False
        payload["temperature"] = 0.2
    else:
        reasoning_effort = resolve_openai_reasoning_effort(route.model)
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
        elif supports_openai_sampling_temperature(route.model):
            payload["temperature"] = 0.2
    url = f"{route.base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, headers=headers, json=payload)
    print(f"Status Code: {response.status_code}")
    if response.status_code != 200:
        print("Response:", response.text[:1000])
        return False
    data = response.json()
    message = (data.get("choices") or [{}])[0].get("message") or {}
    print("Response model:", data.get("model") or route.model)
    print("Reasoning present:", bool(message.get("reasoning_content")))
    print("Usage:", data.get("usage"))
    return True


async def test_gemini_generate(route: ProbeRoute) -> bool:
    if not route.api_key:
        print("Skipped: missing GEMINI_API_KEY.")
        return False
    headers = {"x-goog-api-key": route.api_key, "Content-Type": "application/json"}
    payload = {
        "contents": [{"role": "user", "parts": [{"text": "Return JSON: {\"ok\": true}"}]}],
        "generationConfig": build_gemini_probe_generation_config(route),
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(gemini_url(route, "generateContent"), headers=headers, json=payload)
    print(f"Status Code: {response.status_code}")
    if response.status_code != 200:
        print("Response:", response.text[:1000])
        return False
    data = response.json()
    print("Response model:", route.model)
    print("Usage:", data.get("usageMetadata"))
    return True


async def test_gemini_stream(route: ProbeRoute) -> bool:
    if not route.api_key:
        print("Skipped: missing GEMINI_API_KEY.")
        return False
    headers = {"x-goog-api-key": route.api_key, "Content-Type": "application/json"}
    generation_config = build_gemini_stream_probe_generation_config(route)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": "Return JSON: {\"ok\": true}"}]}],
        "generationConfig": generation_config,
    }
    usage = None
    saw_evidence = False
    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream(
            "POST",
            gemini_url(route, "streamGenerateContent"),
            headers=headers,
            json=payload,
        ) as response:
            print(f"Status Code: {response.status_code}")
            if response.status_code != 200:
                body = (await response.aread()).decode("utf-8", errors="ignore")
                print("Response:", body[:1000])
                return False
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                if has_gemini_stream_probe_evidence(data):
                    saw_evidence = True
                if isinstance(data.get("usageMetadata"), dict):
                    usage = data["usageMetadata"]
    print("Response model:", route.model)
    print("Usage:", usage)
    return saw_evidence


async def test_responses_stream(route: ProbeRoute) -> bool:
    if not route.api_key:
        print("Skipped: missing AI_API_KEY.")
        return False
    headers = {"Authorization": f"Bearer {route.api_key}", "Content-Type": "application/json"}
    payload: Dict[str, Any] = {
        "model": route.model,
        "input": [
            {
                "role": "user",
                "content": (
                    "Compare 73 times 29 with 2100, then return a tiny JSON "
                    "object with an ok boolean."
                ),
            }
        ],
        "stream": True,
    }
    if is_qwen_model(route.model):
        payload["enable_thinking"] = True
    else:
        reasoning_effort = resolve_openai_reasoning_effort(route.model)
        if reasoning_effort:
            payload["reasoning"] = {
                "effort": reasoning_effort,
                "summary": "auto",
            }
            payload["include"] = ["reasoning.encrypted_content"]
        elif supports_openai_sampling_temperature(route.model):
            payload["temperature"] = 0.2
    url = f"{route.base_url}/responses"
    responses_hostname = (urlparse(url).hostname or "").lower()
    if route.transport == "responses_stream" and (
        responses_hostname == "api.openai.com"
        or responses_hostname.endswith(".api.openai.com")
    ):
        payload["store"] = False
    saw_completed = False
    saw_reasoning_summary = False
    saw_output = False
    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            print(f"Status Code: {response.status_code}")
            if response.status_code != 200:
                body = (await response.aread()).decode("utf-8", errors="ignore")
                print("Response:", body[:1000])
                return False
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                event_type = event.get("type")
                if event_type == "response.completed":
                    saw_completed = True
                    response_payload = event.get("response")
                    output = (
                        response_payload.get("output")
                        if isinstance(response_payload, dict)
                        else None
                    )
                    if isinstance(output, list):
                        for item in output:
                            content = item.get("content") if isinstance(item, dict) else None
                            if not isinstance(content, list):
                                continue
                            if any(
                                isinstance(part, dict)
                                and part.get("type") in {"output_text", "text"}
                                and isinstance(part.get("text"), str)
                                and bool(part["text"].strip())
                                for part in content
                            ):
                                saw_output = True
                                break
                if event_type in {
                    "response.output_text.delta",
                    "response.output_text.done",
                } and isinstance(event.get("delta") or event.get("text"), str):
                    output_text = event.get("delta") or event.get("text")
                    if output_text.strip():
                        saw_output = True
                if event_type in {
                    "response.reasoning_summary_text.delta",
                    "response.reasoning_summary_text.done",
                } and (event.get("delta") or event.get("text")):
                    saw_reasoning_summary = True
    print("Response model:", route.model)
    print("Output present:", saw_output)
    print("Reasoning summary present:", saw_reasoning_summary)
    return saw_completed and saw_output


async def run_probe(route: ProbeRoute) -> bool:
    print_route(route)
    if route.provider == "gemini":
        if route.lane == "thinking":
            return await test_gemini_stream(route)
        return await test_gemini_generate(route)
    if route.transport in {"qwen_responses_stream", "responses_stream"}:
        return await test_responses_stream(route)
    return await test_openai_chat(route)


async def main() -> None:
    profile = route_profile()
    print(f"AI_ROUTE_PROFILE: {profile}")
    results = []
    for lane in ("default", "resume_parse", "thinking"):
        results.append(await run_probe(resolve_route(lane)))
    ok_count = sum(1 for item in results if item)
    print(f"\nProbe summary: {ok_count}/{len(results)} lane(s) reachable.")


if __name__ == "__main__":
    asyncio.run(main())
