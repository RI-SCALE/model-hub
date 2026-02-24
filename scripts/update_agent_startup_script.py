import argparse
import asyncio
import os
from pathlib import Path
from typing import Any, Dict

from hypha_rpc import connect_to_server


def _extract_manifest(payload: Dict[str, Any]) -> Dict[str, Any]:
    manifest = payload.get("manifest")
    if isinstance(manifest, dict):
        return manifest
    return dict(payload)


def _load_env_file(env_path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not env_path.exists():
        return values

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        values[key] = value
    return values


def _resolve_token(token_arg: str | None, env_file: Path) -> str:
    if token_arg:
        return token_arg

    env_values = _load_env_file(env_file)
    token = env_values.get("HYPHA_AGENTS_TOKEN") or env_values.get("HYPHA_TOKEN")
    if token:
        return token

    token = os.environ.get("HYPHA_AGENTS_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if token:
        return token

    raise ValueError(
        "A token is required. Provide --token, set HYPHA_AGENTS_TOKEN/HYPHA_TOKEN, "
        "or include HYPHA_AGENTS_TOKEN in chat-proxy-app/.env."
    )


async def _run(args: argparse.Namespace) -> None:
    env_file_path = Path(args.env_file).resolve()
    token = _resolve_token(args.token, env_file_path)

    startup_script_path = Path(args.startup_script).resolve()
    if not startup_script_path.exists():
        raise FileNotFoundError(f"Startup script file not found: {startup_script_path}")

    startup_script = startup_script_path.read_text(encoding="utf-8")

    server = await connect_to_server(
        {
            "name": "startup-script-updater",
            "server_url": args.server_url,
            "token": token,
        }
    )
    artifact_manager = await server.get_service("public/artifact-manager")

    try:
        artifact = await artifact_manager.get(args.artifact_id)
    except Exception:
        artifact = await artifact_manager.read(args.artifact_id)

    manifest = _extract_manifest(artifact)
    manifest["startup_script"] = startup_script

    await artifact_manager.edit(
        artifact_id=args.artifact_id,
        manifest=manifest,
        stage=True,
    )
    await artifact_manager.commit(args.artifact_id)

    updated = await artifact_manager.read(args.artifact_id)
    updated_manifest = _extract_manifest(updated)
    persisted_script = updated_manifest.get("startup_script")

    if not isinstance(persisted_script, str):
        raise RuntimeError("Updated startup_script is missing or not a string.")

    if args.verify_contains and args.verify_contains not in persisted_script:
        raise RuntimeError(
            f"Verification failed: expected substring not found: {args.verify_contains!r}"
        )

    if persisted_script != startup_script:
        raise RuntimeError(
            "Verification failed: persisted startup_script content does not match source file."
        )

    print("Startup script updated and verified.")
    print(f"artifact_id={args.artifact_id}")
    print(f"startup_script_path={startup_script_path}")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update startup_script for a Hypha agent artifact"
    )
    parser.add_argument(
        "--artifact-id",
        default="hypha-agents/grammatical-deduction-bury-enormously",
        help="Full artifact id (workspace/alias)",
    )
    parser.add_argument(
        "--startup-script",
        default="scripts/agent_startup_scripts/bioimage_finder_startup_script.py",
        help="Path to local startup script file",
    )
    parser.add_argument(
        "--server-url",
        default="https://hypha.aicell.io",
        help="Hypha server URL",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="Hypha token. If omitted, load HYPHA_AGENTS_TOKEN from --env-file.",
    )
    parser.add_argument(
        "--env-file",
        default="chat-proxy-app/.env",
        help="Path to env file that contains HYPHA_AGENTS_TOKEN",
    )
    parser.add_argument(
        "--verify-contains",
        default="_dataset_result_from_hit",
        help="Optional substring that must be present in persisted startup_script",
    )

    args = parser.parse_args()
    await _run(args)


if __name__ == "__main__":
    asyncio.run(main())
