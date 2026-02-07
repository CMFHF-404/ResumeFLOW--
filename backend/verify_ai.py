import os
import httpx
import asyncio
from dotenv import load_dotenv

# Load .env
load_dotenv()

DEFAULT_MODEL = "gemini-3-flash"

def mask_secret(value: str) -> str:
    if len(value) <= 8:
        return f"{value[:1]}***"
    return f"{value[:5]}...{value[-4:]}"

def resolve_config() -> tuple[str, str, str]:
    api_key = os.getenv("AI_API_KEY")
    base_url = os.getenv("AI_BASE_URL")
    model = os.getenv("AI_MODEL", DEFAULT_MODEL)

    missing = [name for name, val in {"AI_API_KEY": api_key, "AI_BASE_URL": base_url}.items() if not val]
    if missing:
        raise RuntimeError(f"Missing required environment variable(s): {', '.join(missing)}")

    return api_key, base_url.rstrip("/"), model

async def test_endpoint(url, api_key: str, model: str):
    print(f"\n--- Testing URL: {url} ---")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Hello, are you working?"}],
        "temperature": 0.7
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            print(f"Status Code: {response.status_code}")
            if response.status_code == 200:
                print("Success!")
                print("Response:", response.json())
                return True
            else:
                print("Failed.")
                print("Response:", response.text)
                return False
    except Exception as e:
        print(f"Error: {e}")
        return False

async def main():
    try:
        api_key, base_url, model = resolve_config()
    except RuntimeError as exc:
        print(f"Configuration error: {exc}")
        return

    print(f"Testing connectivity to: {base_url}")
    print(f"Model: {model}")
    print(f"API Key: {mask_secret(api_key)}")

    # Test path 1: As configured in app (base + /chat/completions)
    url1 = f"{base_url}/chat/completions"
    success1 = await test_endpoint(url1, api_key, model)
    
    # Test path 2: Adding /v1 if missing
    if "/v1" not in base_url:
        url2 = f"{base_url}/v1/chat/completions"
        success2 = await test_endpoint(url2, api_key, model)
        
        if success2 and not success1:
            print("\nRecommendation: logic works with /v1. Please update AI_BASE_URL to include /v1.")
        elif success1:
             print("\nConfiguration is correct.")
    else:
        if success1:
             print("\nConfiguration is correct.")

if __name__ == "__main__":
    asyncio.run(main())
