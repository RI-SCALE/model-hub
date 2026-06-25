---
name: ri-scale-model-hub
description: Interact with the RI-SCALE AI Model Hub (modelhub.riscale.eu) — a federated EU research-infrastructure catalogue of open AI models across biomedical imaging, climate science, earth observation, medical imaging, materials, and other scientific domains. Use this skill to search and browse models, download model weights and metadata via git or HTTP, and upload new models on behalf of a logged-in user (create an artifact, push files via git + Git LFS, then publish to the public catalogue). Mention this skill when the user wants to find, evaluate, download, or share AI models for European research; when they mention RI-SCALE, modelhub.riscale.eu, or the Model Hub; or when they ask to register a model artifact through git or the artifact-manager API.
license: Apache-2.0
metadata:
  author: RI-SCALE consortium
  version: "1.0"
  source: https://github.com/RI-SCALE/model-hub
  hub-url: https://modelhub.riscale.eu
  hypha-server: https://hypha.aicell.io
  workspace: ri-scale
---

# RI-SCALE Model Hub skill

The RI-SCALE Model Hub at **https://modelhub.riscale.eu** is a federated catalogue of open AI models registered as Hypha artifacts under the `ri-scale` workspace, parent collection `ai-model-hub`. Each model is a git repository stored on the Hypha server, with large weights backed by Git LFS and S3.

This skill gives an AI agent the URLs, commands, and data shapes needed to:

1. **Search and browse** registered models (no authentication required).
2. **Download** models via `git clone` or direct HTTP.
3. **Create, upload, and publish** new models on behalf of a logged-in user (requires an API token).

The user obtains an API token from the **Model Hub user menu → "Generate API key"** at https://modelhub.riscale.eu and pastes it to you. Treat the token as a secret: never print it in chat, never commit it to git, never write it to publicly readable files.

---

## 1. Endpoints and shape of an artifact

| Purpose | URL |
|---|---|
| Catalogue collection | `https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub` |
| List models | `https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children` |
| Single model metadata (REST) | `https://hypha.aicell.io/ri-scale/artifacts/<alias>` |
| Single model files (REST) | `https://hypha.aicell.io/ri-scale/artifacts/<alias>/files/` |
| Single model file content (REST) | `https://hypha.aicell.io/ri-scale/artifacts/<alias>/files/<filename>` |
| Git repo (read + write) | `https://hypha.aicell.io/ri-scale/git/<alias>` |
| Public Model Hub web page | `https://modelhub.riscale.eu/#/artifacts/<alias>` |

**URL conventions worth memorising:**

- **Backend / REST + git URLs** include the `ri-scale/` workspace segment because the artifact-manager and git server are workspace-namespaced.
- **The frontend page URL takes ONLY the alias** — `https://modelhub.riscale.eu/#/artifacts/<alias>`. **Do NOT** prefix it with `ri-scale/`; that produces a broken URL like `…/artifacts/ri-scale/<alias>` that the React router does not resolve to the right page. When generating links back to a user, the frontend takes the alias only; everything else takes `ri-scale/<alias>` or `<workspace>/<alias>`.

Each model artifact has:

- A short URL-safe **alias** (lowercase + hyphens), e.g. `cellpose-lymph-node-segmentation`.
- A **manifest** with at least `name`, `description`, `type: model`, and ideally `tags`, `license`, `authors`, `documentation: README.md`.
- A `config.storage: "git"` flag (the storage backend) and a `manifest.published: bool` flag (visibility in the public catalogue — must live on the manifest, NOT config, because Hypha strips non-allowlisted keys from `config` on read).
- A git repository with at least a `README.md` (the documentation) and ideally an `rdf.yaml` (BioImage Model Zoo–style metadata).
- Optional: an `rdf.yaml`, `.gitattributes` configuring Git LFS, weight files (`*.pt`, `*.ckpt`, `*.h5`, `*.safetensors`, `*.pth`, `*.bin`), cover images, and citation files.

---

## 2. Search and browse (no auth)

