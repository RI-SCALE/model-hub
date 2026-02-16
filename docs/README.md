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

The service must be **publicly visible** for anonymous users.

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

---

## Documentation & Help

- **About**: [About](/about)
- **Terms**: [Terms of Service](/toc)
- **API**: [API Documentation](/#/api)
