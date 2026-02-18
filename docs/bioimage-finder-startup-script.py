import json
from urllib.parse import quote
from typing import Any, Dict, List

import httpx


BASE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts"
BASE_IMAGE_SEARCH_URL = "https://beta.bioimagearchive.org/search/search/fts/image"


def _build_url(base_url: str, query: str) -> str:
    encoded = quote(query, safe='"()[]{}:*?+-/\\')
    return f"{base_url}?query={encoded}"


async def search_datasets(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive datasets by full-text query.

    Args:
        query: User search text, supports boolean operators (AND/OR/NOT), quotes, wildcards.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    url = _build_url(BASE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
      response = await client.get(url)
      response.raise_for_status()
      payload = response.json()

    hits = payload.get("hits", []) if isinstance(payload, dict) else []
    top_hits: List[Dict[str, Any]] = []

    for item in hits[: max(1, limit)]:
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


async def search_images(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search BioImage Archive images endpoint by full-text query.

    Args:
        query: User search text for image-level index.
        limit: Maximum number of hits to return in the summarized output.

    Returns:
        Dictionary with request URL, total count, and top results.
    """
    url = _build_url(BASE_IMAGE_SEARCH_URL, query)
    async with httpx.AsyncClient(timeout=30.0) as client:
      response = await client.get(url)
      response.raise_for_status()
      payload = response.json()

    hits = payload.get("hits", []) if isinstance(payload, dict) else []
    top_hits: List[Dict[str, Any]] = []

    for item in hits[: max(1, limit)]:
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
        "3) \"confocal fluorescence microscopy\"\n"
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
