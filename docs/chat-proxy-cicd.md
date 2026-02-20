# Chat Proxy CI/CD Blueprint (Reusable)

This document describes the deployment/testing setup for Hypha chat-proxy apps with strict **dev vs production** separation.

## Goals

- Never use `chat-proxy` for development testing.
- Use branch-isolated development app IDs (`chat-proxy-dev-<branch>`).
- Use only `chat-proxy` in production.
- Run tests on every commit.
- Monitor production health and auto-rollback on failure.

## What Was Added

### Workflows

- `.github/workflows/ci.yml`
  - Runs on every push/PR.
  - Runs:
    - Typecheck: `pnpm tsc --noEmit`
    - Unit tests: `CI=true pnpm test --watchAll=false --passWithNoTests`
    - E2E smoke: `e2e/navigation.spec.ts`
    - Python unit tests: `python -m unittest discover -s scripts/tests -p "test_*.py"`

- `.github/workflows/chat-proxy-dev.yml`
  - Runs on push to non-main branches.
  - Computes branch-specific app IDs:
    - `chat-proxy-dev-<branch-slug>`
    - `chat-proxy-dev-dummy-<branch-slug>`
  - Deploys dummy proxy app and health-checks it.
  - Deploys real dev proxy app and health-checks it.
  - Runs integration e2e (`e2e/agent-chat-timeout.spec.ts`) with `REACT_APP_CHAT_PROXY_APP_ID` set to the branch app ID.

- `.github/workflows/chat-proxy-prod.yml`
  - Runs when PR to `main` is merged, or manually.
  - Deploys production app id `chat-proxy`.
  - Health checks deployment.
  - If deploy fails, rolls back to previous commit (`HEAD~1`) and redeploys.
  - Cleans up merged branch dev apps (`chat-proxy-dev-*`, `chat-proxy-dev-dummy-*`).

- `.github/workflows/chat-proxy-monitor.yml`
  - Scheduled health monitor (every 15 minutes) for production app `chat-proxy`.
  - On failure, rolls back to previous commit and rechecks health.

### Scripts and Utilities

- `scripts/deploy_chat_proxy.py`
  - Supports:
    - `--app-id`
    - `--source`
    - `--manifest`
    - `--skip-start`
    - `--health-check`
    - `--model`
    - `--expected-substring`

- `scripts/test_chat_proxy.py`
  - Health check script with strict exit codes for CI.
  - Supports configurable app ID and token source.

- `scripts/chat_proxy_utils.py`
  - Branch slug sanitization and deterministic branch app ID generation.
  - Service alias candidate generation.

- `scripts/tests/test_chat_proxy_utils.py`
  - Python unit tests for app ID and service-id generation logic.

- `chat-proxy-app/dummy_app.py`
  - Dummy proxy app for integration pipeline validation.

### Frontend Proxy Resolution

- `src/pages/AgentPage.tsx` now reads `REACT_APP_CHAT_PROXY_APP_ID`.
- Default behavior is dev-safe (`chat-proxy-dev`) and resolves only `ri-scale/default@<appId>`.
- GitHub Pages production build explicitly sets `REACT_APP_CHAT_PROXY_APP_ID=chat-proxy`.

## Required GitHub Secrets

Set these at repository level:

- `HYPHA_SERVER_URL` (e.g., `https://hypha.aicell.io`)
- `HYPHA_WORKSPACE` (e.g., `ri-scale`)
- `HYPHA_TOKEN` (token with install/start/stop/uninstall permissions for target apps)

## Naming Convention

- Production app: `chat-proxy`
- Dev branch app: `chat-proxy-dev-<branch-slug>`
- Dev dummy app: `chat-proxy-dev-dummy-<branch-slug>`

Branch slug format:

- lowercase
- `/` and `_` converted to `-`
- non `[a-z0-9-]` replaced by `-`
- repeated `-` collapsed
- total app id length capped to 63 chars

## How to Adopt in Other Repos

1. Copy these files and adjust paths if needed:
   - `.github/workflows/ci.yml`
   - `.github/workflows/chat-proxy-dev.yml`
   - `.github/workflows/chat-proxy-prod.yml`
   - `.github/workflows/chat-proxy-monitor.yml`
   - `scripts/deploy_chat_proxy.py`
   - `scripts/test_chat_proxy.py`
   - `scripts/chat_proxy_utils.py`
   - `scripts/tests/test_chat_proxy_utils.py`
   - Optional: `chat-proxy-app/dummy_app.py`

2. Replace app naming prefix if your project needs another base id:
   - `chat-proxy-dev` / `chat-proxy-dev-dummy`

3. Ensure your frontend reads `REACT_APP_CHAT_PROXY_APP_ID` and resolves service IDs using this app ID.

4. In your production build workflow, set:
   - `REACT_APP_CHAT_PROXY_APP_ID=<production-app-id>`

5. Configure the required GitHub secrets.

6. Validate manually once:
   - Trigger `chat-proxy-dev` on a feature branch.
   - Verify e2e tests pass.
   - Merge a PR to `main` and verify production deploy + branch cleanup.

## Operational Notes

- Rollback strategy is source-based (`HEAD~1`) and intended as fast recovery.
- For stricter rollback guarantees, store release artifacts (source + manifest) externally and redeploy from immutable release bundles.
- Health checks currently validate `chat_completion` is callable and returns a valid response structure.