### List all models in the public catalogue

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?pagination=true&offset=0&limit=20&order_by=last_modified'
```

With `pagination=true` the response is `{ items: [...], total: N, offset, limit }`. **Without** `pagination=true`, the same endpoint returns a **bare array** (no wrapper) — pick one and stick with it. Each item has `alias`, `manifest.name`, `manifest.description`, `manifest.tags`, `type`, etc.

### Keyword + filter search

To only return models the contributor has explicitly **published** (drafts excluded), filter on `manifest.published`. Two quirks worth knowing:

1. The filter value MUST be the literal string `"true"` (Hypha coerces both sides to strings before comparing — sending the JSON boolean `true` matches nothing, silently).
2. `manifest.published` lives on the **manifest**, not on `config`. Hypha silently strips non-allowlisted keys from `config` on read, so any `config.published` field round-trips as `null` and the filter is useless.

```bash
# URL-encoded filter: {"type":"model","manifest":{"published":"true"}}
curl 'https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?pagination=true&keywords=cell,segmentation&filters=%7B%22type%22%3A%22model%22%2C%22manifest%22%3A%7B%22published%22%3A%22true%22%7D%7D'
```

Filter JSON example (URL-encode before sending):

```json
{ "type": "model", "manifest": { "published": "true" } }
```

### Inspect a single model

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/cellpose-lymph-node-segmentation' | jq .
```

The interesting top-level fields are `manifest`, `config`, `created_at`, `last_modified`, `view_count`, `download_count`, `versions` (array of git branches). `git_url` is present on artifacts with `config.storage == "git"`, but if it's missing you can always construct it as `https://hypha.aicell.io/ri-scale/git/<alias>`.

**Canonical "known-good" models for smoke tests:**

| Model | Use for |
|---|---|
| `cellpose-lymph-node-segmentation` | Cleanest README + manifest example to study and imitate (small repo, README-only). |
| `densesimsiam-cryosiam` | Largest repo in the catalogue (~130 MB zip + cover images) — best for exercising the *download* path without needing to upload first. |

For testing the **LFS round-trip specifically** (smudge filter on download), the most reliable path is the upload-then-re-clone roundtrip described in §4: push your own small LFS-tracked binary, then anonymous-clone it back. That's the only path guaranteed to exercise `git lfs install` + the smudge filter end-to-end.

### List files in a model

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/cellpose-lymph-node-segmentation/files/' | jq .items
```

### Fetch the README

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/cellpose-lymph-node-segmentation/files/README.md'
```

---

## 3. Download a model

### Option A — `git clone` (preferred for any model that uses Git LFS)

```bash
git clone https://hypha.aicell.io/ri-scale/git/<alias>
cd <alias>
# LFS files (large weights) are pulled automatically during clone.
# If smudge was skipped, run:
git lfs install
git lfs pull
```

### Option B — direct HTTP download of individual files

```bash
curl -O 'https://hypha.aicell.io/ri-scale/artifacts/<alias>/files/<filename>'
```

The file endpoint serves directly from object storage. Use this when you only need one or two files without the git history (no clone, no LFS step).

---

## 4. Upload a new model (requires an API token)

### Upload pipeline at a glance

There are **two upload modes** — pick one based on whether you want a review
step before the model goes public:

