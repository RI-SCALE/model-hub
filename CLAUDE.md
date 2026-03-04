# Model Hub - CLAUDE.md

## Project Overview

**RI-SCALE Model Hub** is a full-stack web application for browsing, uploading, and interacting with scientific models and datasets (artifacts). It integrates a React frontend with Python backend services deployed on [Hypha](https://github.com/amun-ai/hypha) infrastructure.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript 5.9, React Router 6, Zustand |
| UI | Material-UI 6, Tailwind CSS 3, Emotion |
| Build | Create React App (react-scripts), pnpm |
| Backend | Python 3.11 async service (chat-proxy-app/) |
| LLM Integration | OpenAI API (chat completions) |
| Platform | Hypha (artifact storage, auth, app hosting) |
| Testing | Jest + React Testing Library, Playwright (E2E) |
| CI/CD | GitHub Actions → GitHub Pages + Hypha |

## Repository Structure

```
model-hub/
├── src/
│   ├── components/       # Reusable React components
│   ├── pages/            # Page-level components (AgentPage, ArtifactDetails, Edit, Upload)
│   ├── hooks/            # Custom hooks (useKernel, useBookmarks)
│   ├── store/            # Zustand state (hyphaStore.ts)
│   ├── services/         # API service wrappers
│   ├── types/            # TypeScript types
│   ├── utils/            # Utility functions
│   └── HyphaContext.tsx  # Hypha backend provider
├── chat-proxy-app/
│   └── app.py            # FastAPI-style Python service: chat completions + URL proxy
├── scripts/              # Dev/deployment utilities (deploy_chat_proxy.py, diagnose_hub.py, etc.)
├── docs/                 # Documentation (chat-proxy-cicd.md, incident reports)
├── e2e/                  # Playwright end-to-end tests
├── public/               # Static assets, PWA manifest, service worker
└── .github/workflows/    # CI/CD pipeline definitions
```

## Key Commands

```bash
# Development
npm start                   # Start dev server (injects branch env via with-branch-env.js)
npm run build               # Production build + copy docs

# Testing
npm test                    # Jest unit tests
npm run test:e2e            # Playwright E2E tests (headless)
npm run test:e2e:headed     # Playwright E2E tests (visible browser)

# Python (scripts/)
python scripts/deploy_chat_proxy.py     # Deploy/update chat-proxy Hypha app
python scripts/test_chat_proxy.py       # Health check chat-proxy
python scripts/diagnose_hub.py          # Inspect hub config + permissions
python scripts/fix_hub_permissions.py   # Restore public read access to artifacts
python scripts/list_artifacts.py        # List all artifacts
python scripts/upload_sample.py         # Upload a sample artifact for testing
```

## Key Source Files

| File | Size | Purpose |
|------|------|---------|
| `src/pages/AgentPage.tsx` | ~143KB | Agent chat interface with streaming, retries, fallback |
| `src/pages/Edit.tsx` | ~95KB | Artifact editing with RDF metadata support |
| `src/pages/Upload.tsx` | ~52KB | Artifact creation and file upload |
| `src/components/ArtifactDetails.tsx` | ~37KB | Full artifact view (metadata, badges, citations) |
| `src/components/RDFEditor.tsx` | ~34KB | RDF metadata editor |
| `chat-proxy-app/app.py` | — | Chat proxy: `setup()`, `chat_completion()`, `resolve_url()` |

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR to main | Typecheck, unit tests, E2E smoke tests, Python tests |
| `deploy.yml` | Push to main | Build + deploy frontend to GitHub Pages |
| `chat-proxy-dev.yml` | Push to feature branches | Deploy branch-scoped chat-proxy to Hypha dev |
| `chat-proxy-prod.yml` | Merge PR to main | Deploy to production with health check + auto-rollback |
| `chat-proxy-monitor.yml` | Every 15 min (cron) | Health monitoring with Slack alerts |

## Architecture Notes

### Hypha Integration
- All artifact storage, auth, and app hosting runs on Hypha
- Frontend connects via `hypha-rpc` (see `src/HyphaContext.tsx` and `src/store/hyphaStore.ts`)
- Chat proxy deployed as a Hypha app (app ID pattern: `chat-proxy[-dev-<branch-slug>]`)

### Chat Proxy
- Injects OpenAI API keys server-side so they never reach the browser
- `resolve_url()` endpoint acts as a safe HTTP proxy with allowlist validation
- Dev apps are per-branch; prod app auto-rolls back on health check failure

### Agent Architecture
- `AgentPage.tsx` is agent-agnostic: passes messages, handles retries and fallbacks
- Currently limited to the **BioImage Finder** agent in the dropdown
- Agent startup scripts live in `scripts/agent_startup_scripts/`

### Theming
- RI-SCALE orange: `#f39200` (configured in `tailwind.config.js`)
- MUI and Tailwind are used together; prefer Tailwind for layout, MUI for interactive widgets

## Environment & Configuration

- **Branch injection:** `scripts/with-branch-env.js` injects `REACT_APP_BRANCH` at build time
- **Tailwind config:** `tailwind.config.js` — custom color palette
- **TypeScript:** `tsconfig.json` — `baseUrl: "src"` for absolute imports
- **E2E:** `playwright.config.ts` — Chrome at 1366×900, targets localhost dev server

## External Dependencies

- **Hypha** — backend platform (artifact store, app hosting, authentication)
- **OpenAI API** — LLM chat completions via chat-proxy
- **BioImage Archive** — scientific image data source for BioImage Finder agent
- **GitHub Pages** — static frontend hosting
