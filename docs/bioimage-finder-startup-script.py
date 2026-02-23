import json
from typing import Any, Dict, List
from urllib.parse import quote

import httpx

try:
    import js  # type: ignore
except Exception:
    js = None


BASE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts"
BASE_IMAGE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts/image"


def _build_url(base_url: str, query: str) -> str:
    encoded = quote(query, safe='"()[]{}:*?+-/\\')
    return f"{base_url}?query={encoded}"


def _extract_hits_and_total(payload: Dict[str, Any] | Any) -> tuple[List[Dict[str, Any]], int]:
    if not isinstance(payload, dict):
        return [], 0

    hits_value = payload.get("hits", [])
    if isinstance(hits_value, list):
        return hits_value, len(hits_value)

    if isinstance(hits_value, dict):
        hits_list = hits_value.get("hits", [])
        if not isinstance(hits_list, list):
            hits_list = []
        total_obj = hits_value.get("total", {}) if isinstance(hits_value.get("total"), dict) else {}
        total = total_obj.get("value") if isinstance(total_obj, dict) else None
        if not isinstance(total, int):
            total = len(hits_list)
        return hits_list, total

    return [], 0


def _first_nonempty_string(values: List[Any]) -> str | None:
    for value in values:
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
    return None


def _metadata_value(source_payload: Dict[str, Any], metadata_name: str) -> Dict[str, Any] | None:
    metadata_entries = source_payload.get("additional_metadata")
    if not isinstance(metadata_entries, list):
        return None
    for entry in metadata_entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("name") != metadata_name:
            continue
        value_payload = entry.get("value")
        if isinstance(value_payload, dict):
            return value_payload
    return None


def _dataset_result_from_hit(item: Dict[str, Any]) -> Dict[str, Any]:
    source_payload = item.get("_source") if isinstance(item.get("_source"), dict) else item

    accession = _first_nonempty_string(
        [
            source_payload.get("accession_id"),
            source_payload.get("accession"),
            source_payload.get("id"),
            item.get("_id"),
        ]
    )
    title = _first_nonempty_string(
        [
            source_payload.get("title"),
            source_payload.get("name"),
            source_payload.get("dataset"),
            accession,
            source_payload.get("uuid"),
            item.get("_id"),
        ]
    ) or "Untitled"

    return {
        "title": title,
        "accession": accession or "",
        "url": (
            f"https://beta.bioimagearchive.org/bioimage-archive/study/{accession}"
            if accession
            else None
        ),
        "uuid": source_payload.get("uuid") if isinstance(source_payload.get("uuid"), str) else None,
        "description": source_payload.get("description") if isinstance(source_payload.get("description"), str) else None,
        "doi": source_payload.get("doi") if isinstance(source_payload.get("doi"), str) else None,
        "release_date": source_payload.get("release_date") if isinstance(source_payload.get("release_date"), str) else None,
        "score": item.get("_score"),
    }


def _image_result_from_hit(item: Dict[str, Any]) -> Dict[str, Any]:
    source_payload = item.get("_source") if isinstance(item.get("_source"), dict) else item
    file_pattern_payload = _metadata_value(source_payload, "file_pattern")
    file_pattern = file_pattern_payload.get("file_pattern") if isinstance(file_pattern_payload, dict) else None

    creation_process = source_payload.get("creation_process") if isinstance(source_payload.get("creation_process"), dict) else {}
    acquisition_process = creation_process.get("acquisition_process") if isinstance(creation_process.get("acquisition_process"), list) else []
    first_acquisition = acquisition_process[0] if acquisition_process and isinstance(acquisition_process[0], dict) else {}
    acquisition_title = first_acquisition.get("title") if isinstance(first_acquisition.get("title"), str) else None

    accession = _first_nonempty_string(
        [
            source_payload.get("accession_id"),
            source_payload.get("accession"),
            source_payload.get("study_accession"),
        ]
    )
    image_id = _first_nonempty_string([source_payload.get("uuid"), item.get("_id")]) or ""
    title = _first_nonempty_string(
        [
            source_payload.get("title"),
            source_payload.get("name"),
            source_payload.get("label"),
            file_pattern if isinstance(file_pattern, str) else None,
            acquisition_title,
            image_id,
        ]
    ) or "Untitled"

    return {
        "id": image_id,
        "accession": accession or "",
        "title": title,
        "study_url": (
            f"https://beta.bioimagearchive.org/bioimage-archive/study/{accession}"
            if accession
            else None
        ),
        "dataset_uuid": (
            source_payload.get("submission_dataset_uuid")
            if isinstance(source_payload.get("submission_dataset_uuid"), str)
            else None
        ),
        "file_pattern": file_pattern if isinstance(file_pattern, str) else None,
        "acquisition_title": acquisition_title,
        "score": item.get("_score"),
    }


