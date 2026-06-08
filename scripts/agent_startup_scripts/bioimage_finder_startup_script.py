import micropip
import importlib.util

_to_install = []
if not importlib.util.find_spec("hypha_rpc"):
    _to_install.append("hypha-rpc")
if not importlib.util.find_spec("PIL"):
    _to_install.append("pillow")
if not importlib.util.find_spec("numcodecs"):
    _to_install.append("numcodecs")
if _to_install:
    await micropip.install(_to_install)

import json
import re
from typing import Any, Dict, List
from urllib.parse import quote

import httpx

try:
    import js  # type: ignore
except Exception:
    js = None


BASE_SEARCH_URL = "https://beta.bioimagearchive.org/search/v1/search/fts"
BASE_IMAGE_SEARCH_URL = "https://beta.bioimagearchive.org/search/v1/search/fts/image"
STOPWORDS = {
    "and",
    "or",
    "not",
    "the",
    "a",
    "an",
    "of",
    "for",
    "with",
    "in",
    "on",
    "to",
    "please",
    "give",
    "me",
    "find",
    "show",
    "get",
    "dataset",
    "datasets",
}

DATASET_TITLE_MAX_LEN = 220
DATASET_DESCRIPTION_MAX_LEN = 480
IMAGE_TITLE_MAX_LEN = 220
IMAGE_FILE_PATTERN_MAX_LEN = 260


def _short_text(value: Any, max_len: int = 180) -> str:
    text = str(value) if value is not None else ""
    return text if len(text) <= max_len else (text[: max_len - 3] + "...")


def _build_url(base_url: str, query: str) -> str:
    encoded = quote(query, safe='"()[]{}:*?+-/\\')
    return f"{base_url}?query={encoded}"


def _query_terms(query: str) -> List[str]:
    terms: List[str] = []
    for token in re.findall(r"[A-Za-z0-9]+", query.lower()):
        if len(token) < 3:
            continue
        if token in STOPWORDS:
            continue
        if token not in terms:
            terms.append(token)
    return terms


def _dataset_relevance_score(item: Dict[str, Any], query_terms: List[str]) -> float:
    title = item.get("title") if isinstance(item.get("title"), str) else ""
    description = (
        item.get("description") if isinstance(item.get("description"), str) else ""
    )
    accession = item.get("accession") if isinstance(item.get("accession"), str) else ""

    title_lower = title.lower()
    description_lower = description.lower()
    accession_lower = accession.lower()

    score = 0.0
    term_hits = 0
    for term in query_terms:
        term_re = re.compile(rf"\\b{re.escape(term)}\\b", re.IGNORECASE)
        in_title = bool(term_re.search(title_lower))
        in_desc = bool(term_re.search(description_lower))
        if in_title:
            score += 6.0
            term_hits += 1
        elif term in title_lower:
            score += 3.5
            term_hits += 1

        if in_desc:
            score += 3.0
            term_hits += 1
        elif term in description_lower:
            score += 1.0
            term_hits += 1

        if term in accession_lower:
            score += 0.5

    if query_terms and term_hits >= max(2, len(query_terms)):
        score += 2.0

    api_score = item.get("score")
    if isinstance(api_score, (int, float)):
        score += min(float(api_score), 20.0) / 20.0

    return score


def _rerank_dataset_results(
    items: List[Dict[str, Any]], query: str
) -> List[Dict[str, Any]]:
    terms = _query_terms(query)
    if not terms:
        return items
    ranked: List[tuple[float, Dict[str, Any]]] = []
    for item in items:
        ranked.append((_dataset_relevance_score(item, terms), item))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in ranked]


def _has_strong_match(items: List[Dict[str, Any]], query: str) -> bool:
    terms = _query_terms(query)
    if not terms:
        return True
    for item in items:
        if _dataset_relevance_score(item, terms) >= 6.0:
            return True
    return False


