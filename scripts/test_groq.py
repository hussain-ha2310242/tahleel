#!/usr/bin/env python3
"""Groq and Tahleel test cases. Standard library only. Never prints the key.

Usage (from the project folder):
    python3 scripts/test_groq.py            # Groq tests, plus the local app if it is running
    python3 scripts/test_groq.py --app-only # only the local app at http://localhost:8080

Reads GROQ_API_KEY and GROQ_MODEL from .env. Optional: GROQ_BASE_URL (for testing), APP_URL.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FALLBACK = "llama-3.3-70b-versatile"
results = []


def load_env():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def record(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def request(url, body=None, key=None, timeout=30):
    # A browser-like user agent: Cloudflare in front of Groq can reject Python's default one with 403.
    headers = {"content-type": "application/json", "user-agent": "tahleel-test/1.0 (+python urllib)", "accept": "application/json"}
    if key:
        headers["authorization"] = "Bearer " + key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                payload = json.loads(raw or b"{}")
            except ValueError:
                payload = {}
            return r.status, payload, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try:
            payload = json.loads(raw)
        except ValueError:
            text = raw.decode("utf-8", "replace")
            hint = " (Cloudflare block page)" if "cloudflare" in text.lower() else ""
            payload = {"error": {"message": "non-JSON reply" + hint + ": " + " ".join(text.split())[:160]}}
        return e.code, payload, int((time.time() - t0) * 1000)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return None, {"error": {"message": str(getattr(e, "reason", e))}}, int((time.time() - t0) * 1000)


def err(payload):
    return (payload.get("error") or {}).get("message", "") if isinstance(payload, dict) else ""


def groq_tests():
    base = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    key = os.environ.get("GROQ_API_KEY", "")
    model = os.environ.get("GROQ_MODEL") or "openai/gpt-oss-120b"

    record("1. GROQ_API_KEY is set in .env", bool(key), "missing" if not key else "length %d" % len(key))
    if not key:
        return

    status, payload, ms = request(base + "/models", key=key)
    if status is None:
        record("2. Groq is reachable", False, err(payload))
        return
    record("2. Groq is reachable", True, "%d ms" % ms)
    record("3. Key is accepted", status == 200, "HTTP %s %s" % (status, err(payload)) if status != 200 else "")
    if status != 200:
        if status == 403:
            print("     403 means Groq or its Cloudflare edge refused the request before checking the model.")
            print("     Common causes: a VPN or proxy, a region Groq does not serve, or a network filter. Try another network or turn the VPN off.")
        return

    available = sorted(m.get("id", "") for m in payload.get("data", []))
    record("4. Configured model is available: " + model, model in available,
           "" if model in available else "not on this account; set GROQ_MODEL in .env")
    record("5. Fallback model is available: " + FALLBACK, FALLBACK in available)
    print("     models on this key: " + ", ".join(m for m in available if "whisper" not in m and "tts" not in m))

    prompt = [
        {"role": "system", "content": "Reply with one JSON object only."},
        {"role": "user", "content": 'Return {"ok":true,"population":"<a short target population for a survey on AI use at Qatar University>"}'},
    ]
    for n, m in ((6, model), (7, FALLBACK)):
        if m not in available:
            print("SKIP %d. JSON reply from %s  (model not available)" % (n, m))
            continue
        body = {"model": m, "messages": prompt, "response_format": {"type": "json_object"}}
        if "gpt-oss" in m:
            body.update(max_completion_tokens=512, reasoning_effort="low", include_reasoning=False, temperature=0.3)
        else:
            body.update(max_tokens=200, temperature=0.2)
        status, payload, ms = request(base + "/chat/completions", body, key=key)
        if status != 200:
            record("%d. JSON reply from %s" % (n, m), False, "HTTP %s %s" % (status, err(payload)))
            continue
        content = payload["choices"][0]["message"].get("content") or ""
        try:
            parsed = json.loads(content)
            record("%d. JSON reply from %s" % (n, m), parsed.get("ok") is True, "%d ms: %s" % (ms, content[:90]))
        except ValueError:
            record("%d. JSON reply from %s" % (n, m), False, "not JSON: " + content[:90])
        if n == 6:
            record("   %s replies within Netlify's 9 s budget" % m, ms < 9000, "%d ms" % ms)


def app_tests():
    app = os.environ.get("APP_URL", "http://localhost:8080").rstrip("/")
    status, _, _ = request(app + "/")
    if status is None:
        print("SKIP app tests: nothing is running at %s (start it with: node scripts/serve-local.js)" % app)
        return
    record("8. App home page loads", status == 200)
    status, payload, ms = request(app + "/api/chat", {
        "instruction": "start", "target": "population",
        "objective": "Understanding AI usage for projects at Qatar University",
        "state": {}, "history": [{"role": "user", "text": "Understanding AI usage for projects at Qatar University"}],
    }, timeout=40)
    data = payload.get("data") or {}
    fields = data.get("fields") or []
    ok = status == 200 and payload.get("ok") and len(fields) >= 3
    record("9. App planning call returns population fields", bool(ok),
           "%d ms, %d fields" % (ms, len(fields)) if ok else "HTTP %s %s" % (status, payload.get("error", "")))
    if ok:
        ids = [f.get("id") for f in fields]
        record("10. Reply includes inclusion and exclusion criteria", "include" in ids and "exclude" in ids, ", ".join(ids))


if __name__ == "__main__":
    load_env()
    if "--app-only" not in sys.argv:
        groq_tests()
    app_tests()
    passed = sum(results)
    print("\n%d passed, %d failed" % (passed, len(results) - passed))
    sys.exit(0 if results and all(results) else 1)
