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

- **BioImage Finder**
- Focus: Searching the BioImage Archive (TM) datasets.
- Note: This replaces the Euro-BioImaging Finder.

### BioImage Finder Capabilities

It uses two endpoints from the BioImage Archive to search through their datasets based on the user's prompts.

#### Searching the BioImage Archive

Use the Search box available in the top-right corner of every page. Enter any words that describe studies you are interested in. For example entering the words confocal fluorescence microscopy ( returns all studies containing any or all three words. Search terms are retained in the search box, where they can be refined (see the Advanced search section below).

The search results page is a list of matching studies sorted according to relevance. You can change the sorting by using the Sort by selector. Clicking on the title of a study takes you to a more detailed page about that study. If there are many results, they will be split over multiple pages. Links at the bottom of the results allow you to navigate the pages, and links at the left of the results allow you to filter the studies by collection, release date and/or publication resource type.

Within the results any matching search word terms are highlighted. Yellow highlighting indicates exact matches, green highlighting indicates synonyms, and peach highlighting indicates more specific matches (e.g. “pancreatic ductal adenocarcinoma” as a more specific term for “adenocarcinoma”). These more specific terms are from EFO ( the Experimental Factor Ontology ).

**Advanced search**

Queries are case-insensitive. Each word in the query is treated as a separate term (unless surrounded by double quotes), and by default every result has to contain at least one of the terms. This behaviour can be modified by using boolean operators and brackets; e.g.

* `confocal fluorescence microscopy` returns all studies containing any or all three words
* `confocal OR fluorescence OR microscopy` returns all studies containing any or all three words, i.e it is the same as the previous query
* `confocal AND fluorescence AND microscopy` returns only studies containing all three words in any order
* `“confocal fluorescence microscopy”` returns only studies containing the quoted phrase.
* `microscopy AND (fluorescence OR confocal)` returns only studies containing the term microscopy and either confocal and/or fluorescence.
* `microscopy AND NOT (fluorescence OR confocal)` returns studies containing the term microscopy but not confocal or fluorescence.

Queries containing star or question mark characters are treated separately. A star character will match any combination of zero or more characters, e.g., `leuk*mia` will match to leukemia and leukaemia, as well as leukqwertymia. A question mark character will match any single characters, e.g., `m?n` will match both man and men. Matched terms for queries that include wildcards are not highlighted in the results.

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
- **API**: [API Documentation](/#/api)