async def _search_via_proxy(kind: str, query: str, limit: int) -> Dict[str, Any] | None:
    if js is None:
        return None
    try:
        bridge = getattr(js.globalThis, "bioimage_archive_search", None)
    except Exception:
        return None

    if not bridge:
        return None

    try:
        result = await bridge(kind, query, int(limit))
        if hasattr(result, "to_py"):
            result = result.to_py()
        if isinstance(result, str):
            parsed = json.loads(result)
            if isinstance(parsed, dict):
                return parsed
            return {"error": "Proxy returned non-dict response"}
        if isinstance(result, dict):
            return result
        return {"error": "Proxy returned unsupported response type"}
    except Exception as exp:
        return {"error": f"Proxy search failed: {exp}"}

    return None


async def search_datasets(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive datasets by full-text query.

    Args:
        query: User search text, supports boolean operators (AND/OR/NOT), quotes, wildcards.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    proxied = await _search_via_proxy("datasets", query, limit)
    if isinstance(proxied, dict):
        if "error" in proxied:
            raise RuntimeError(proxied["error"])
        return proxied

    url = _build_url(BASE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    hits, total = _extract_hits_and_total(payload)
    top_hits: List[Dict[str, Any]] = []

    for item in hits[: max(1, limit)]:
        if isinstance(item, dict):
            top_hits.append(_dataset_result_from_hit(item))

    return {
        "query": query,
        "url": url,
        "total": total,
        "results": top_hits,
    }


async def search_images(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive images endpoint by full-text query.

    Args:
        query: User search text for image-level index.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    proxied = await _search_via_proxy("images", query, limit)
    if isinstance(proxied, dict):
        if "error" in proxied:
            raise RuntimeError(proxied["error"])
        return proxied

    url = _build_url(BASE_IMAGE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    hits, total = _extract_hits_and_total(payload)
    top_hits: List[Dict[str, Any]] = []

    for item in hits[: max(1, limit)]:
        if isinstance(item, dict):
            top_hits.append(_image_result_from_hit(item))

    return {
        "query": query,
        "url": url,
        "total": total,
        "results": top_hits,
    }


def explain_advanced_query_syntax() -> str:
    """
    Return a concise guide for advanced BioImage Archive query syntax.

    Returns:
        Human-readable syntax instructions with examples.
    """
    return (
        "Advanced search syntax:\n"
        "- Words are case-insensitive.\n"
        "- Default behavior is OR across terms.\n"
        "- Use AND / OR / NOT and parentheses for boolean logic.\n"
        "- Use quoted phrases for exact matching.\n"
        "- Wildcards: * for any sequence, ? for a single character.\n"
        "Examples:\n"
        "1) confocal fluorescence microscopy\n"
        "2) confocal AND fluorescence AND microscopy\n"
        '3) "confocal fluorescence microscopy"\n'
        "4) microscopy AND (fluorescence OR confocal)\n"
        "5) microscopy AND NOT (fluorescence OR confocal)\n"
    )


print(
    """
You are the RI-SCALE BioImage Finder.

You can call these utility functions directly:
- search_datasets(query: str, limit: int = 10)
- search_images(query: str, limit: int = 10)
- explain_advanced_query_syntax()

Use tools first whenever a user asks for archive results.
Then provide a concise human summary with links/accessions.
If one query returns no results, try one or two query rewrites before concluding.
"""
)
