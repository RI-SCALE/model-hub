#!/usr/bin/env python3
"""
Security test: ensure only the user who uploaded a model can delete it.

The ai-model-hub collection grants `@` (any authenticated user) broad
permissions, including `create`, `commit`, `edit`, and (literally) `delete`.
This makes contributor onboarding easy — but it would be catastrophic if a
random authenticated user could wipe another user's artifact. This script
validates the actual enforcement on the live server.

Scenarios tested against https://hypha.aicell.io:

  1. Anonymous user tries to delete an artifact owned by Wei → MUST fail.
  2. A different authenticated user (env var CONTRIBUTOR_TOKEN) tries to
     delete an artifact owned by Wei → MUST fail.
  3. The artifact's creator deletes their own artifact → MUST succeed.

The test creates a tiny throw-away artifact under ai-model-hub as a draft
(config.published=false, so it never appears in the public catalogue),
runs the deletes, then cleans up.

Exit code: 0 if all assertions hold, 1 otherwise.

Usage:
  HYPHA_TOKEN=<owner_token> \\
  CONTRIBUTOR_TOKEN=<another_user_jwt> \\
  python scripts/test_artifact_delete_security.py

If CONTRIBUTOR_TOKEN is not set, scenario (2) is skipped with a warning
(the anonymous test in (1) still runs).
"""
import os
import sys
import uuid
import asyncio
import traceback
from hypha_rpc import connect_to_server


WORKSPACE = "ri-scale"
PARENT_COLLECTION = "ai-model-hub"
SERVER_URL = "https://hypha.aicell.io"


async def setup_artifact_as_owner(owner_token: str):
    """Create a draft artifact under ai-model-hub. Return (artifact_id, tok_rw)."""
    bootstrap = await connect_to_server({
        "server_url": SERVER_URL,
        "token": owner_token,
    })
    tok_rw = await bootstrap.generate_token({
        "workspace": WORKSPACE,
        "permission": "read_write",
        "expires_in": 900,
    })
    await bootstrap.disconnect()

    owner = await connect_to_server({
        "server_url": SERVER_URL,
        "token": tok_rw,
        "workspace": WORKSPACE,
    })
    am = await owner.get_service("public/artifact-manager")
    alias = f"sec-test-{uuid.uuid4().hex[:8]}"
    a = await am.create(
        alias=alias,
        parent_id=PARENT_COLLECTION,
        type="model",
        manifest={"name": f"Security test ({alias}) — auto-deleted"},
        config={"storage": "git", "published": False},
        stage=True,
    )
    await am.commit(artifact_id=a.id)
    await owner.disconnect()
    return a.id, tok_rw


async def try_delete(label: str, token: str | None, artifact_id: str) -> str:
    """Try to delete artifact_id with the given token. Return 'OK — denied',
    'GAP — delete succeeded', or 'ERROR — <details>'."""
    cfg = {"server_url": SERVER_URL}
    if token is not None:
        cfg["token"] = token
    try:
        s = await connect_to_server(cfg)
    except Exception as e:
        return f"ERROR — could not connect: {e}"

    if token is not None:
        u = s.config.user
        print(f"  identity: id={u.get('id')}, "
              f"email={u.get('email')}, roles={u.get('roles')}")
    else:
        print(f"  identity: anonymous")

    am = await s.get_service("public/artifact-manager")
    try:
        await am.delete(artifact_id=artifact_id, delete_files=True)
        outcome = "GAP — delete succeeded"
    except Exception as e:
        outcome = "OK — denied"
        print(f"  denial: {type(e).__name__}: {str(e)[:160]}")
    finally:
        await s.disconnect()
    return outcome


async def owner_delete_cleanup(owner_tok_rw: str, artifact_id: str) -> str:
    s = await connect_to_server({
        "server_url": SERVER_URL,
        "token": owner_tok_rw,
        "workspace": WORKSPACE,
    })
    am = await s.get_service("public/artifact-manager")
    try:
        await am.delete(artifact_id=artifact_id, delete_files=True)
        outcome = "OK — succeeded"
    except Exception as e:
        outcome = f"FAIL — {e}"
    await s.disconnect()
    return outcome


async def main() -> int:
    owner_tok = os.environ.get("HYPHA_TOKEN")
    if not owner_tok:
        print("HYPHA_TOKEN not set — cannot run.")
        return 2
    contributor_tok = os.environ.get("CONTRIBUTOR_TOKEN")

    print("Creating draft artifact under ai-model-hub as the owner …")
    artifact_id, owner_tok_rw = await setup_artifact_as_owner(owner_tok)
    print(f"  -> {artifact_id}\n")

    results = {}

    print("=" * 62)
    print("TEST 1: anonymous tries to delete the owner's artifact")
    print("=" * 62)
    results["anonymous"] = await try_delete("anon", None, artifact_id)

    print()
    print("=" * 62)
    print("TEST 2: another authenticated user tries to delete the artifact")
    print("=" * 62)
    if contributor_tok:
        results["other_user"] = await try_delete("other", contributor_tok, artifact_id)
    else:
        print("  CONTRIBUTOR_TOKEN not set — SKIPPED.")
        results["other_user"] = "SKIPPED — set CONTRIBUTOR_TOKEN to enable"

    print()
    print("=" * 62)
    print("TEST 3 / CLEANUP: artifact's creator deletes their own artifact")
    print("=" * 62)
    results["owner_delete"] = await owner_delete_cleanup(owner_tok_rw, artifact_id)
    print(f"  -> {results['owner_delete']}")

    print()
    print("=" * 62)
    print("SUMMARY")
    print("=" * 62)
    for k, v in results.items():
        print(f"  {k:14s}: {v}")

    required = (
        results["anonymous"].startswith("OK")
        and results["owner_delete"].startswith("OK")
        and (results["other_user"].startswith(("OK", "SKIPPED")))
    )
    other_passed_if_run = (
        not contributor_tok
        or results["other_user"].startswith("OK")
    )
    verdict_pass = required and other_passed_if_run

    print()
    if verdict_pass:
        if not contributor_tok:
            print("VERDICT: PASS (with TEST 2 skipped — provide CONTRIBUTOR_TOKEN "
                  "to fully cover cross-contributor isolation).")
        else:
            print("VERDICT: PASS — only the artifact creator can delete it.")
        return 0
    else:
        print("VERDICT: FAIL — security gap detected.")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
