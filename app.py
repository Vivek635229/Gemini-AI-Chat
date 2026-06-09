import os
import uuid
import time
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, make_response
from google import genai
from google.genai import types
from google.genai import errors as genai_errors

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# ─── Configuration ─────────────────────────────────────────────────────────────
GEMINI_API_KEY        = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
GOOGLE_SEARCH_API_KEY = os.getenv("GOOGLE_SEARCH_API_KEY")
GOOGLE_SEARCH_CX      = os.getenv("GOOGLE_SEARCH_CX")

# Model fallback chain — tried in order when quota (429) is hit
# Free-tier daily limits (approx): 2.5-flash-lite: 1500, 2.5-flash: 500, 3.5-flash: 20
MODEL_FALLBACK_CHAIN: List[str] = [
    os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite"),  # primary (highest free quota)
    "gemini-2.5-flash",                                   # fallback 1
    "gemini-2.5-flash-lite",                              # fallback 2 (in case primary overridden)
]
# Deduplicate while preserving order
_seen: set = set()
MODEL_FALLBACK_CHAIN = [m for m in MODEL_FALLBACK_CHAIN if not (m in _seen or _seen.add(m))]

# Active model index (advances automatically on 429)
_active_model_idx: int = 0

def get_active_model() -> str:
    return MODEL_FALLBACK_CHAIN[_active_model_idx % len(MODEL_FALLBACK_CHAIN)]

# Initialise Gemini client
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ─── Optional search library imports ───────────────────────────────────────────
try:
    from ddgs import DDGS
    DDGS_AVAILABLE = True
except ImportError:
    DDGS_AVAILABLE = False

try:
    from googleapi import google as googleapi_search
    GOOGLEAPI_AVAILABLE = True
except ImportError:
    GOOGLEAPI_AVAILABLE = False

SYSTEM_INSTRUCTION = (
    "You are GeminiChat, a helpful AI assistant powered by Google Gemini 3.5 Flash.\n"
    "Rules:\n"
    "- Be concise, accurate, and friendly.\n"
    "- Use the conversation history to remember what the user said earlier.\n"
    "- If real-time search snippets are provided, use them as primary source for facts.\n"
    "- Always cite the source when using search results.\n"
    "- When asked for current prices, weather, breaking news, or anything "
    "time-sensitive, rely on the search context provided.\n"
    "- If no search context is available for a time-sensitive question, say so clearly.\n"
    "- Format responses with markdown when helpful (bold, bullet lists, code blocks)."
)

# ─── In-memory stores ──────────────────────────────────────────────────────────
# conversations[sid] = [{role, content}, ...]
CONVERSATIONS: Dict[str, List[Dict[str, str]]] = {}
# conv_meta[sid] = {title, created_at, updated_at}
CONV_META: Dict[str, Dict] = {}


# ─── Session + conversation helpers ────────────────────────────────────────────

def get_session_id() -> str:
    """Get or create the current conversation's session ID."""
    if "sid" not in session:
        new_sid = uuid.uuid4().hex
        session["sid"] = new_sid
        _register_conv(new_sid)
    return session["sid"]


def _register_conv(sid: str) -> None:
    """Register a conversation ID in the browser session list."""
    all_sids: List[str] = session.get("all_sids", [])
    if sid not in all_sids:
        all_sids.insert(0, sid)   # newest first
        session["all_sids"] = all_sids
        session.modified = True
    # Ensure meta entry
    if sid not in CONV_META:
        CONV_META[sid] = {
            "title":      "New conversation",
            "created_at": time.time(),
            "updated_at": time.time(),
        }


def get_history(sid: str) -> List[Dict[str, str]]:
    return CONVERSATIONS.setdefault(sid, [])


def trim_history(history: List[Dict[str, str]], max_messages: int = 30) -> None:
    if len(history) > max_messages:
        del history[: len(history) - max_messages]


def _auto_title(message: str) -> str:
    """Generate a conversation title from the first user message."""
    clean = message.strip().replace("\n", " ")
    return clean[:48] + ("…" if len(clean) > 48 else "")


# ─── Real-time search detection ─────────────────────────────────────────────────

REALTIME_KEYWORDS = {
    "current", "latest", "today", "now", "price", "weather", "forecast",
    "news", "bitcoin", "btc", "eth", "ethereum", "usd", "inr", "mumbai",
    "delhi", "stock", "exchange rate", "population", "live", "trending",
    "breaking", "just", "recently", "right now", "score", "match",
    "rate", "market", "crypto", "nifty", "sensex", "rupee", "dollar",
}


def needs_real_time_search(message: str) -> bool:
    msg = message.lower()
    return any(kw in msg for kw in REALTIME_KEYWORDS)


# ─── Search engines ────────────────────────────────────────────────────────────

def search_ddgs(query: str, max_results: int = 4) -> List[Dict[str, str]]:
    if not DDGS_AVAILABLE:
        return []
    try:
        with DDGS() as ddgs:
            raw = list(ddgs.text(query, max_results=max_results))
        return [
            {
                "title":   item.get("title", ""),
                "link":    item.get("href", ""),
                "snippet": item.get("body", ""),
                "source":  "DuckDuckGo",
            }
            for item in raw
        ]
    except Exception:
        return []


