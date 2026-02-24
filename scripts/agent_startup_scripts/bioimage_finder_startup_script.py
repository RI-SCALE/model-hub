import json
import re
from typing import Any, Dict, List
from urllib.parse import quote

import httpx

try:
    import js  # type: ignore
except Exception:
    js = None


BASE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts"
BASE_IMAGE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts/image"
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

    return {
        "title": title,
        "accession": accession or "",
        "url": (
            f"https://beta.bioimagearchive.org/bioimage-archive/study/{accession}"
            if accession
            else None
        ),
        "uuid": (
            source_payload.get("uuid")
            if isinstance(source_payload.get("uuid"), str)
            else None
        ),
        "description": (
            source_payload.get("description")
            if isinstance(source_payload.get("description"), str)
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
        "score": item.get("_score"),
    }


def _compact_dataset_result(item: Dict[str, Any]) -> Dict[str, Any]:
    score_value = item.get("score")
    score = score_value if isinstance(score_value, (int, float)) else None
    compact: Dict[str, Any] = {
        "title": _short_text(item.get("title", "Untitled"), 180),
        "accession": (
            item.get("accession") if isinstance(item.get("accession"), str) else ""
        ),
        "url": item.get("url") if isinstance(item.get("url"), str) else None,
        "doi": item.get("doi") if isinstance(item.get("doi"), str) else None,
        "release_date": (
            item.get("release_date")
            if isinstance(item.get("release_date"), str)
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
        "title": _short_text(item.get("title", "Untitled"), 180),
        "id": item.get("id") if isinstance(item.get("id"), str) else "",
        "accession": (
            item.get("accession") if isinstance(item.get("accession"), str) else ""
        ),
        "study_url": (
            item.get("study_url") if isinstance(item.get("study_url"), str) else None
        ),
        "file_pattern": (
            item.get("file_pattern")
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


async def search_images(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive images endpoint by full-text query.

    Args:
        query: User search text for image-level index.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    safe_limit = max(1, int(limit))
    proxied = await _search_via_proxy("images", query, safe_limit)
    if isinstance(proxied, dict):
        if "error" in proxied:
            raise RuntimeError(proxied["error"])
        return _normalize_search_payload("images", query, safe_limit, proxied)

    url = _build_url(BASE_IMAGE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    hits, total = _extract_hits_and_total(payload)
    top_hits: List[Dict[str, Any]] = []

    for item in hits[: max(1, safe_limit)]:
        if isinstance(item, dict):
            top_hits.append(_image_result_from_hit(item))

    raw_payload = {
        "query": query,
        "url": url,
        "total": total,
        "results": top_hits,
    }
    return _normalize_search_payload("images", query, safe_limit, raw_payload)


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


def _sample_titles(items: List[Dict[str, Any]], max_items: int = 3) -> List[str]:
    titles: List[str] = []
    for item in items[:max_items]:
        title = item.get("title")
        if isinstance(title, str) and title.strip():
            titles.append(title.strip())
    return titles


async def _probe_beta_index() -> List[str]:
    probes = [
        ("datasets", "tumor", search_datasets),
        ("datasets", "mouse", search_datasets),
        ("datasets", "cancer", search_datasets),
        ("images", "tumor", search_images),
    ]
    lines: List[str] = []
    for kind, query, fn in probes:
        try:
            payload = await fn(query, limit=3)
            total = payload.get("total", 0)
            total_int = total if isinstance(total, int) else 0
            results = payload.get("results")
            top_results = results if isinstance(results, list) else []
            titles = _sample_titles(top_results)
            lines.append(f"{kind}:{query} -> total={total_int}, sample_titles={titles}")
        except Exception as exc:
            lines.append(f"{kind}:{query} -> error={exc}")
    return lines


_beta_probe_lines = await _probe_beta_index()


print(
    """
You are the RI-SCALE BioImage Finder.

You can call these utility functions directly:
- search_datasets(query: str, limit: int = 10)
- search_images(query: str, limit: int = 10)
- explain_advanced_query_syntax()

Use tools first whenever a user asks for archive results.
- The beta index is limited/incomplete, so infer likely terms from startup probe output.
- When querying based on the user's prompt, start very briefly.
- Prefer OR-style brief queries first (for example: "mouse OR tumor").
- For multi-concept dataset requests (for example "mouse tumor"), run at least two dataset tool calls even if the first call returns enough results.
- A good default sequence is: (1) broad OR query, then (2) one high-prior single-term query from startup probe totals.
- If a follow-up model/proxy call times out after tool results already exist, ignore that transient timeout and finalize using available tool results; do not mention backend/proxy timeouts to the user.
- If an OR query returns no dataset results, do not switch to AND. Immediately try single-term fallbacks.
- If queries fail repeatedly or are empty, simplify to single-term fallbacks ("mouse", "tumor", "cancer", "neuroblastoma").
- Use startup probe totals as your prior about likely matches.
- Make up to four fallback calls, then provide a best-effort final answer and explicitly mention beta limitations.
- If any dataset query already returns at least the requested number of results, stop calling tools and answer immediately.
- Tool outputs are compact structured JSON objects. You must decide the response format from user intent (listing, comparison, recommendation, synthesis).
- Do not default to a fixed template like "Here are up to N ..." unless the user explicitly asks for a list.
- Startup probe lines below are context-only signals about index behavior; they are not mandatory query terms.
Then provide a concise human summary with links/accessions whenever available.
"""
)

print("Startup probe snapshot (context only, not prescribed query terms):")
for _line in _beta_probe_lines:
    print(f"- {_line}")
