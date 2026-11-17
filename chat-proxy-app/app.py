import base64
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
_DEFAULT_ALLOWED_HOSTS = "beta.bioimagearchive.org,www.ebi.ac.uk,uk1s3.embassy.ebi.ac.uk,livingobjects.ebi.ac.uk"


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
        async with httpx.AsyncClient(
            timeout=timeout_seconds, follow_redirects=True
        ) as client:
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
    elif content_type.lower().startswith("image/") or "octet-stream" in content_type.lower():
        result["base64"] = base64.b64encode(response.content).decode("ascii")
        result["content_type"] = content_type
    else:
        result["text"] = response.text

    if not result["ok"]:
        result["error"] = f"Upstream returned HTTP {response.status_code}"

    return result


# Models that must be called via /v1/responses: they reject function tools
# with reasoning on /v1/chat/completions. The proxy keeps the Chat Completions
# request/response shape at its boundary and translates internally.
_RESPONSES_API_MODEL_PREFIXES = ("gpt-6",)


def _uses_responses_api(model: str) -> bool:
    return model.startswith(_RESPONSES_API_MODEL_PREFIXES)


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return json.dumps(content)


def _convert_user_content(content: Any) -> Any:
    if not isinstance(content, list):
        return _content_to_text(content)
    parts: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            parts.append({"type": "input_text", "text": str(part)})
        elif part.get("type") == "text":
            parts.append({"type": "input_text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            image = part.get("image_url")
            url = image.get("url") if isinstance(image, dict) else image
            item: dict[str, Any] = {"type": "input_image", "image_url": url}
            if isinstance(image, dict) and image.get("detail"):
                item["detail"] = image["detail"]
            parts.append(item)
        else:
            parts.append(part)
    return parts


def _messages_to_responses_input(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role")
        if role in ("system", "developer"):
            items.append({"role": role, "content": _content_to_text(msg.get("content"))})
        elif role == "user":
            items.append({"role": "user", "content": _convert_user_content(msg.get("content"))})
        elif role == "assistant":
            text = _content_to_text(msg.get("content"))
            if text:
                items.append({"role": "assistant", "content": text})
            for call in msg.get("tool_calls") or []:
                fn = call.get("function") or {}
                arguments = fn.get("arguments", "{}")
                if not isinstance(arguments, str):
                    arguments = json.dumps(arguments)
                items.append(
                    {
                        "type": "function_call",
                        "call_id": call.get("id"),
                        "name": fn.get("name"),
                        "arguments": arguments,
                    }
                )
        elif role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": msg.get("tool_call_id"),
                    "output": _content_to_text(msg.get("content")),
                }
            )
    return items


def _tools_to_responses(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    converted = []
    for tool in tools:
        fn = tool.get("function") if tool.get("type") == "function" else None
        if fn is None:
            converted.append(tool)
            continue
        item: dict[str, Any] = {
            "type": "function",
            "name": fn.get("name"),
            "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
            # Responses API defaults to strict schemas; our tool schemas aren't
            # written for strict mode, so keep Chat Completions semantics.
            "strict": bool(fn.get("strict", False)),
        }
        if fn.get("description"):
            item["description"] = fn["description"]
        converted.append(item)
    return converted


def _tool_choice_to_responses(tool_choice: Any) -> Any:
    if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
        name = (tool_choice.get("function") or {}).get("name") or tool_choice.get("name")
        return {"type": "function", "name": name}
    return tool_choice


def _responses_to_chat_completion(response: Any) -> dict[str, Any]:
    data = json.loads(response.model_dump_json())
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for item in data.get("output") or []:
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if part.get("type") == "output_text":
                    text_parts.append(part.get("text", ""))
                elif part.get("type") == "refusal":
                    text_parts.append(part.get("refusal", ""))
        elif item.get("type") == "function_call":
            tool_calls.append(
                {
                    "id": item.get("call_id"),
                    "type": "function",
                    "function": {
                        "name": item.get("name"),
                        "arguments": item.get("arguments", "{}"),
                    },
                }
            )

    message: dict[str, Any] = {"role": "assistant", "content": "".join(text_parts)}
    if tool_calls:
        message["tool_calls"] = tool_calls
        if not message["content"]:
            message["content"] = None
        finish_reason = "tool_calls"
    elif data.get("status") == "incomplete":
        finish_reason = "length"
    else:
        finish_reason = "stop"

    usage = data.get("usage") or {}
    return {
        "id": data.get("id"),
        "object": "chat.completion",
        "created": int(data.get("created_at") or 0),
        "model": data.get("model"),
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
    }


async def _responses_completion(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    tool_choice: dict[str, Any] | str | None,
    model: str,
) -> dict[str, Any]:
    assert _client is not None
    kwargs: dict[str, Any] = {
        "model": model,
        "input": _messages_to_responses_input(messages),
        "store": False,
    }
    if tools:
        kwargs["tools"] = _tools_to_responses(tools)
        if tool_choice:
            kwargs["tool_choice"] = _tool_choice_to_responses(tool_choice)
    response = await _client.responses.create(**kwargs)
    return _responses_to_chat_completion(response)


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
        if _uses_responses_api(model):
            return await _responses_completion(messages, tools, tool_choice, model)

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
