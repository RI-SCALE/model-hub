import json
import logging
import os
from typing import Any
from urllib.parse import urlparse

import httpx
from hypha_rpc import api
from openai import AsyncOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_client: AsyncOpenAI | None = None
_DEFAULT_ALLOWED_HOSTS = "beta.bioimagearchive.org,www.ebi.ac.uk"


def _allowed_hosts() -> set[str]:
    raw_value = os.environ.get("RESOLVE_URL_ALLOWED_HOSTS", _DEFAULT_ALLOWED_HOSTS)
    hosts = {part.strip().lower() for part in raw_value.split(",") if part.strip()}
    return hosts


def _normalize_headers(headers: dict[str, Any] | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if not isinstance(headers, dict):
        return normalized
    for key, value in headers.items():
        if not isinstance(key, str):
            continue
        if isinstance(value, str):
            normalized[key] = value
        elif value is not None:
            normalized[key] = str(value)
    return normalized


def _error_payload(url: str, status_code: int, error: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status_code": int(status_code),
        "url": str(url),
        "error": error,
    }


async def _resolve_openai_key() -> str | None:
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key

    try:
        key = await api.get_env("OPENAI_API_KEY")
        if isinstance(key, str) and key:
            return key
    except Exception as exp:
        logger.warning(f"Failed to read OPENAI_API_KEY via api.get_env: {exp}")

    try:
        am = await api.get_service("public/artifact-manager")
        content = await am.read_file(
            artifact_id="ri-scale/openai-secret", file_path="secret.json"
        )
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        payload = json.loads(content)
        key = payload.get("api_key")
        if isinstance(key, str) and key:
            return key
    except Exception as exp:
        logger.warning(f"Failed artifact fallback for OPENAI_API_KEY: {exp}")

    return None


async def setup() -> dict[str, Any]:
    global _client
    key = await _resolve_openai_key()
    if not key:
        logger.error("OPENAI_API_KEY is missing")
        _client = None
        return {"ok": False, "error": "OPENAI_API_KEY is missing"}

    _client = AsyncOpenAI(api_key=key)
    logger.info("OpenAI client initialized")
    return {"ok": True}


async def resolve_url(
    url: str,
    method: str = "GET",
    headers: dict[str, Any] | None = None,
    timeout: float = 30.0,
    body: str | dict[str, Any] | list[Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        parsed = urlparse(str(url))
    except Exception as exp:
        return _error_payload(str(url), 400, f"Invalid URL: {exp}")

    host = (parsed.hostname or "").lower()
    if parsed.scheme.lower() != "https":
        return _error_payload(str(url), 400, "Only https URLs are allowed")

    if host not in _allowed_hosts():
        return _error_payload(
            str(url),
            403,
            f"Host '{host}' is not allowed by RESOLVE_URL_ALLOWED_HOSTS",
        )

    method_value = str(method or "GET").upper()
    if method_value not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
        return _error_payload(str(url), 400, f"Unsupported method: {method_value}")

    request_headers = _normalize_headers(headers)
    request_headers.setdefault("User-Agent", "ri-scale-model-hub-chat-proxy/1.0")

    timeout_seconds = max(1.0, float(timeout))

    request_kwargs: dict[str, Any] = {
        "method": method_value,
        "url": str(url),
        "headers": request_headers,
    }
    if body is not None:
        if isinstance(body, (dict, list)):
            request_kwargs["json"] = body
        else:
            request_kwargs["content"] = str(body)

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
            response = await client.request(**request_kwargs)
    except Exception as exp:
        logger.warning("resolve_url failed for %s: %s", url, exp)
        return _error_payload(str(url), 502, str(exp))

    result: dict[str, Any] = {
        "ok": 200 <= int(response.status_code) < 300,
        "status_code": int(response.status_code),
        "url": str(response.url),
        "headers": dict(response.headers),
    }

    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type.lower():
        try:
            result["json"] = response.json()
        except Exception:
            result["text"] = response.text
    else:
        result["text"] = response.text

    if not result["ok"]:
        result["error"] = f"Upstream returned HTTP {response.status_code}"

    return result


async def chat_completion(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | str | None = None,
    model: str = "gpt-5-mini",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    global _client

    if _client is None:
        setup_result = await setup()
        if not setup_result.get("ok"):
            return {"error": "Server is missing OpenAI API Key."}

    assert _client is not None
    try:
        kwargs: dict[str, Any] = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice

        response = await _client.chat.completions.create(**kwargs)
        return json.loads(response.model_dump_json())
    except Exception as exp:
        logger.error(f"OpenAI call failed: {exp}")
        return {"error": str(exp)}


api.export(
    {
        "config": {"visibility": "public"},
        "setup": setup,
        "chat_completion": chat_completion,
        "resolve_url": resolve_url,
    }
)
