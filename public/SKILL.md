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
| Single model metadata | `https://hypha.aicell.io/ri-scale/artifacts/<alias>` |
| Single model files | `https://hypha.aicell.io/ri-scale/artifacts/<alias>/files/` |
| Single model file content | `https://hypha.aicell.io/ri-scale/artifacts/<alias>/files/<filename>` |
| Git repo (read + write) | `https://hypha.aicell.io/ri-scale/git/<alias>` |
| Public Model Hub page | `https://modelhub.riscale.eu/#/artifacts/ri-scale/<alias>` |

Each model artifact has:

- A short URL-safe **alias** (lowercase + hyphens), e.g. `cellpose-lymph-node-segmentation`.
- A **manifest** with at least `name`, `description`, `type: model`, and ideally `tags`, `license`, `authors`, `documentation: README.md`.
- A `config.storage: "git"` flag (the storage backend) and a `config.published: bool` flag (visibility in the public catalogue).
- A git repository with at least a `README.md` (the documentation) and ideally an `rdf.yaml` (BioImage Model Zoo–style metadata).
- Optional: an `rdf.yaml`, `.gitattributes` configuring Git LFS, weight files (`*.pt`, `*.ckpt`, `*.h5`, `*.safetensors`, `*.pth`, `*.bin`), cover images, and citation files.

---

## 2. Search and browse (no auth)

### List all models in the public catalogue

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?pagination=true&offset=0&limit=20&order_by=last_modified>'
```

Returns `{ items: [...], total: N, offset, limit }`. Each item has `alias`, `manifest.name`, `manifest.description`, `manifest.tags`, `type`, etc.

### Keyword + filter search

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?keywords=cell,segmentation&filters=%7B%22type%22%3A%22model%22%2C%22config%22%3A%7B%22published%22%3Atrue%7D%7D'
```

Filter JSON example (URL-encode before sending):

```json
{ "type": "model", "config": { "published": true } }
```

### Inspect a single model

```bash
curl 'https://hypha.aicell.io/ri-scale/artifacts/cellpose-lymph-node-segmentation' | jq .
```

The interesting top-level fields are `manifest`, `git_url`, `config`, `created_at`, `last_modified`, `view_count`, `download_count`, `versions` (array of git branches).

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

The flow is: **(a)** create the artifact via the artifact-manager API → **(b)** git clone the resulting empty repo → **(c)** add files, commit, push via git + LFS → **(d)** publish the artifact so it appears in the public catalogue.

### 4a. Obtain a token

If the user has not provided one yet, ask them to:

1. Open https://modelhub.riscale.eu
2. Click their avatar / user menu → **"Generate API key"**
3. Pick an expiry, click generate, copy the token, paste it back to this chat.

Store the token in a local environment variable for the session:

```bash
export HYPHA_TOKEN='<paste here>'
```

### 4b. Create the artifact (artifact-manager REST)

```bash
# alias must be lowercase, hyphens only, 1–48 chars
ALIAS='my-segmentation-model'

curl -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/create" \
  -d @- <<EOF
{
  "alias": "$ALIAS",
  "parent_id": "ai-model-hub",
  "type": "model",
  "manifest": {
    "name": "My Segmentation Model",
    "description": "A cell-segmentation model fine-tuned on …",
    "tags": ["segmentation", "microscopy"],
    "license": "Apache-2.0",
    "documentation": "README.md",
    "format_version": "0.1.0"
  },
  "config": { "storage": "git", "published": false },
  "stage": false
}
EOF
```

The artifact is created as a **draft** (`config.published: false`). It will NOT appear in the public catalogue until you publish it in step 4d.

Alternative: use the `hypha-rpc` Python client if the user prefers Python:

```python
from hypha_rpc import connect_to_server
import asyncio

async def create():
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": "<paste token>",
        "workspace": "ri-scale",
    })
    am = await server.get_service("public/artifact-manager")
    a = await am.create(
        alias="my-segmentation-model",
        parent_id="ai-model-hub",
        type="model",
        manifest={
            "name": "My Segmentation Model",
            "description": "…",
            "tags": ["segmentation", "microscopy"],
            "license": "Apache-2.0",
            "documentation": "README.md",
        },
        config={"storage": "git", "published": False},
        stage=False,
    )
    print(a.id, a.git_url)

asyncio.run(create())
```

### 4c. Git push (with LFS for large weights)

