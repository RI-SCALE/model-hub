import asyncio
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


# ---------------------------------------------------------------------------
# Cell segmentation (Cellpose-SAM via the BioEngine model-runner)
#
# All image work happens here, server-side: the chat kernel passes a URL and
# gets markdown with Hypha artifact URLs back, never image bytes.
# ---------------------------------------------------------------------------
_MODEL_RUNNER_SERVICE_ID = os.environ.get(
    "MODEL_RUNNER_SERVICE_ID",
    "bioimage-io/bioengine-worker-kth-596798f679-sb8ph-4dcbe5dc:model-runner",
)
_CELLPOSE_SAM_MODEL_ID = os.environ.get("CELLPOSE_SAM_MODEL_ID", "idealistic-eagle")
_CELLPOSE_INPUT_SIZE = 256  # Cellpose-SAM RDF declares a fixed [1, 3, 256, 256] input
_SEGMENTATION_DEADLINE_S = 100.0  # stay under the chat UI's per-tool hard timeout
_RESULTS_WORKSPACE = "ri-scale"
_RESULTS_ALIAS_PREFIX = "chatbot-segmentation"
_model_runner: Any = None


async def _get_model_runner() -> Any:
    """Return a model-runner handle; re-resolve via the worker if the pod changed."""
    global _model_runner
    if _model_runner is not None:
        return _model_runner
    try:
        _model_runner = await api.get_service(_MODEL_RUNNER_SERVICE_ID)
        return _model_runner
    except Exception as exp:
        logger.warning(f"Configured model-runner {_MODEL_RUNNER_SERVICE_ID} unavailable: {exp}")
    # Pod-specific ids change on every worker restart: rediscover, KTH first.
    workers = await api.list_services({"workspace": "bioimage-io", "type": "bioengine-worker"})
    worker_ids = sorted((w["id"] for w in workers), key=lambda wid: "kth" not in wid)
    for worker_id in worker_ids:
        try:
            worker = await api.get_service(worker_id)
            status = await asyncio.wait_for(worker.get_app_status(None), timeout=20)
            sid = status["model-runner"]["service_ids"]["websocket_service_id"]
            _model_runner = await api.get_service(sid)
            logger.info(f"Resolved model-runner via {worker_id}: {sid}")
            return _model_runner
        except Exception as exp:
            logger.warning(f"No model-runner via {worker_id}: {exp}")
    raise RuntimeError("No BioEngine model-runner is reachable right now.")


async def _fetch_bytes(client: httpx.AsyncClient, url: str) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in _allowed_hosts():
        raise ValueError(f"Image host is not allowed: {parsed.hostname}")
    response = await client.get(url, follow_redirects=True)
    response.raise_for_status()
    return response.content


async def _load_image_rgb(client: httpx.AsyncClient, image_url: str) -> Any:
    """Fetch a PNG/JPEG or the lowest-resolution level of an OME-Zarr as uint8 RGB."""
    import io
    import numpy as np
    from PIL import Image

    if ".zarr" not in image_url:
        data = await _fetch_bytes(client, image_url)
        return np.array(Image.open(io.BytesIO(data)).convert("RGB"))

    base = image_url.rstrip("/")
    attrs = json.loads(await _fetch_bytes(client, f"{base}/.zattrs"))
    if "multiscales" not in attrs and "bioformats2raw.layout" in attrs:
        base = f"{base}/0"  # bioformats2raw layout: first image lives in series 0
        attrs = json.loads(await _fetch_bytes(client, f"{base}/.zattrs"))
    level = attrs["multiscales"][0]["datasets"][-1]["path"]
    zarray = json.loads(await _fetch_bytes(client, f"{base}/{level}/.zarray"))
    shape, dtype = zarray["shape"], np.dtype(zarray["dtype"])
    h, w = shape[-2], shape[-1]
    chunk_h, chunk_w = zarray["chunks"][-2], zarray["chunks"][-1]
    if chunk_h < h or chunk_w < w:
        h, w = min(h, chunk_h), min(w, chunk_w)  # first chunk only; still a usable preview
    sep = zarray.get("dimension_separator", ".")
    compressor = zarray.get("compressor")
    codec = None
    if compressor:
        try:
            import numcodecs
        except ImportError:
            import micropip  # Pyodide runtime
            await micropip.install("numcodecs")
            import numcodecs
        codec = numcodecs.get_codec(compressor)

    n_channels = shape[1] if len(shape) >= 4 else 1
    channels = []
    for c in range(min(n_channels, 3)):
        lead = ["0"] * (len(shape) - 2)
        if len(shape) >= 4:
            lead[1] = str(c)
        raw = await _fetch_bytes(client, f"{base}/{level}/" + sep.join(lead + ["0", "0"]))
        if codec is not None:
            raw = codec.decode(raw)
        plane = np.frombuffer(bytes(raw), dtype=dtype).reshape(chunk_h, chunk_w)[:h, :w]
        channels.append(plane.astype(np.float32))
    while len(channels) < 3:
        channels.append(channels[0] if len(channels) == 1 else np.zeros_like(channels[0]))
    stack = np.stack(channels[:3], axis=-1)
    out = np.zeros_like(stack)
    for c in range(3):  # per-channel percentile stretch to uint8
        lo, hi = np.percentile(stack[..., c], [1, 99.8])
        out[..., c] = (stack[..., c] - lo) / max(hi - lo, 1e-6)
    return (out.clip(0, 1) * 255).astype(np.uint8)


