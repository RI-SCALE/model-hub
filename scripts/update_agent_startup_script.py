import argparse
import asyncio
from pathlib import Path
from typing import Any, Dict

from hypha_rpc import connect_to_server


def _extract_manifest(payload: Dict[str, Any]) -> Dict[str, Any]:
    manifest = payload.get("manifest")
    if isinstance(manifest, dict):
        return manifest
    return dict(payload)


async def _run(args: argparse.Namespace) -> None:
    token = args.token
    if not token:
        raise ValueError(
            "A token is required. Pass --token or set HYPHA_TOKEN in the environment."
        )

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
        help="Hypha token. Prefer passing via env and shell substitution.",
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