```bash
# Clone the empty repo (use the auth URL — username is literally 'git')
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

git add README.md rdf.yaml weights.pt
git commit -m "Initial upload"

# IMPORTANT: server only accepts branch 'main'. Linux git defaults to
# 'master', so rename before pushing or the push fails with
# "src refspec main does not match any":
git branch -M main

git push -u origin main
```

### 4d. Publish the artifact

After files are pushed, the artifact is still a draft. To list it in the public catalogue:

```bash
curl -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/edit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"config\":{\"storage\":\"git\",\"published\":true},\"stage\":true}"

curl -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/commit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\"}"
```

The model will appear at `https://modelhub.riscale.eu/#/artifacts/ri-scale/$ALIAS` and in the public catalogue within seconds.

### 4e. Unpublish (return to draft)

Same as 4d but with `"published": false`. The artifact stays alive and the URL still works for the owner; it is just hidden from the public catalogue.

### 4f. Delete an artifact

```bash
curl -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/delete" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"delete_files\":true}"
```

Only the artifact's creator can delete it. Other authenticated users get a permission error.

---

## 5. Common gotchas

- **`git branch -M main` is mandatory** before the first push. The server only accepts `main`. Linux git defaults to `master`; without the rename the push fails with `src refspec main does not match any`.
- **LFS upload requires `git lfs install` + `git lfs track`** before the first `git add` of a binary. If you add a binary first then track it, it will be committed as a plain file.
- **Token URL hygiene**: `https://git:$HYPHA_TOKEN@hypha.aicell.io/...` works for git, but the token is echoed back in error messages. Prefer `git config credential.helper` or environment-based auth for long sessions; in chat, never paste the full URL back to the user.
- **Alias naming**: lowercase letters, digits, and hyphens; max 48 chars; must not collide with an existing alias under `ai-model-hub`. Pick something descriptive (`cellpose-lymph-node-segmentation`, not `model-v4`).
- **Drafts are creator-only**: a draft artifact (`config.published: false`) is not listed in the public catalogue but its files may still be readable if someone has the URL. Treat drafts as semi-private, not secret.
- **Permissions for delete**: the ai-model-hub collection grants `@` (any authenticated user) broad permissions, but Hypha enforces creator-only delete at the artifact level — a malicious authenticated user cannot wipe other people's models.

---

## 6. Worked example: end-to-end upload

```bash
export HYPHA_TOKEN='<paste>'
ALIAS='widget-detector-2026'

# Step 1 — create the artifact (draft)
curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/create" \
  -d "{\"alias\":\"$ALIAS\",\"parent_id\":\"ai-model-hub\",\"type\":\"model\",\"manifest\":{\"name\":\"Widget Detector 2026\",\"description\":\"YOLOv9 fine-tune for industrial widget detection.\",\"tags\":[\"object-detection\",\"yolo\"],\"license\":\"Apache-2.0\",\"documentation\":\"README.md\"},\"config\":{\"storage\":\"git\",\"published\":false},\"stage\":false}"

# Step 2 — git push
git clone "https://git:$HYPHA_TOKEN@hypha.aicell.io/ri-scale/git/$ALIAS"
cd "$ALIAS"
git lfs install
git lfs track "*.pt"
git add .gitattributes
echo "# Widget Detector 2026" > README.md
cp ~/yolov9-widgets.pt .
git add README.md yolov9-widgets.pt
git commit -m "Initial upload"
git branch -M main
git push -u origin main

# Step 3 — publish
curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/edit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\",\"config\":{\"storage\":\"git\",\"published\":true},\"stage\":true}"

curl -fsS -X POST \
  -H "Authorization: Bearer $HYPHA_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://hypha.aicell.io/ri-scale/artifact-manager/commit" \
  -d "{\"artifact_id\":\"ri-scale/$ALIAS\"}"

echo "Live at https://modelhub.riscale.eu/#/artifacts/ri-scale/$ALIAS"
```

---

## 7. Agent etiquette when operating on behalf of a user

- Confirm the alias and manifest with the user **before** creating the artifact.
- Confirm before publishing, deleting, or unpublishing — these are visible/irreversible actions.
- When you cannot proceed because the user has not provided a token, explain *exactly* where to get one: **modelhub.riscale.eu → user menu → "Generate API key"** — and what scope/expiry to pick. Do not invent a token, do not assume the user has one, and do not store the token across sessions.
- Prefer the REST examples in this file (curl) over hand-built RPC calls — they are tested and stable.
- Pre-populate the manifest with sensible defaults (`license`, `tags`, `documentation: README.md`) so the artifact looks like a real registered model rather than a placeholder.