def search_googleapi(query: str, max_results: int = 3) -> List[Dict[str, str]]:
    if not GOOGLEAPI_AVAILABLE:
        return []
    try:
        raw = googleapi_search.search(query, pages=1)
        results = [
            {
                "title":   getattr(item, "name", "") or "",
                "link":    getattr(item, "link", "") or getattr(item, "google_link", "") or "",
                "snippet": getattr(item, "description", "") or "",
                "source":  "Google Search",
            }
            for item in raw[:max_results]
        ]
        return [r for r in results if r["title"] or r["link"]]
    except Exception:
        return []


def search_google_custom(query: str, max_results: int = 3) -> List[Dict[str, str]]:
    if not GOOGLE_SEARCH_API_KEY or not GOOGLE_SEARCH_CX:
        return []
    try:
        resp = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": GOOGLE_SEARCH_API_KEY, "cx": GOOGLE_SEARCH_CX,
                    "q": query, "num": max_results},
            timeout=12,
        )
        resp.raise_for_status()
        return [
            {"title": i.get("title", ""), "link": i.get("link", ""),
             "snippet": i.get("snippet", ""), "source": "Google Custom Search"}
            for i in resp.json().get("items", [])[:max_results]
        ]
    except Exception:
        return []


def smart_search(query: str, max_results: int = 4) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    seen: set = set()

    def add(items):
        for r in items:
            if r["link"] not in seen:
                results.append(r)
                seen.add(r["link"])

    add(search_ddgs(query, max_results))
    if len(results) < max_results:
        add(search_googleapi(query, max_results - len(results)))
    if len(results) < max_results and GOOGLE_SEARCH_API_KEY:
        add(search_google_custom(query, max_results - len(results)))

    return results[:max_results]


# ─── Prompt builder ──────────────────────────────────────────────────────────

def build_search_context(snippets: List[Dict[str, str]]) -> str:
    if not snippets:
        return ""
    lines = ["[Real-time Search Results]"]
    for i, item in enumerate(snippets, 1):
        lines.append(f"{i}. [{item.get('source','Web')}] {item.get('title','')}")
        if item.get("snippet"):
            lines.append(f"   {item['snippet']}")
        if item.get("link"):
            lines.append(f"   URL: {item['link']}")
    return "\n".join(lines)


def build_prompt(message: str, history: List[Dict[str, str]], search_context: str) -> str:
    history_lines = [
        f"{'User' if h['role'] == 'user' else 'Assistant'}: {h['content']}"
        for h in history[-16:]
    ]
    parts = [f"Conversation History:\n" + ("\n".join(history_lines) or "No prior conversation.")]
    if search_context:
        parts.append(search_context)
    parts.append(f"User: {message}")
    parts.append(
        "Answer naturally. If you used search results, mention the most relevant "
        "source and key fact briefly."
    )
    return "\n\n".join(parts)


def generate_reply(message: str, history: List[Dict[str, str]],
                   snippets: List[Dict[str, str]]) -> tuple[str, str]:
    """
    Generate a reply using the active model.
    Automatically advances to the next fallback model on 429.
    Returns (reply_text, model_used).
    """
    global _active_model_idx
    prompt = build_prompt(message, history, build_search_context(snippets))

    last_exc = None
    for attempt in range(len(MODEL_FALLBACK_CHAIN)):
        model = MODEL_FALLBACK_CHAIN[_active_model_idx % len(MODEL_FALLBACK_CHAIN)]
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.7,
                    max_output_tokens=2048,
                ),
            )
            text = (response.text or "").strip() or "I could not generate a response."
            return text, model
        except genai_errors.ClientError as exc:
            code = getattr(exc, "status_code", 0)
            if code == 429:
                # Quota exhausted — advance to next model in chain
                _active_model_idx = (_active_model_idx + 1) % len(MODEL_FALLBACK_CHAIN)
                last_exc = exc
                continue
            raise  # Re-raise non-quota errors immediately
        except Exception:
            raise

    # All models exhausted
    raise last_exc


# ════════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/favicon.ico")
def favicon():
    return make_response("", 204)


@app.route("/", methods=["GET"])
def index():
    session_id = get_session_id()
    history    = get_history(session_id)
    return render_template("index.html", history=history)


# ─── Conversation management ──────────────────────────────────────────────────

@app.route("/api/conversations", methods=["GET"])
def api_list_conversations():
    """Return all conversations for this browser session, newest first."""
    all_sids: List[str] = session.get("all_sids", [])
    # Sync: ensure current sid is in the list
    current = session.get("sid")
    if current and current not in all_sids:
        all_sids.insert(0, current)
        session["all_sids"] = all_sids

    convs = []
    for sid in all_sids:
        history = CONVERSATIONS.get(sid, [])
        meta    = CONV_META.get(sid, {})
        convs.append({
            "id":            sid,
            "title":         meta.get("title", "New conversation"),
            "messageCount":  len(history),
            "updatedAt":     meta.get("updated_at", 0),
            "active":        sid == current,
        })
    return jsonify({"conversations": convs, "activeSid": current})