def _crop_empty_borders(rgb: Any, threshold: int = 8, margin: int = 4) -> Any:
    """Crop near-black padding (common in BIA thumbnails) so the model sees more signal."""
    import numpy as np

    content = rgb.max(axis=2) > threshold
    rows, cols = np.flatnonzero(content.any(axis=1)), np.flatnonzero(content.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return rgb
    y0, y1 = max(rows[0] - margin, 0), min(rows[-1] + margin + 1, rgb.shape[0])
    x0, x1 = max(cols[0] - margin, 0), min(cols[-1] + margin + 1, rgb.shape[1])
    if (y1 - y0) * (x1 - x0) > 0.9 * rgb.shape[0] * rgb.shape[1] or min(y1 - y0, x1 - x0) < 32:
        return rgb
    return np.ascontiguousarray(rgb[y0:y1, x0:x1])


def _fit_to_model_input(rgb: Any) -> tuple[Any, Any, int, int]:
    """Resize to fit 256x256 (keeping aspect) and zero-pad; return (input bcyx float32, preview, h, w)."""
    import numpy as np
    from PIL import Image

    size = _CELLPOSE_INPUT_SIZE
    img = Image.fromarray(rgb)
    scale = size / max(img.size)  # also upscales small previews so cells are not tiny
    if abs(scale - 1.0) > 1e-3:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    preview = np.array(img)
    h, w = preview.shape[:2]
    padded = np.zeros((size, size, 3), dtype=np.float32)
    padded[:h, :w] = preview.astype(np.float32) / 255.0
    return np.transpose(padded, (2, 0, 1))[None], preview, h, w


async def _run_model(mr: Any, model_input: Any, deadline: float) -> Any:
    import io
    import random
    import numpy as np

    request_id = await asyncio.wait_for(
        mr.infer(model_id=_CELLPOSE_SAM_MODEL_ID, inputs=model_input, return_download_url=True),
        timeout=60,
    )
    # Back off 2s -> 5s -> 10s; the skill asks for >=10s steady-state polling.
    delays = iter([2, 5])
    while True:
        status = await asyncio.wait_for(mr.get_infer_status(request_id=request_id), timeout=30)
        if status.get("completed_at") is not None:
            result = status.get("result") or {}
            if isinstance(result, dict) and "error" in result:
                raise RuntimeError(f"Cellpose-SAM failed: {result['error']}")
            labels_url = result.get("labels") or next(
                (v for v in result.values() if isinstance(v, str) and v.startswith("http")), None
            )
            if not labels_url:
                raise RuntimeError("Cellpose-SAM returned no label output")
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.get(labels_url)
                response.raise_for_status()
            return np.squeeze(np.load(io.BytesIO(response.content), allow_pickle=False))
        delay = next(delays, 10) * random.uniform(0.8, 1.2)
        if asyncio.get_running_loop().time() + delay > deadline:
            try:
                await mr.cancel_request(request_id=request_id)
            except Exception:
                pass
            raise TimeoutError("segmentation did not finish in time")
        await asyncio.sleep(delay)


def _render_overlay(preview: Any, mask: Any, alpha: float = 0.55) -> tuple[Any, int]:
    import colorsys
    import numpy as np

    labels = np.unique(mask)
    labels = labels[labels > 0]
    if labels.size == 0:
        return preview, 0
    rng = np.random.default_rng()
    lut = np.zeros((int(mask.max()) + 1, 3), dtype=np.uint8)
    for label in labels:
        r, g, b = colorsys.hsv_to_rgb(rng.random(), 0.55 + 0.4 * rng.random(), 0.7 + 0.3 * rng.random())
        lut[label] = (int(r * 255), int(g * 255), int(b * 255))
    fg = mask > 0
    overlay = preview.copy()
    overlay[fg] = (preview[fg] * (1 - alpha) + lut[mask[fg]] * alpha).clip(0, 255).astype(np.uint8)
    return overlay, int(labels.size)


async def _publish_result(preview: Any, overlay: Any, mask: Any, n_objects: int, source_url: str) -> dict[str, Any]:
    import io
    import uuid
    from datetime import datetime, timezone
    import numpy as np
    from PIL import Image

    def _png(array: Any, mode: str | None = None) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(array, mode=mode).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    npy = io.BytesIO()
    np.save(npy, mask.astype(np.uint32), allow_pickle=False)
    h, w = mask.shape
    created_at = datetime.now(tz=timezone.utc).isoformat()
    files = {
        "overlay.png": _png(overlay),
        "input.png": _png(preview),
        "labels.png": _png(mask.clip(0, 65535).astype(np.uint16), mode="I;16"),
        "labels.npy": npy.getvalue(),
        "metadata.json": json.dumps({
            "object_count": n_objects, "width": w, "height": h, "source_url": source_url,
            "model": f"Cellpose-SAM ({_CELLPOSE_SAM_MODEL_ID}) via BioEngine model-runner",
            "created_at": created_at,
        }, indent=2).encode(),
    }

    am = await api.get_service("public/artifact-manager")
    alias = f"{_RESULTS_ALIAS_PREFIX}-{uuid.uuid4().hex[:12]}"
    created = await am.create(
        type="dataset",
        alias=f"{_RESULTS_WORKSPACE}/{alias}",
        manifest={
            "name": f"Chatbot segmentation {alias}",
            "description": f"Cellpose-SAM: {n_objects} objects in a {w}x{h} preview of {source_url}",
            "tags": ["cellpose", "segmentation", "chatbot"],
        },
        config={"permissions": {"*": "r"}},
        stage=True,
    )
    artifact_id = created["id"] if isinstance(created, dict) else str(created)
    async with httpx.AsyncClient(timeout=60) as client:
        for name, data in files.items():
            put_url = await am.put_file(artifact_id, file_path=name)
            (await client.put(put_url, content=data)).raise_for_status()
    await am.commit(artifact_id)

    base = f"https://hypha.aicell.io/{_RESULTS_WORKSPACE}/artifacts/{alias}/files"
    return {
        "artifact_id": artifact_id,
        "overlay_url": f"{base}/overlay.png",
        "labels_png_url": f"{base}/labels.png",
        "labels_npy_url": f"{base}/labels.npy",
        "metadata_url": f"{base}/metadata.json",
        "markdown": (
            f"**{n_objects} cell{'s' if n_objects != 1 else ''} detected** "
            f"(Cellpose-SAM, {w}x{h} px preview)\n\n"
            f"![Segmentation overlay]({base}/overlay.png)\n\n"
            f"Downloads: [labels (16-bit PNG)]({base}/labels.png) · "
            f"[labels (npy)]({base}/labels.npy) · [metadata]({base}/metadata.json)"
        ),
    }


async def segment_cells(image_url: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Segment cells in an image (PNG/JPEG or OME-Zarr URL) with Cellpose-SAM.

    Returns {"ok": True, "object_count", "markdown", "overlay_url", ...} or
    {"ok": False, "warning"|"error": "<message for the user>"}.
    """
    global _model_runner
    import numpy as np

    loop = asyncio.get_running_loop()
    deadline = loop.time() + _SEGMENTATION_DEADLINE_S
    try:
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "ri-scale-model-hub-chat-proxy/1.0"}) as client:
            rgb = await _load_image_rgb(client, image_url)
    except Exception as exp:
        logger.warning(f"segment_cells: could not load {image_url}: {exp}")
        return {"ok": False, "error": f"Could not load the image ({exp})."}

    rgb = _crop_empty_borders(rgb)
    model_input, preview, h, w = _fit_to_model_input(rgb)
    gray = preview.mean(axis=2)
    contrast, bright = float(gray.std()), float((gray > 80).mean())
    if contrast < 8:
        return {"ok": False, "warning": "The preview image is almost uniform, so there is nothing to segment. Try a dataset whose preview shows individual cells or nuclei."}
    if bright > 0.97 or bright < 0.005:
        return {"ok": False, "warning": f"The preview image is {'almost fully saturated' if bright > 0.97 else 'almost completely dark'}, so cell detection would be unreliable. Try a different dataset."}

    for attempt in range(2):
        try:
            mr = await _get_model_runner()
            mask = (await _run_model(mr, model_input, deadline))[:h, :w].astype(np.int64)
            break
        except TimeoutError:
            return {"ok": False, "error": "The segmentation service is busy or warming up. Please try again in a minute."}
        except Exception as exp:
            logger.warning(f"segment_cells attempt {attempt + 1} failed: {exp}")
            _model_runner = None  # force re-resolution (worker pod may have moved)
            if attempt == 1 or loop.time() > deadline - 20:
                return {"ok": False, "error": "The segmentation service is temporarily unavailable. Please try again later."}

    overlay, n_objects = _render_overlay(preview, mask)
    if n_objects == 0:
        return {"ok": False, "object_count": 0, "warning": "Cellpose-SAM found no cells in this preview. It may show tissue, subcellular structures or an overview rather than individual cells. Try a dataset whose preview clearly shows cells or nuclei."}
    try:
        published = await _publish_result(preview, overlay, mask, n_objects, image_url)
    except Exception as exp:
        logger.error(f"segment_cells: publishing result failed: {exp}")
        return {"ok": False, "error": "Segmentation ran but the result could not be saved. Please try again."}
    return {"ok": True, "object_count": n_objects, "width": w, "height": h, **published}


api.export(
    {
        "config": {"visibility": "public"},
        "setup": setup,
        "chat_completion": chat_completion,
        "resolve_url": resolve_url,
        "segment_cells": segment_cells,
    }
)