**Mode A — Express (one create call, files appear in catalogue as they're pushed):**
```
create(manifest.published=true) → git push → done
```
Use this when you're confident the files will push cleanly and don't need
a review step. The artifact appears in the public catalogue the moment
`create()` returns (briefly with no files; populated as `git push` lands
seconds later).

**Mode B — Safe (default — two-step, with explicit publish):**
```
create(manifest.published=false) → git push → edit(manifest.published=true) + commit
```
Use this when you want to inspect the result before making it public, or
when uploading takes time and you don't want an empty artifact card to
appear in the catalogue. This is the default the Upload UI uses.

**Either way, the steps below are the same** — only the value of
`manifest.published` at `create()` time and the optional final publish call
differ.

> **A note on `am.publish()`** — there is a separate `publish()` method on
> the artifact-manager. It does NOT control catalogue visibility (that's
> `manifest.published`). `am.publish()` archives the artifact to an
> **external** registry like Zenodo and mints a DOI for permanent
> citation. Most agents don't need it; mention it only if the user asks
> for a DOI or permanent citation handle.

---

The full step-by-step flow: **(a)** create the artifact via the artifact-manager API → **(b)** git clone the resulting empty repo → **(c)** add files, commit, push via git + LFS → **(d)** (Mode B only) flip `manifest.published` to `true` to make it appear in the catalogue.

### 4a. Obtain a token

If the user has not provided one yet, ask them to:

1. Log in at https://modelhub.riscale.eu
2. Go to the **Upload** page (top-right of the navbar, or directly at https://modelhub.riscale.eu/#/upload)
3. Expand the artifact-skill panel at the top of the page, OR scroll to any existing artifact card and use the "Generate authenticated URL" controls — both flows show a row of expiry pills (1 hour / 24 hours / 7 days / 30 days). Pick one, click it, the token appears with a copy button.
4. Copy the token, paste it back to this chat.

Store the token in a local environment variable for the session:

```bash
export HYPHA_TOKEN='<paste here>'
```

### 4b. Create the artifact (artifact-manager REST)

The artifact-manager service is registered in the `public` workspace, so the
REST URL is `https://hypha.aicell.io/public/services/artifact-manager/<method>`.

**Two mandatory fields** that are easy to miss:

- **`parent_id` MUST be the fully qualified id** of the collection
  (`ri-scale/ai-model-hub`), not just the alias — because the token's home
  workspace is your own personal one, and the artifact lives in the cross-
  workspace `ri-scale` namespace.
- **`config.storage: "git"` MUST be set at create time.** Without it the
  artifact has no git endpoint and any later `git clone` returns 404. You
  *cannot* add this flag via `edit()` later — Hypha strips most config
  fields on read/edit. If you forget the flag, the only fix is `delete` +
  recreate.

```bash
# alias must be lowercase, hyphens only, 1–48 chars
ALIAS='my-segmentation-model'

curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/create" \
  -d @- <<EOF
{
  "alias": "$ALIAS",
  "parent_id": "ri-scale/ai-model-hub",
  "type": "model",
  "manifest": {
    "name": "My Segmentation Model",
    "description": "A cell-segmentation model fine-tuned on …",
    "tags": ["segmentation", "microscopy"],
    "license": "Apache-2.0",
    "documentation": "README.md",
    "format_version": "0.1.0",
    "published": false
  },
  "config": { "storage": "git" },
  "stage": false
}
EOF
```

The response is the full artifact JSON. The useful fields:

| Field | Use |
|---|---|
| `id` | full id, e.g. `ri-scale/my-segmentation-model` — used by edit / commit / delete |
| `alias` | the short alias |
| `git_url` | the git endpoint to clone + push to in step 4c (returned by `create`, may not be in subsequent reads — construct it as `https://hypha.aicell.io/ri-scale/git/<alias>` if absent) |
| `manifest.published` | will be `false` — gets flipped to `true` in step 4d |

The artifact is created as a **draft** (`manifest.published: false`). It will NOT appear in the public catalogue until you publish it in step 4d.

Alternative: use the `hypha-rpc` Python client if the user prefers Python:

```python
from hypha_rpc import connect_to_server
import asyncio

async def create():
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": "<paste token>",
    })
    am = await server.get_service("public/artifact-manager")
    a = await am.create(
        alias="my-segmentation-model",
        parent_id="ri-scale/ai-model-hub",   # full id, not just alias
        type="model",
        manifest={
            "name": "My Segmentation Model",
            "description": "…",
            "tags": ["segmentation", "microscopy"],
            "license": "Apache-2.0",
            "documentation": "README.md",
            "published": False,    # draft until you publish in step 4d
        },
        config={"storage": "git"},
        stage=False,
    )
    print(a.id, a.git_url)

asyncio.run(create())
```

### 4c. Git push (with LFS for large weights)

**Auth scheme for the git endpoint** is HTTP Basic, with:

- **Username:** the literal string `git` — NOT your email, NOT `x`, NOT the token itself.
- **Password:** your Hypha API token from §4a.

Three equivalent ways to pass these — Option B (askpass) is the most robust because it works around the macOS-credential-helper pitfall described below:

```bash
# Option A — embed in the URL (quick, but token leaks into error messages + shell history):
git clone "https://git:$HYPHA_TOKEN@hypha.aicell.io/ri-scale/git/$ALIAS"

# Option B — GIT_ASKPASS so the token never lands in URL, history, or git config
#            (preferred — also bypasses the macOS keychain trap below):
printf '#!/bin/sh\necho "$HYPHA_TOKEN"\n' > /tmp/askpass.sh && chmod +x /tmp/askpass.sh
GIT_ASKPASS=/tmp/askpass.sh git -c credential.helper= \
  clone "https://git@hypha.aicell.io/ri-scale/git/$ALIAS"
```

**macOS keychain trap — read this if `git push` returns "Authentication failed":**
On macOS, the default `credential.helper=osxkeychain` hijacks the Basic-Auth
exchange: it serves a stale cached credential, gets rejected, runs `erase`,
and never falls back to `GIT_ASKPASS`. The error message is a flat
"Authentication failed" with NO hint that your real token was never tried.
Fix: pass `-c credential.helper=` on every git invocation (Option B above
does this) to disable the helper for that command.

**Do NOT use `http.extraHeader` to inject the token.** It's the natural
workaround for the macOS issue, but it backfires: the header sticks to the
presigned S3 LFS upload URLs that already carry their own `X-Amz-*` query
auth → S3 rejects with HTTP 403 "multiple auth mechanisms", and the error
message points away from the actual cause. Use askpass instead.

Continuing with Option A for brevity:

```bash
git clone "https://git:$HYPHA_TOKEN@hypha.aicell.io/ri-scale/git/$ALIAS"
cd "$ALIAS"

# Configure LFS for binary weight formats
git lfs install
git lfs track "*.pt" "*.ckpt" "*.h5" "*.pkl" "*.pth" "*.safetensors" "*.bin"
git add .gitattributes

# Add documentation + metadata + weights
cat > README.md <<'EOF'
# My Segmentation Model

…
EOF

cat > rdf.yaml <<'EOF'
type: model
format_version: 0.5.0
name: My Segmentation Model
description: …
authors:
  - name: User Name
    affiliation: Their Lab
license: Apache-2.0
tags: [segmentation, microscopy]
documentation: README.md
EOF

# Drop the weights into the repo:
cp /path/to/weights.pt .

# Set git identity if it's not already configured (fresh containers won't have one)
git config user.email "you@example.com"
git config user.name "Your Name"

git add README.md rdf.yaml weights.pt
git commit -m "Initial upload"

# IMPORTANT: server only accepts branch 'main'. Linux git defaults to
# 'master', so rename before pushing or the push fails with
# "src refspec main does not match any":
git branch -M main

git push -u origin main
```

### 4d. Publish the artifact

After files are pushed, the artifact is still a draft. To list it in the public catalogue, you must update **`manifest.published`** (NOT `config.published` — Hypha strips that on read, so it'll silently not work). The pattern is `edit` (with `stage: true`) then `commit`. Crucially, **pass the FULL manifest** in the edit call — Hypha treats it as a replacement, not a merge:

```bash
# Fetch current manifest first so we don't drop other fields
CURRENT_MANIFEST=$(curl -fsS "https://hypha.aicell.io/ri-scale/artifacts/$ALIAS" | jq -c '.manifest + {published: true}')

curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/edit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"manifest\":$CURRENT_MANIFEST,\"stage\":true}"

curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/commit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\"}"
```

**Verify it landed** — re-read the artifact and confirm `manifest.published == true` before assuming success:

```bash
curl -fsS "https://hypha.aicell.io/ri-scale/artifacts/$ALIAS" | jq '.manifest.published'
# expect: true
```

The model will appear at `https://modelhub.riscale.eu/#/artifacts/$ALIAS` and in the public catalogue within seconds.

### 4e. Unpublish (return to draft)

Same as 4d but with `published: false`. The artifact stays alive and the URL still works for the owner; it is just hidden from the public catalogue.

### 4f. Delete an artifact

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/delete" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"delete_files\":true}"
```

Only the artifact's creator can delete it. Other authenticated users get a permission error.

---

## 5. Common gotchas

- **`git branch -M main` is mandatory** before the first push. The server only accepts `main`. Linux git defaults to `master`; without the rename the push fails with `src refspec main does not match any`.
- **LFS upload requires `git lfs install` + `git lfs track`** before the first `git add` of a binary. If you add a binary first then track it, it will be committed as a plain file.
- **Token URL hygiene**: `https://git:$HYPHA_TOKEN@hypha.aicell.io/...` works for git, but the token is echoed back in error messages. Prefer `git config credential.helper` or environment-based auth for long sessions; in chat, never paste the full URL back to the user.
- **Alias naming**: lowercase letters, digits, and hyphens; max 48 chars; must not collide with an existing alias under `ai-model-hub`. Pick something descriptive (`cellpose-lymph-node-segmentation`, not `model-v4`).
- **Drafts are creator-only in the catalogue**: a draft artifact (`manifest.published: false`) is not listed in the public catalogue, but its files may still be readable if someone has the URL. Treat drafts as semi-private, not secret.
- **`manifest.published` must live on the manifest, not config.** Hypha silently strips non-allowlisted keys from `config` on read, so `config.published` round-trips as `null` and the catalogue filter sees everything. Always update + read `manifest.published`.
- **`manifest.published` value semantics — string `"true"` is the safe default.** The stored value can be a Python `True`, JSON `true`, or the string `"true"` — all three persist and round-trip. But when you build the catalogue filter, you MUST send the literal string `"true"` (`{"manifest":{"published":"true"}}`): Hypha coerces both sides to strings for comparison, and a JSON boolean filter silently returns zero items even when the data is there. To save mental cycles, just write the string `"true"` everywhere — at create, at edit, and at query — and you'll never hit the mismatch.
- **`edit` replaces the manifest, doesn't merge** — when updating `manifest.published`, first GET the artifact's current manifest and re-send it whole with the flipped flag. Otherwise other fields (name, description, tags) get blown away.
- **The server-side LFS-locking warning is harmless** — `git push` against an LFS-tracked file prints a warning saying the remote does not support the LFS locking API. Ignore it; the push still completes.
- **`delete` response is the literal `null`** with HTTP 200 — don't parse it as a structured ack. After delete, the artifact's REST endpoint returns 404 but the git endpoint may return 401 (not 404). Both indicate the artifact is gone.
- **Git identity is required for `git commit`** — fresh containers / CI environments have no `user.email` / `user.name`. Set them locally before the first commit:
  ```bash
  git config user.email "you@example.com"
  git config user.name "Your Name"
  ```
- **The listing endpoint returns two shapes** — bare array without `pagination=true`, paginated `{items, total, offset, limit}` wrapper with it. Use `pagination=true` consistently if you want to write a `jq .items[]` pipeline.
- **`git clone --depth=N` (shallow clone) requires Hypha ≥ 0.21.103.** Earlier versions reject the shallow negotiation (`fatal: expected shallow/unshallow, got NAK` on ≤0.21.101; `fatal: git fetch-pack: expected shallow list` on 0.21.102, especially for single-commit repos). If you hit either error, fall back to a full clone — repos are git-pack-bounded so this is cheap, and LFS blobs download separately via the smudge filter regardless of shallow/full.
- **Permissions for delete**: the ai-model-hub collection grants `@` (any authenticated user) broad permissions, but Hypha enforces creator-only delete at the artifact level — a malicious authenticated user cannot wipe other people's models.

---

## 6. Worked example: end-to-end upload

```bash
export HYPHA_TOKEN='<paste>'
ALIAS='widget-detector-2026'

# Step 1 — create the artifact (draft). Note the FULL parent_id and the
# /public/services/artifact-manager/ URL prefix.
curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/create" \
  -d "{\"alias\":\"$ALIAS\",\"parent_id\":\"ri-scale/ai-model-hub\",\"type\":\"model\",\"manifest\":{\"name\":\"Widget Detector 2026\",\"description\":\"YOLOv9 fine-tune for industrial widget detection.\",\"tags\":[\"object-detection\",\"yolo\"],\"license\":\"Apache-2.0\",\"documentation\":\"README.md\",\"published\":false},\"config\":{\"storage\":\"git\"},\"stage\":false}"

# Step 2 — git push
git clone "https://git:$HYPHA_TOKEN@hypha.aicell.io/ri-scale/git/$ALIAS"
cd "$ALIAS"
git lfs install
git lfs track "*.pt"
git add .gitattributes
echo "# Widget Detector 2026" > README.md
cp ~/yolov9-widgets.pt .
git config user.email "you@example.com"  # fresh containers need an identity
git config user.name "Your Name"
git add README.md yolov9-widgets.pt
git commit -m "Initial upload"
git branch -M main
git push -u origin main

# Step 3 — publish (set manifest.published=true, NOT config.published)
M=$(curl -fsS "https://hypha.aicell.io/ri-scale/artifacts/$ALIAS" | jq -c '.manifest + {published: true}')
curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/edit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"manifest\":$M,\"stage\":true}"

curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/public/services/artifact-manager/commit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\"}"

# Verify it landed
curl -fsS "https://hypha.aicell.io/ri-scale/artifacts/$ALIAS" | jq '.manifest.published'
echo "Live at https://modelhub.riscale.eu/#/artifacts/$ALIAS"
```

---

## 7. Agent etiquette when operating on behalf of a user

- Confirm the alias and manifest with the user **before** creating the artifact.
- Confirm before publishing, deleting, or unpublishing — these are visible/irreversible actions.
- When you cannot proceed because the user has not provided a token, explain *exactly* where to get one: **modelhub.riscale.eu → user menu → "Generate API key"** — and what scope/expiry to pick. Do not invent a token, do not assume the user has one, and do not store the token across sessions.
- Prefer the REST examples in this file (curl) over hand-built RPC calls — they are tested and stable.
- Pre-populate the manifest with sensible defaults (`license`, `tags`, `documentation: README.md`) so the artifact looks like a real registered model rather than a placeholder.
