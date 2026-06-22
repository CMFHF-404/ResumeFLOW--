import os
import httpx
import asyncio
from dotenv import load_dotenv

# Load .env
load_dotenv()


def mask_secret(value: str) -> str:
    if not value:
        return "None"
    if len(value) <= 8:
        return f"{value[:1]}***"
    return f"{value[:5]}...{value[-4:]}"


def is_qwen_model(model: str | None) -> bool:
    return bool(model and model.lower().startswith("qwen"))


async def check_chat_completions(base_url, api_key, model):
    url = f"{base_url.rstrip('/')}/chat/completions"
    print(f"\n[1] Testing Chat Completions: {url}")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Ping"}],
        "max_tokens": 10
    }
    if is_qwen_model(model):
        payload["enable_thinking"] = False

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            print(f"Status Code: {response.status_code}")
            if response.status_code == 200:
                print("[SUCCESS]")
                print("Response:", response.json().get("choices", [{}])[0].get("message", {}).get("content", ""))
                return True
            print(f"[FAILED]: {response.text}")
            return False
    except Exception as e:
        print(f"[ERROR] during Chat Completions: {e}")
        return False


async def check_qwen_thinking_stream(base_url, api_key, model):
    url = f"{base_url.rstrip('/')}/chat/completions"
    print(f"\n[2] Testing Qwen Thinking Stream: {url}")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Think briefly and say hi."}],
        "stream": True,
        "enable_thinking": True,
        "thinking_budget": 1024,
        "max_tokens": 32
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                print(f"Status Code: {response.status_code}")
                if response.status_code != 200:
                    body = await response.aread()
                    print(f"[FAILED]: {body.decode('utf-8', errors='ignore')}")
                    return False

                print("[SUCCESS] Stream opened successfully. Reading first few chunks...")
                chunk_count = 0
                async for line in response.aiter_lines():
                    if line.startswith("data:"):
                        print(f"Chunk observed: {line[:100]}...")
                        chunk_count += 1
                        if chunk_count >= 2:
                            break

                if chunk_count > 0:
                    print("[SUCCESS] Stream is working!")
                    return True
                print("[FAILED] No data received from stream.")
                return False
    except Exception as e:
        print(f"[ERROR] during Qwen Stream: {e}")
        return False


async def check_gemini_thinking_stream(base_url, api_key, model):
    # Construct Gemini stream URL like in ai_service.py
    url_base = base_url.rstrip("/")
    if not url_base.lower().endswith("/v1beta") and not url_base.lower().endswith("/v1"):
        url_base = f"{url_base}/v1beta"
    url = f"{url_base}/models/{model}:streamGenerateContent?alt=sse"

    print(f"\n[3] Testing optional Gemini rollback stream: {url}")
    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json"
    }

    payload = {
        "contents": [{"role": "user", "parts": [{"text": "Hello, please think briefly and say hi."}]}],
        "generationConfig": {
            "thinkingConfig": {"includeThoughts": True, "thinkingBudget": 1024}
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                print(f"Status Code: {response.status_code}")
                if response.status_code != 200:
                    body = await response.aread()
                    print(f"[FAILED]: {body.decode('utf-8', errors='ignore')}")
                    return False

                print("[SUCCESS] Stream opened successfully. Reading first few chunks...")
                chunk_count = 0
                async for line in response.aiter_lines():
                    if line.startswith("data:"):
                        print(f"Chunk observed: {line[:100]}...")
                        chunk_count += 1
                        if chunk_count >= 2:
                            break

                if chunk_count > 0:
                    print("[SUCCESS] Stream is working!")
                    return True
                print("[FAILED] No data received from stream.")
                return False
    except Exception as e:
        print(f"[ERROR] during Gemini Stream: {e}")
        return False


async def main():
    ai_key = os.getenv("AI_API_KEY")
    ai_base = os.getenv("AI_BASE_URL")
    ai_model = os.getenv("AI_MODEL") or "qwen3.7-plus"

    gemini_key = os.getenv("GEMINI_API_KEY")
    gemini_base = os.getenv("GEMINI_BASE_URL")
    gemini_model = os.getenv("GEMINI_MODEL")

    print("--- AI Service Diagnostics ---")
    print(f"Chat API: URL={ai_base}, Model={ai_model}, Key={mask_secret(ai_key)}")
    print(f"Gemini rollback: URL={gemini_base}, Model={gemini_model}, Key={mask_secret(gemini_key)}")

    if not ai_key or not ai_base:
        print("[ERROR] AI configuration missing in .env")
        return

    await check_chat_completions(ai_base, ai_key, ai_model)
    if is_qwen_model(ai_model):
        await check_qwen_thinking_stream(ai_base, ai_key, ai_model)

    if gemini_key and gemini_base and gemini_model:
        await check_gemini_thinking_stream(gemini_base, gemini_key, gemini_model)
    else:
        print("\n[3] Optional Gemini rollback stream skipped; GEMINI_* is not fully configured.")


if __name__ == "__main__":
    asyncio.run(main())
