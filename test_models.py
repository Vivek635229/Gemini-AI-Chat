from google import genai
from dotenv import load_dotenv
import os

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

CANDIDATES = [
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
]

print("Testing model quota availability...\n")
for model in CANDIDATES:
    try:
        r = client.models.generate_content(model=model, contents="Reply with only: OK")
        print(f"OK   {model}")
    except Exception as e:
        msg = str(e)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            print(f"429  {model}  (quota exhausted)")
        elif "404" in msg or "not found" in msg.lower():
            print(f"404  {model}  (model not found)")
        else:
            print(f"ERR  {model}  -> {msg[:80]}")
