import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_ROUTE_PROFILE = "hybrid_gemini_aifast"
DEFAULT_AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_AI_MODEL = "qwen3.7-plus"
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
VALID_ROUTE_PROFILES = {"gemini_primary", "hybrid_gemini_aifast", "qwen_primary"}


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


def derive_qwen_responses_base_url(ai_base_url: str) -> str:
    normalized = normalize_base_url(ai_base_url)
    responses_suffix = "/api/v2/apps/protocols/compatible-mode/v1"
    if normalized.endswith(responses_suffix):
        return normalized
    chat_suffix = "/compatible-mode/v1"
    if normalized.endswith(chat_suffix):
        return f"{normalized[: -len(chat_suffix)]}{responses_suffix}"
    return normalized


def resolve_gemini_route(lane: str) -> ProbeRoute:
    return ProbeRoute(
        lane=lane,
        provider="gemini",
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url=normalize_base_url(os.getenv("GEMINI_BASE_URL"), DEFAULT_GEMINI_BASE_URL),
        model=os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        transport="gemini_generate_content"
        if lane != "thinking"
        else "gemini_stream_generate_content",
    )


def resolve_openai_route(lane: str, *, fast: bool = False) -> ProbeRoute:
    base_url = normalize_base_url(
        os.getenv("AI_FAST_BASE_URL") if fast else os.getenv("AI_BASE_URL"),
        normalize_base_url(os.getenv("AI_BASE_URL"), DEFAULT_AI_BASE_URL),
    )
    model = (
        os.getenv("AI_FAST_MODEL")
        if fast
        else os.getenv("AI_MODEL")
    ) or os.getenv("AI_MODEL", DEFAULT_AI_MODEL)
    api_key = (os.getenv("AI_FAST_API_KEY") if fast else os.getenv("AI_API_KEY")) or os.getenv("AI_API_KEY")
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
    if lane == "resume_parse":
        return resolve_openai_route(lane, fast=True)
    if profile == "qwen_primary":
        if lane == "thinking":
            route = resolve_openai_route(lane)
            return ProbeRoute(
                lane=lane,
                provider=route.provider,
                api_key=route.api_key,
                base_url=normalize_base_url(
                    os.getenv("AI_RESPONSES_BASE_URL"),
                    derive_qwen_responses_base_url(route.base_url),
                ),
                model=route.model,
                transport="qwen_responses_stream",
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
    return not (model or "").strip().lower().startswith("gemini-3")


def build_gemini_probe_generation_config(route: ProbeRoute) -> Dict[str, Any]:
    config: Dict[str, Any] = {"temperature": 0.2}
    if supports_gemini_response_mime_type(route.model):
        config["responseMimeType"] = "application/json"
    return config


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
        "temperature": 0.2,
    }
    if is_qwen_model(route.model):
        payload["enable_thinking"] = False
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
    generation_config = build_gemini_probe_generation_config(route)
    generation_config["thinkingConfig"] = {"includeThoughts": True, "thinkingBudget": 128}
    payload = {
        "contents": [{"role": "user", "parts": [{"text": "Return JSON: {\"ok\": true}"}]}],
        "generationConfig": generation_config,
    }
    usage = None
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
                if data.get("usageMetadata"):
                    usage = data["usageMetadata"]
                    break
    print("Response model:", route.model)
    print("Usage:", usage)
    return True


async def test_qwen_responses_stream(route: ProbeRoute) -> bool:
    if not route.api_key:
        print("Skipped: missing AI_API_KEY.")
        return False
    headers = {"Authorization": f"Bearer {route.api_key}", "Content-Type": "application/json"}
    payload = {
        "model": route.model,
        "input": [{"role": "user", "content": "Return JSON: {\"ok\": true}"}],
        "stream": True,
        "enable_thinking": True,
    }
    url = f"{route.base_url}/responses"
    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            print(f"Status Code: {response.status_code}")
            if response.status_code != 200:
                body = (await response.aread()).decode("utf-8", errors="ignore")
                print("Response:", body[:1000])
                return False
            async for line in response.aiter_lines():
                if line.startswith("data:") and "response.completed" in line:
                    print("Response model:", route.model)
                    return True
    print("Response model:", route.model)
    return True


async def run_probe(route: ProbeRoute) -> bool:
    print_route(route)
    if route.provider == "gemini":
        if route.lane == "thinking":
            return await test_gemini_stream(route)
        return await test_gemini_generate(route)
    if route.transport == "qwen_responses_stream":
        return await test_qwen_responses_stream(route)
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
