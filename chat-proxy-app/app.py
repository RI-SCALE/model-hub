import json
import logging
import os
from typing import Any

from hypha_rpc import api
from openai import AsyncOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_client: AsyncOpenAI | None = None


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

    _client = AsyncOpenAI(api_key=key, timeout=600.0, max_retries=2)
    logger.info("OpenAI client initialized")
    return {"ok": True}


async def chat_completion(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | str | None = None,
    model: str = "gpt-4-turbo-preview",
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
        kwargs["timeout"] = 600.0

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
    }
)
