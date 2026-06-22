import os
import httpx
from dotenv import load_dotenv

load_dotenv()

async def ping():
    url = os.getenv("AI_BASE_URL") + "/chat/completions"
    key = os.getenv("AI_API_KEY")
    model = os.getenv("AI_MODEL", "qwen3.7-plus")
    print(f"Pinging {url}...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": [{"role": "user", "content": "hi"}]},
                timeout=5.0,
            )
            print(f"Status: {resp.status_code}")
    except Exception as e:
        print(f"Exception Type: {type(e)}")
        print(f"Exception Args: {e.args}")
        print(f"Exception String: '{str(e)}'")

if __name__ == "__main__":
    import asyncio
    asyncio.run(ping())
