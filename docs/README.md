# RI-SCALE Model Hub User Guide

The **RI-SCALE Model Hub** helps researchers discover, share, and reuse AI models. It also provides an **Agents** experience where domain-specific assistants can answer user questions by combining tool calls with LLM reasoning.

## Core Features

1. **Model Discovery**: Search and browse standardized models.
2. **Model Uploading**: Contribute and version your own models.
3. **Agent Chat**: Use specialized assistants (for example, Euro-BioImaging Finder).

---

## Browsing Models

- **Search**: Find models by name, description, author, or keywords.
- **Filter**: Narrow by tags (task, modality, etc.).
- **Details**: Open a model card to inspect metadata, files, citations, and history.

## Uploading Models

1. Go to **Upload**.
2. Authenticate via Hypha.
3. Upload model files and `rdf.yaml`.
4. Review and complete metadata (name, description, tags).
5. Submit to publish.

---

## Agents: What They Do

Agents help users by turning natural-language questions into tool-assisted responses.

### Example Agent

- **Euro-BioImaging Finder**
- Typical focus: imaging services, technologies, and nodes.

### Typical Capabilities

- Geographic lookup (e.g., facilities in a country)
- Technology lookup (e.g., specific microscopy technique)
- Guided discovery with links/details from indexed resources

---

## Agents: How They Work (Developer View)

The RI-SCALE agent stack is intentionally simple:

1. **Frontend** (`src/pages/AgentPage.tsx`) runs a Pyodide kernel with `web-python-kernel`.
2. Agent startup code and tool functions are loaded from agent artifacts.
3. The kernel calls a **single backend** service: `ri-scale/default@chat-proxy`.
4. The chat-proxy calls OpenAI and returns OpenAI-compatible responses.

### Architecture Notes

- No local Python backend is required for production chat.
- The only backend for chat is the deployed Hypha app `chat-proxy` (which then calls OpenAI).
- Frontend uses `mode: "random"` when resolving `ri-scale/default@chat-proxy`.

### Chat Proxy Contract

Current frontend expects chat-proxy to expose:

- `chat_completion(messages, tools, tool_choice, model)`
- `resolve_url(url, method='GET', headers=None, timeout=30.0)`

The service must be **publicly visible** for anonymous users.

`resolve_url` is used as a CORS-safe relay for selected agent tool HTTP calls (for example, `beta.bioimagearchive.org`) so browser-origin CORS restrictions do not break tool execution.

---

## Deploying Chat Proxy (Developer)

Use Hypha Apps CLI (install + start):

```bash
python scripts/deploy_chat_proxy.py
```

This script installs and starts app id `chat-proxy`, and frontend resolves:

- `ri-scale/default@chat-proxy`

If you redeploy, restart the frontend kernel session so the latest bridge code is used.

---

## Troubleshooting Agents

- **Service not found**: ensure app is started, not just installed.
- **Permission denied**: verify service visibility is public.
- **No response / PythonError**: restart kernel and re-open agent.
- **Stale behavior after fixes**: hard-refresh browser to clear old worker state.

### CORS and Archive Search

If an agent tool calls `https://beta.bioimagearchive.org/...` directly from the browser/Pyodide runtime, requests may fail with CORS errors such as:

- `No 'Access-Control-Allow-Origin' header is present on the requested resource`
- `TypeError: Failed to fetch`

Important notes:

- This is **origin-dependent** (not only localhost).
- It can still happen on deployed domains unless that origin is explicitly allowed by the target server.
- For reliability, route archive/network fetches through a backend proxy service where possible.

### BioImage Finder Result Quality

For BioImage Archive dataset requests, the BioImage Finder startup script applies a relevance strategy designed for noisy/intermittent beta-index results:

1. Build a brief OR-style query first (for example: `mouse OR tumor`).
2. If primary query quality is weak or empty, run fallback single-term queries (up to four terms).
3. Merge unique results from fallback queries and rerank by request-term relevance.
4. Return the top compact list with accessions/links and a clear beta-index limitation note.

Implementation details live in:

- `scripts/agent_startup_scripts/bioimage_finder_startup_script.py`
- `docs/bioimage-finder-startup-script.py`

The startup script includes:

- query-term extraction with stopword filtering,
- relevance scoring over title/description/accession,
- duplicate-safe result merging across fallback terms,
- assistant summaries optimized for concise user-facing answers.

To validate quality behavior quickly, run the startup script checks against real API responses and inspect generated summaries for mixed-term prompts (for example, `mouse tumor cancer`).

### Kernel Logs and Debug Report

Agent chat includes a **Kernel Logs** panel for low-level diagnostics.

- Open logs using the terminal/log icon in the chat header.
- Use **Copy** to copy combined kernel output + progress traces.
- Use **Download** to export a timestamped debug report file.

These details are intended for debugging and incident reports, while user-facing chat progress remains concise.

### Shared Session Permissions

When a chat session is shared, the session artifact permissions are set to:

- `"*": "r"`
- `"@": "r+"`

`"*": "r"` includes read/list/get-file style access needed to view shared chat content (such as `messages.json`) without granting write/mutate access.

---

## Documentation & Help

- **About**: [About](/about)
- **API**: [API Documentation](/#/api)