def _merge_unique_dataset_results(
    primary: List[Dict[str, Any]],
    secondary: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()

    def _result_key(entry: Dict[str, Any]) -> str:
        accession = entry.get("accession")
        if isinstance(accession, str) and accession.strip():
            return f"acc:{accession.strip().lower()}"
        url = entry.get("url")
        if isinstance(url, str) and url.strip():
            return f"url:{url.strip().lower()}"
        title = entry.get("title")
        if isinstance(title, str) and title.strip():
            return f"title:{title.strip().lower()}"
        return f"obj:{id(entry)}"

    for candidate in [*primary, *secondary]:
        key = _result_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        merged.append(candidate)

    return merged


def _extract_hits_and_total(
    payload: Dict[str, Any] | Any,
) -> tuple[List[Dict[str, Any]], int]:
    if not isinstance(payload, dict):
        return [], 0

    hits_value = payload.get("hits", [])
    if isinstance(hits_value, list):
        return hits_value, len(hits_value)

    if isinstance(hits_value, dict):
        hits_list = hits_value.get("hits", [])
        if not isinstance(hits_list, list):
            hits_list = []
        total_obj = (
            hits_value.get("total", {})
            if isinstance(hits_value.get("total"), dict)
            else {}
        )
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


def _metadata_value(
    source_payload: Dict[str, Any], metadata_name: str
) -> Dict[str, Any] | None:
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
    source_payload = (
        item.get("_source") if isinstance(item.get("_source"), dict) else item
    )

    accession = _first_nonempty_string(
        [
            source_payload.get("accession_id"),
            source_payload.get("accession"),
            source_payload.get("id"),
            item.get("_id"),
        ]
    )
    title = (
        _first_nonempty_string(
            [
                source_payload.get("title"),
                source_payload.get("name"),
                source_payload.get("dataset"),
                accession,
                source_payload.get("uuid"),
                item.get("_id"),
            ]
        )
        or "Untitled"
    )
    description_value = (
        source_payload.get("description")
        if isinstance(source_payload.get("description"), str)
        else None
    )

    # example_image_uri is no longer populated by BIA; fall back to zarr URL
    thumbnail_url = None
    for ds in source_payload.get("dataset", []):
        if not isinstance(ds, dict):
            continue
        uris = ds.get("example_image_uri", [])
        if isinstance(uris, list) and uris and isinstance(uris[0], str):
            thumbnail_url = uris[0]
            break
        # BIA now serves OME-Zarr — find the zarr file_uri from representations
        for rep in ds.get("representation", []):
            if not isinstance(rep, dict):
                continue
            if "zarr" in rep.get("image_format", ""):
                file_uris = rep.get("file_uri", [])
                if isinstance(file_uris, list) and file_uris:
                    thumbnail_url = file_uris[0]
                    break
        if thumbnail_url:
            break

    return {
        "title": _short_text(title, DATASET_TITLE_MAX_LEN),
        "accession": accession or "",
        "url": (
            f"https://beta.bioimagearchive.org/bioimage-archive/study/{accession}"
            if accession
            else None
        ),
        "description": (
            _short_text(description_value, DATASET_DESCRIPTION_MAX_LEN)
            if isinstance(description_value, str)
            else None
        ),
        "doi": (
            source_payload.get("doi")
            if isinstance(source_payload.get("doi"), str)
            else None
        ),
        "release_date": (
            source_payload.get("release_date")
            if isinstance(source_payload.get("release_date"), str)
            else None
        ),
        "thumbnail_url": thumbnail_url,
        "score": item.get("_score"),
    }


def _compact_dataset_result(item: Dict[str, Any]) -> Dict[str, Any]:
    score_value = item.get("score")
    score = score_value if isinstance(score_value, (int, float)) else None
    compact: Dict[str, Any] = {
        "title": _short_text(item.get("title", "Untitled"), DATASET_TITLE_MAX_LEN),
        "accession": (
            item.get("accession") if isinstance(item.get("accession"), str) else ""
        ),
        "url": item.get("url") if isinstance(item.get("url"), str) else None,
        "description": (
            _short_text(item.get("description"), DATASET_DESCRIPTION_MAX_LEN)
            if isinstance(item.get("description"), str)
            else None
        ),
        "doi": item.get("doi") if isinstance(item.get("doi"), str) else None,
        "release_date": (
            item.get("release_date")
            if isinstance(item.get("release_date"), str)
            else None
        ),
        "thumbnail_url": (
            item.get("thumbnail_url")
            if isinstance(item.get("thumbnail_url"), str)
            else None
        ),
        "score": score,
    }
    return compact


def _image_result_from_hit(item: Dict[str, Any]) -> Dict[str, Any]:
    source_payload = (
        item.get("_source") if isinstance(item.get("_source"), dict) else item
    )
    file_pattern_payload = _metadata_value(source_payload, "file_pattern")
    file_pattern = (
        file_pattern_payload.get("file_pattern")
        if isinstance(file_pattern_payload, dict)
        else None
    )

    creation_process = (
        source_payload.get("creation_process")
        if isinstance(source_payload.get("creation_process"), dict)
        else {}
    )
    acquisition_process = (
        creation_process.get("acquisition_process")
        if isinstance(creation_process.get("acquisition_process"), list)
        else []
    )
    first_acquisition = (
        acquisition_process[0]
        if acquisition_process and isinstance(acquisition_process[0], dict)
        else {}
    )
    acquisition_title = (
        first_acquisition.get("title")
        if isinstance(first_acquisition.get("title"), str)
        else None
    )

    accession = _first_nonempty_string(
        [
            source_payload.get("accession_id"),
            source_payload.get("accession"),
            source_payload.get("study_accession"),
        ]
    )
    image_id = (
        _first_nonempty_string([source_payload.get("uuid"), item.get("_id")]) or ""
    )
    title = (
        _first_nonempty_string(
            [
                source_payload.get("title"),
                source_payload.get("name"),
                source_payload.get("label"),
                file_pattern if isinstance(file_pattern, str) else None,
                acquisition_title,
                image_id,
            ]
        )
        or "Untitled"
    )

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


def _compact_image_result(item: Dict[str, Any]) -> Dict[str, Any]:
    score_value = item.get("score")
    score = score_value if isinstance(score_value, (int, float)) else None
    return {
        "title": _short_text(item.get("title", "Untitled"), IMAGE_TITLE_MAX_LEN),
        "id": item.get("id") if isinstance(item.get("id"), str) else "",
        "accession": (
            item.get("accession") if isinstance(item.get("accession"), str) else ""
        ),
        "study_url": (
            item.get("study_url") if isinstance(item.get("study_url"), str) else None
        ),
        "file_pattern": (
            _short_text(item.get("file_pattern"), IMAGE_FILE_PATTERN_MAX_LEN)
            if isinstance(item.get("file_pattern"), str)
            else None
        ),
        "score": score,
    }


def _format_dataset_assistant_summary(
    payload: Dict[str, Any], max_items: int = 5
) -> str:
    results = payload.get("results")
    result_list = results if isinstance(results, list) else []
    if not result_list:
        query = payload.get("query") if isinstance(payload.get("query"), str) else ""
        return (
            f"No dataset results were found for query '{query}'. "
            "The BioImage Archive beta index may be incomplete/intermittent."
        )

    lines = [f"Here are up to {max_items} BioImage Archive dataset matches:"]
    for idx, entry in enumerate(result_list[:max_items], start=1):
        if not isinstance(entry, dict):
            continue
        title = (
            entry.get("title") if isinstance(entry.get("title"), str) else "Untitled"
        )
        accession = (
            entry.get("accession") if isinstance(entry.get("accession"), str) else ""
        )
        url = entry.get("url") if isinstance(entry.get("url"), str) else None
        score = entry.get("score")
        score_part = f" (score {score:.2f})" if isinstance(score, (int, float)) else ""
        if accession and url:
            lines.append(f"{idx}. {title} [{accession}] - {url}{score_part}")
        elif accession:
            lines.append(f"{idx}. {title} [{accession}]{score_part}")
        elif url:
            lines.append(f"{idx}. {title} - {url}{score_part}")
        else:
            lines.append(f"{idx}. {title}{score_part}")

    total = payload.get("total")
    if isinstance(total, int):
        lines.append(f"(Total hits reported by API: {total})")
    lines.append("")
    lines.append(
        "Note: BioImage Archive beta search can be incomplete or intermittent."
    )
    return "\n".join(lines)


def _normalize_search_payload(
    kind: str,
    query: str,
    limit: int,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    safe_limit = max(1, int(limit))
    result_limit = min(max(1, safe_limit), 8)

    raw_results = payload.get("results")
    result_items = raw_results if isinstance(raw_results, list) else []

    compact_results: List[Dict[str, Any]] = []
    ranked_items = result_items
    if kind == "datasets":
        ranked_items = _rerank_dataset_results(result_items, query)
    for entry in ranked_items[:result_limit]:
        if not isinstance(entry, dict):
            continue
        if kind == "datasets":
            compact_results.append(_compact_dataset_result(entry))
        else:
            compact_results.append(_compact_image_result(entry))

    total_value = payload.get("total")
    total = total_value if isinstance(total_value, int) else len(compact_results)

    payload_url = payload.get("url")
    if isinstance(payload_url, str) and payload_url.strip():
        url = payload_url
    else:
        base_url = BASE_SEARCH_URL if kind == "datasets" else BASE_IMAGE_SEARCH_URL
        url = _build_url(base_url, query)

    normalized: Dict[str, Any] = {
        "query": query,
        "url": url,
        "total": total,
        "results": compact_results,
    }

    return normalized


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


def _fallback_terms_from_query(query: str) -> List[str]:
    terms: List[str] = []
    for part in re.split(r"\bAND\b|\bOR\b", query, flags=re.IGNORECASE):
        candidate = part.strip().strip("\"'()[]{}")
        if len(candidate) < 2:
            continue
        if candidate.lower() in {"and", "or", "not"}:
            continue
        if candidate not in terms:
            terms.append(candidate)
    return terms


def _fallback_candidate_terms(query: str) -> List[str]:
    candidates: List[str] = []
    for term in _fallback_terms_from_query(query):
        if term not in candidates:
            candidates.append(term)
    for term in _query_terms(query):
        if term not in candidates:
            candidates.append(term)
    return candidates


async def _search_datasets_once(query: str, safe_limit: int) -> Dict[str, Any]:
    fetch_limit = min(60, max(20, safe_limit * 6))
    proxied = await _search_via_proxy("datasets", query, fetch_limit)
    if isinstance(proxied, dict):
        if "error" in proxied:
            raise RuntimeError(proxied["error"])
        return _normalize_search_payload("datasets", query, safe_limit, proxied)

    url = _build_url(BASE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    hits, total = _extract_hits_and_total(payload)
    top_hits: List[Dict[str, Any]] = []

    for item in hits[:fetch_limit]:
        if isinstance(item, dict):
            top_hits.append(_dataset_result_from_hit(item))

    raw_payload = {
        "query": query,
        "url": url,
        "total": total,
        "results": top_hits,
    }
    return _normalize_search_payload("datasets", query, safe_limit, raw_payload)


async def search_datasets(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive datasets by full-text query.

    Args:
        query: User search text, supports boolean operators (AND/OR/NOT), quotes, wildcards.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    safe_limit = max(1, int(limit))
    print(f"DEBUG: search_datasets primary query='{query}' limit={safe_limit}")
    primary_result = await _search_datasets_once(query, safe_limit)
    if (
        isinstance(primary_result.get("total"), int)
        and primary_result.get("total", 0) > 0
    ):
        primary_items = primary_result.get("results")
        primary_list = primary_items if isinstance(primary_items, list) else []
        print(
            f"DEBUG: search_datasets primary query returned total={primary_result.get('total', 0)}"
        )
        if not _has_strong_match(primary_list, query) and len(_query_terms(query)) >= 2:
            for term in _fallback_candidate_terms(query)[:4]:
                print(
                    f"DEBUG: search_datasets enrichment query='{term}' after weak relevance in primary query='{query}'"
                )
                enrichment_result = await _search_datasets_once(term, safe_limit)
                enrichment_items = enrichment_result.get("results")
                enrichment_list = (
                    enrichment_items if isinstance(enrichment_items, list) else []
                )
                merged_results = _merge_unique_dataset_results(
                    primary_list, enrichment_list
                )
                reranked = _rerank_dataset_results(merged_results, query)
                primary_result["results"] = reranked[: min(8, safe_limit)]
                if _has_strong_match(primary_result["results"], query):
                    primary_result["enriched_with_query"] = term
                    break
        return primary_result

    fallback_candidates = _fallback_candidate_terms(query)
    if len(fallback_candidates) >= 1:
        merged_results: List[Dict[str, Any]] = []
        fallback_terms_used: List[str] = []
        for term in fallback_candidates[:4]:
            print(
                f"DEBUG: search_datasets fallback query='{term}' after empty primary query='{query}'"
            )
            fallback_result = await _search_datasets_once(term, safe_limit)
            fallback_items = fallback_result.get("results")
            fallback_list = fallback_items if isinstance(fallback_items, list) else []
            if fallback_list:
                merged_results = _merge_unique_dataset_results(
                    merged_results, fallback_list
                )
                fallback_terms_used.append(term)
                print(
                    f"DEBUG: search_datasets fallback query returned total={fallback_result.get('total', 0)}"
                )

        if merged_results:
            reranked = _rerank_dataset_results(merged_results, query)
            aggregated: Dict[str, Any] = {
                "query": query,
                "url": _build_url(BASE_SEARCH_URL, query),
                "total": len(merged_results),
                "results": reranked[: min(8, safe_limit)],
                "fallback_from_query": query,
                "fallback_terms_used": fallback_terms_used,
            }
            return aggregated

    print(f"DEBUG: search_datasets no results for query='{query}'")
    return primary_result


async def search_images(
    query: str,
    limit: int = 10,
    scientific_name: str | None = None,
    imaging_method: str | None = None,
) -> Dict[str, Any]:
    """
    Search BioImage Archive images endpoint by full-text query with optional filters.

    Args:
        query: User search text for image-level index.
        limit: Maximum number of hits to return in the summarized output.
        scientific_name: Filter by organism scientific name, e.g. "drosophila melanogaster",
            "homo sapiens", "mus musculus". Case-insensitive.
        imaging_method: Filter by imaging modality, e.g. "confocal microscopy",
            "fluorescence microscopy", "bright-field microscopy". Case-insensitive.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    safe_limit = max(1, int(limit))
    proxied = await _search_via_proxy("images", query, safe_limit)
    if isinstance(proxied, dict):
        if "error" in proxied:
            raise RuntimeError(proxied["error"])
        return _normalize_search_payload("images", query, safe_limit, proxied)

    params: Dict[str, Any] = {"query": quote(query, safe='"()[]{}:*?+-/\\')}
    if scientific_name:
        params["scientific_name"] = scientific_name
    if imaging_method:
        params["imaging_method"] = imaging_method
    param_str = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params.items())
    url = f"{BASE_IMAGE_SEARCH_URL}?{param_str}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    hits, total = _extract_hits_and_total(payload)

    # Extract available facet values to help with follow-up queries
    facets = payload.get("facets", {})
    available_organisms = [
        b["key"] for b in facets.get("scientific_name", {}).get("buckets", [])[:10]
    ]
    available_methods = [
        b["key"] for b in facets.get("imaging_method", {}).get("buckets", [])[:10]
    ]

    top_hits: List[Dict[str, Any]] = []
    for item in hits[: max(1, safe_limit)]:
        if isinstance(item, dict):
            top_hits.append(_image_result_from_hit(item))

    raw_payload = {
        "query": query,
        "url": url,
        "total": total,
        "results": top_hits,
        "available_organisms": available_organisms,
        "available_imaging_methods": available_methods,
    }
    return _normalize_search_payload("images", query, safe_limit, raw_payload)


async def search_models(task: str, limit: int = 5) -> Dict[str, Any]:
    """
    Search the RI-SCALE AI Model Hub for models matching a given task.

    Args:
        task: Task description, e.g. 'cell segmentation', 'nuclei detection', 'cancer classification'
        limit: Maximum number of results to return.

    Returns:
        Dictionary with 'results' (list of id, name, tags, description) and 'total' count.
    """
    url = "https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url, params={"limit": 100})
        r.raise_for_status()
        data = r.json()
        items = data.get("items", data) if isinstance(data, dict) else data

    keywords = [w.lower() for w in task.split() if len(w) > 2]
    matches = []
    for item in items:
        m = item.get("manifest", {})
        tags = [t.lower() for t in m.get("tags", [])]
        name = m.get("name", "").lower()
        desc = m.get("description", "").lower()
        if any(kw in tags or kw in name or kw in desc for kw in keywords):
            matches.append({
                "id": item.get("id", ""),
                "name": m.get("name", ""),
                "tags": m.get("tags", []),
                "description": _short_text(m.get("description", ""), 120),
            })

    return {"results": matches[:limit], "total": len(matches)}


async def run_cellpose_on_image(image_url: str) -> str:
    """
    Run Cellpose-SAM cell segmentation on an image from a URL and return
    a segmentation overlay rendered as an inline Markdown image.

    Args:
        image_url: Direct URL to an image. Use the thumbnail_url field from
            search_datasets() or search_images() results.

    Returns:
        Markdown string with cell count and an inline base64 segmentation overlay image.
    """
    import io
    import base64
    import numpy as np
    from PIL import Image
    from hypha_rpc import connect_to_server

    # 1. Connect to Hypha and get chat proxy (all external requests go through it — CORS)
    server = await connect_to_server({"server_url": "https://hypha.aicell.io"})
    proxy = await server.get_service("ri-scale/default@chat-proxy")

    async def _proxy_get_json(url):
        import json as _json
        r = await proxy.resolve_url(url=url)
        if not r.get("ok"):
            raise RuntimeError(f"Proxy fetch failed for {url}: {r.get('error')}")
        if r.get("json"):
            return r["json"]
        if r.get("text"):
            return _json.loads(r["text"])
        if r.get("base64"):
            return _json.loads(base64.b64decode(r["base64"]).decode())
        raise RuntimeError(f"Empty proxy response for {url}")

    async def _proxy_get_bytes(url):
        r = await proxy.resolve_url(url=url)
        if not r.get("ok"):
            raise RuntimeError(f"Proxy fetch failed for {url}: {r.get('error')}")
        return base64.b64decode(r["base64"])

    # 2. Fetch image — OME-Zarr or direct image URL (all via proxy to bypass CORS)
    if ".zarr" in image_url or ".ome.zarr" in image_url:
        _base = image_url.rstrip("/")
        _attrs = await _proxy_get_json(f"{_base}/.zattrs")
        _datasets = _attrs["multiscales"][0]["datasets"]
        _low = _datasets[-1]["path"]
        _zmeta = await _proxy_get_json(f"{_base}/{_low}/.zarray")
        _shape = _zmeta["shape"]   # (T, C, Z, Y, X)
        _dtype = np.dtype(_zmeta["dtype"])
        _h, _w = _shape[-2], _shape[-1]
        _compressor = _zmeta.get("compressor")
        _sep = _zmeta.get("dimension_separator", "/")

        async def _fetch_chunk(c_idx):
            # Build chunk indices: T=0, C=c_idx, Z=0, Y=0, X=0
            idx = _sep.join(["0", str(c_idx), "0", "0", "0"])
            _url = f"{_base}/{_low}/{idx}"
            _raw = await _proxy_get_bytes(_url)
            # Decompress
            if _compressor:
                import numcodecs
                _codec = numcodecs.get_codec(_compressor)
                _raw = _codec.decode(_raw)
            elif len(_raw) != _h * _w * _dtype.itemsize:
                import zlib as _zlib
                try: _raw = _zlib.decompress(_raw)
                except Exception: pass
            return np.frombuffer(bytes(_raw), dtype=_dtype).reshape(_h, _w)

        _channels = [await _fetch_chunk(_c) for _c in range(min(_shape[1], 3))]
        _hwc = np.stack(_channels * (3 // len(_channels) + 1), axis=-1)[:, :, :3]
        if _dtype != np.uint8:
            _mn, _mx = float(_hwc.min()), float(_hwc.max())
            _hwc = ((_hwc - _mn) / max(_mx - _mn, 1) * 255).astype(np.uint8)
        img = Image.fromarray(_hwc.astype(np.uint8))
    else:
        fetch_result = await proxy.resolve_url(url=image_url)
        if not fetch_result.get("ok") or not fetch_result.get("base64"):
            raise RuntimeError(f"Could not fetch image via proxy: {fetch_result.get('error', 'unknown error')}")
        img = Image.open(io.BytesIO(base64.b64decode(fetch_result["base64"]))).convert("RGB")

    # Cap at 256px — keeps each JPEG under 12KB so two images fit in the stdout buffer
    w, h = img.size
    if max(w, h) > 256:
        scale = 256 / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    # 6. Convert to (C, H, W) numpy array and check image quality
    arr = np.array(img)
    gray = arr.mean(axis=2)
    contrast = float(gray.std())
    bright_frac = float((gray > 80).mean())

    # Warn early if the thumbnail is unlikely to contain segmentable cells:
    # - very low contrast (flat/uniform image, no distinguishable structures)
    # - almost entirely bright or entirely dark (overexposed / blank)
    if contrast < 15:
        return (
            f"⚠️ The preview image has very low contrast (std={contrast:.1f}), which suggests it "
            f"may be a flat or uniform frame not suitable for cell segmentation. "
            f"Try a different dataset whose thumbnail shows individual cells or nuclei."
        )
    if bright_frac > 0.95 or bright_frac < 0.01:
        return (
            f"⚠️ The preview image appears {'nearly fully saturated' if bright_frac > 0.95 else 'almost completely dark'} "
            f"(bright pixel fraction={bright_frac:.2f}), which makes cell detection unreliable. "
            f"Try a dataset whose thumbnail clearly shows individual cells."
        )

    img_chw = np.transpose(arr, (2, 0, 1))

    # 7. Run Cellpose inference via TUBITAK BioEngine worker.
    #    output_format="url" makes the service render the overlay with a random
    #    colormap, write full-precision labels (16-bit PNG + npy) to a fresh
    #    Hypha artifact, and return markdown-ready URLs — no base64 round-trip.
    cellpose = await server.get_service("ri-scale/cellpose-finetuning")
    result = await cellpose.infer(
        model="cpsam",
        input_arrays=[img_chw],
        output_format="url",
        niter=250,
        flow_threshold=0.4,
        cellprob_threshold=0.0,
    )
    payload = result[0]["output"]

    if not isinstance(payload, dict) or payload.get("encoding") != "hypha_artifact":
        return (
            "⚠️ Unexpected segmentation response format. "
            "The Cellpose service may need to be redeployed with output_format='url' support."
        )

    n_cells = int(payload.get("object_count", 0))
    if n_cells == 0:
        return (
            f"⚠️ Cellpose-SAM found **0 cells** in this preview image "
            f"(contrast={contrast:.1f}, bright_frac={bright_frac:.2f}). "
            f"The thumbnail may show a tissue overview, subcellular structures, or an imaging "
            f"artefact rather than individual cells. Try a different dataset whose thumbnail "
            f"clearly shows individual cells or nuclei (e.g. 'HeLa nuclei', 'Drosophila cells', "
            f"'nuclear staining')."
        )

    return str(payload.get("markdown", ""))


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
- search_images(query: str, limit: int = 10, scientific_name: str = None, imaging_method: str = None)
- search_models(task: str, limit: int = 5)
- run_cellpose_on_image(image_url: str)
- explain_advanced_query_syntax()

Use tools first whenever a user asks for archive results.
- When querying based on the user's prompt, start very briefly.
- The beta index is limited/incomplete, so if you get no results, distill the user's query to common terms like "tumor", "cancer", "microscopy", "human", "fluorescence", "confocal", "segmentation", "mouse", or "organoid".
- Prefer OR-style brief queries first (for example: "mouse OR tumor").
- For multi-concept dataset requests (for example "mouse tumor"), run at least two dataset tool calls even if the first call returns enough results.
- A good default sequence is: (1) broad OR query, then (2) one high-prior single-term query.
- If a follow-up model/proxy call times out after tool results already exist, ignore that transient timeout and finalize using available tool results; do not mention backend/proxy timeouts to the user.
- If an OR query returns no dataset results, do not switch to AND. Immediately try single-term fallbacks.
- If queries fail repeatedly or are empty, simplify to single-term fallbacks ("mouse", "tumor", "cancer", "neuroblastoma").
- Make up to four fallback calls, then provide a best-effort final answer and explicitly mention beta limitations.
- If any dataset query already returns at least the requested number of results, stop calling tools and answer immediately.
- Tool outputs are compact structured JSON objects. You must decide the response format from user intent (listing, comparison, recommendation, synthesis).
- Do not default to a fixed template like "Here are up to N ..." unless the user explicitly asks for a list.
- For image searches, extract organism and imaging modality from the user's query and pass them as filters:
  - scientific_name: use lowercase scientific name, e.g. "drosophila melanogaster", "homo sapiens", "mus musculus"
  - imaging_method: use lowercase modality, e.g. "confocal microscopy", "fluorescence microscopy", "bright-field microscopy"
- If search_images returns available_organisms or available_imaging_methods in the result, use those values for follow-up filtered queries.
- For queries like "show me images of X in Y" or "find fluorescence images of Z", always use search_images with appropriate filters rather than search_datasets.
## Image previews
- The `thumbnail_url` field in `search_datasets()` results may be a pre-rendered PNG **or** an OME-Zarr URL (`.ome.zarr`). Both work with `run_cellpose_on_image()`.
- PNG thumbnail_urls can be shown inline: `![Preview of <title>](<thumbnail_url>)`. Show at most 3 thumbnails per response.
- OME-Zarr thumbnail_urls cannot be displayed inline — do NOT embed them as markdown images. Instead, tell the user the dataset has image data available for segmentation.
- `search_images()` results contain metadata but NO directly displayable URLs.
- NEVER construct or guess raw image file URLs (`.tif`, `.ome.tif`).
- When a dataset result has no `thumbnail_url`, tell the user no preview is available and offer to search for similar datasets.

## Image analysis
- For analysis requests (e.g. "segment cells", "count nuclei", "analyse this dataset", "run Cellpose"):
  1. If no dataset is selected yet, call search_datasets() or search_images() first.
  2. Call search_models() with the task (e.g. "cell segmentation") to show available models from the AI Model Hub.
  3. Use the thumbnail_url from the dataset result as image_url for run_cellpose_on_image().
  4. Call run_cellpose_on_image(thumbnail_url) — it runs Cellpose-SAM and returns either a segmentation overlay image with cell count, or a ⚠️ warning message if the thumbnail is unsuitable (low contrast, overexposed, or 0 cells detected).
- If run_cellpose_on_image() returns a ⚠️ warning, relay it clearly to the user and suggest searching for a different dataset whose thumbnail shows individual cells or nuclei (e.g. "HeLa nuclei", "Drosophila cells", "nuclear staining", "cell segmentation benchmark").
- Always confirm with the user which dataset to analyse before running inference.
- Only pass thumbnail_url values from actual search_datasets() results to run_cellpose_on_image() — never invent URLs.
Then provide a concise human summary with links/accessions whenever available.
"""
)