@app.route("/api/conversations/new", methods=["POST"])
def api_new_conversation():
    """Create a brand-new empty conversation and make it active."""
    new_sid = uuid.uuid4().hex
    session["sid"] = new_sid
    _register_conv(new_sid)
    return jsonify({"sid": new_sid, "ok": True})


@app.route("/api/conversations/activate", methods=["POST"])
def api_activate_conversation():
    """Switch to an existing conversation by sid."""
    payload = request.get_json(silent=True) or {}
    sid     = payload.get("sid", "").strip()
    all_sids = session.get("all_sids", [])
    if not sid or sid not in all_sids:
        return jsonify({"error": "Unknown conversation id."}), 404
    session["sid"] = sid
    history = get_history(sid)
    meta    = CONV_META.get(sid, {})
    return jsonify({
        "ok":      True,
        "sid":     sid,
        "title":   meta.get("title", "New conversation"),
        "history": history,
    })


@app.route("/api/conversations/delete", methods=["POST"])
def api_delete_conversation():
    """Delete a conversation."""
    payload  = request.get_json(silent=True) or {}
    sid      = payload.get("sid", "").strip()
    all_sids: List[str] = session.get("all_sids", [])
    if sid in all_sids:
        all_sids.remove(sid)
        session["all_sids"] = all_sids
    CONVERSATIONS.pop(sid, None)
    CONV_META.pop(sid, None)
    # If we deleted the active one, switch to newest remaining
    if session.get("sid") == sid:
        session["sid"] = all_sids[0] if all_sids else uuid.uuid4().hex
        _register_conv(session["sid"])
    session.modified = True
    return jsonify({"ok": True, "activeSid": session["sid"]})


# ─── Health check ─────────────────────────────────────────────────────────────

@app.route("/api/test", methods=["GET"])
def api_test():
    result = {
        "gemini": {"configured": bool(GEMINI_API_KEY), "model": GEMINI_MODEL,
                   "ok": False, "error": None},
        "search": {
            "ddgs":         DDGS_AVAILABLE,
            "googleapi":    GOOGLEAPI_AVAILABLE,
            "google_custom": bool(GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX),
            "ok":           DDGS_AVAILABLE or GOOGLEAPI_AVAILABLE or bool(GOOGLE_SEARCH_API_KEY),
        },
    }
    if client:
        try:
            probe = client.models.generate_content(
                model=GEMINI_MODEL, contents="Reply with exactly the word: OK")
            result["gemini"]["ok"] = bool(probe.text)
        except Exception as exc:
            result["gemini"]["error"] = str(exc)
    else:
        result["gemini"]["error"] = "GEMINI_API_KEY not set"

    ok = result["gemini"]["ok"]
    return jsonify({"status": "ok" if ok else "degraded", **result}), 200 if ok else 207


# ─── Chat ─────────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def api_chat():
    if not client:
        return jsonify({"error": "Missing GEMINI_API_KEY."}), 400

    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message field is required."}), 400

    sid     = get_session_id()
    history = get_history(sid)

    # Run search if needed
    snippets: List[Dict[str, str]] = []
    searched       = False
    search_sources: List[str] = []

    if needs_real_time_search(message):
        snippets       = smart_search(message, max_results=4)
        searched       = True
        search_sources = list({r.get("source", "") for r in snippets if r.get("source")})

    # Generate reply
    try:
        reply = generate_reply(message, history, snippets)
    except genai_errors.ClientError as exc:
        code = getattr(exc, "status_code", 500)
        if code == 429:
            return jsonify({"error": "⏳ API quota exhausted. Please wait a moment."}), 429
        return jsonify({"error": f"Gemini error ({code}): {exc}"}), 502
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500

    # Persist
    is_first = len(history) == 0
    history.append({"role": "user",      "content": message})
    history.append({"role": "assistant", "content": reply})
    trim_history(history)

    # Auto-title on first message
    if is_first and sid in CONV_META:
        CONV_META[sid]["title"] = _auto_title(message)
    if sid in CONV_META:
        CONV_META[sid]["updated_at"] = time.time()

    # Bubble this conversation to top of list
    all_sids: List[str] = session.get("all_sids", [])
    if sid in all_sids and all_sids[0] != sid:
        all_sids.remove(sid)
        all_sids.insert(0, sid)
        session["all_sids"] = all_sids
        session.modified = True

    return jsonify({
        "reply":         reply,
        "searchResults": snippets,
        "searched":      searched,
        "searchSources": search_sources,
        "historyLength": len(history),
        "convTitle":     CONV_META.get(sid, {}).get("title", "New conversation"),
        "convId":        sid,
    })


# ─── History + reset ──────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def api_history():
    sid = get_session_id()
    return jsonify({"history": get_history(sid), "sid": sid})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Create a new conversation (kept as compatibility alias)."""
    new_sid = uuid.uuid4().hex
    session["sid"] = new_sid
    _register_conv(new_sid)
    return jsonify({"ok": True, "sid": new_sid})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
