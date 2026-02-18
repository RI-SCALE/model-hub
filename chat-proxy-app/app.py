import json
import logging
import os
import asyncio
from urllib.parse import quote
from urllib.request import urlopen
from typing import Any

from hypha_rpc import api
from openai import AsyncOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_client: AsyncOpenAI | None = None
BASE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts"
BASE_IMAGE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts/image"


def _build_archive_url(base_url: str, query: str) -> str:
    encoded = quote(query, safe='"()[]{}:*?+-/\\')
    return f"{base_url}?query={encoded}"


def _fetch_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {}


async def _fetch_json_with_retries(
    url: str,
    *,
    attempts: int = 3,
    retry_delay_seconds: float = 1.0,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await asyncio.to_thread(_fetch_json, url)
        except Exception as exp:
            last_error = exp
            logger.warning(
                "Archive fetch failed for %s (attempt %s/%s): %s",
                url,
                attempt,
                attempts,
                exp,
            )
            if attempt < attempts:
                await asyncio.sleep(retry_delay_seconds * attempt)

    raise RuntimeError(
        f"BioImage Archive request failed after {attempts} attempts: {last_error}"
    )


async def search_datasets(
    query: str,
    limit: int = 10,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = _build_archive_url(BASE_SEARCH_URL, query)
    payload = await _fetch_json_with_retries(url)
    hits = payload.get("hits", []) if isinstance(payload, dict) else []
    top_hits: list[dict[str, Any]] = []

    for item in hits[: max(1, int(limit))]:
        title = item.get("title") or item.get("name") or item.get("accession") or "Untitled"
        accession = item.get("accession") or item.get("id") or ""
        top_hits.append(
            {
                "title": title,
                "accession": accession,
                "url": f"https://www.ebi.ac.uk/bioimage-archive/{accession}" if accession else None,
            }
        )

    return {
        "query": query,
        "url": url,
        "total": len(hits),
        "results": top_hits,
    }


async def search_images(
    query: str,
    limit: int = 10,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = _build_archive_url(BASE_IMAGE_SEARCH_URL, query)
    payload = await _fetch_json_with_retries(url)
    hits = payload.get("hits", []) if isinstance(payload, dict) else []
    top_hits: list[dict[str, Any]] = []

    for item in hits[: max(1, int(limit))]:
        image_id = item.get("id") or item.get("_id") or ""
        accession = item.get("accession") or item.get("study_accession") or ""
        top_hits.append(
            {
                "id": image_id,
                "accession": accession,
                "title": item.get("title") or item.get("name") or image_id,
            }
        )

    return {
        "query": query,
        "url": url,
        "total": len(hits),
        "results": top_hits,
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
        "search_datasets": search_datasets,
        "search_images": search_images,
    }
)
