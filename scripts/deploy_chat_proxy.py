import os
import subprocess
import sys
from argparse import ArgumentParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAT_PROXY_DIR = ROOT / "chat-proxy-app"
MANIFEST = CHAT_PROXY_DIR / "manifest.yaml"
SOURCE = CHAT_PROXY_DIR / "app.py"

HYPHA_APPS_CLI_MAIN = os.environ.get(
    "HYPHA_APPS_CLI_MAIN",
    str((ROOT.parent / "hypha-apps-cli" / "hypha_apps_cli" / "__main__.py").resolve()),
)


def run(cmd: list[str], *, check: bool = True, timeout: int | None = None) -> int:
    print("Running:", " ".join(cmd))
    completed = subprocess.run(cmd, check=False, cwd=str(ROOT), timeout=timeout)
    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, cmd)
    return completed.returncode


def get_cli_entrypoint() -> list[str]:
    if Path(HYPHA_APPS_CLI_MAIN).exists():
        return [sys.executable, HYPHA_APPS_CLI_MAIN]
    return [sys.executable, "-m", "hypha_apps_cli"]


def parse_args() -> ArgumentParser:
    parser = ArgumentParser(
        description="Deploy and optionally health-check chat-proxy app"
    )
    parser.add_argument(
        "--app-id",
        default=os.environ.get("CHAT_PROXY_APP_ID", "chat-proxy-dev"),
        help="Hypha app id to install/start (default: chat-proxy-dev)",
    )
    parser.add_argument(
        "--source",
        default=str(SOURCE),
        help="Path to app source file",
    )
    parser.add_argument(
        "--manifest",
        default=str(MANIFEST),
        help="Path to app manifest file",
    )
    parser.add_argument(
        "--skip-start",
        action="store_true",
        help="Install/update app without starting it",
    )
    parser.add_argument(
        "--start-timeout",
        type=int,
        default=30,
        help="Timeout in seconds for optional start command",
    )
    parser.add_argument(
        "--non-fatal-start",
        action="store_true",
        help="Do not fail deployment if start command times out/fails",
    )
    parser.add_argument(
        "--health-check",
        action="store_true",
        help="Run scripts/test_chat_proxy.py after deployment",
    )
    parser.add_argument(
        "--health-timeout",
        type=int,
        default=120,
        help="Health-check timeout in seconds",
    )
    parser.add_argument(
        "--model",
        default="gpt-5-mini",
        help="Model sent during health check",
    )
    parser.add_argument(
        "--expected-substring",
        default="",
        help="Optional response substring required by health check",
    )
    parser.add_argument(
        "--check-request-url",
        action="store_true",
        help="Verify proxy.resolve_url is available and can reach the configured request URL",
    )
    parser.add_argument(
        "--request-url",
        default="https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20tumor",
        help="URL used for resolve_url health checks",
    )
    parser.add_argument(
        "--request-attempts",
        type=int,
        default=3,
        help="Number of resolve_url probes during health checks",
    )
    parser.add_argument(
        "--compare-direct",
        action="store_true",
        help="Also compare proxy.resolve_url probes with direct requests",
    )
    return parser


def main() -> int:
    args = parse_args().parse_args()
    cli = get_cli_entrypoint()

    install_cmd = [
        *cli,
        "install",
        "--app-id",
        args.app_id,
        "--manifest",
        args.manifest,
        "--source",
        args.source,
        "--overwrite",
    ]

    start_cmd = [
        *cli,
        "start",
        "--app-id",
        args.app_id,
    ]

    run(install_cmd)
    if not args.skip_start:
        try:
            run(start_cmd, check=not args.non_fatal_start, timeout=args.start_timeout)
        except subprocess.CalledProcessError:
            if not args.non_fatal_start:
                raise
            print(
                f"⚠️ Start command failed for {args.app_id}, continuing because --non-fatal-start is set."
            )
        except subprocess.TimeoutExpired:
            if not args.non_fatal_start:
                raise
            print(
                f"⚠️ Start command timed out for {args.app_id}, continuing because --non-fatal-start is set."
            )

    if args.health_check:
        health_cmd = [
            sys.executable,
            str((ROOT / "scripts" / "test_chat_proxy.py").resolve()),
            "--app-id",
            args.app_id,
            "--model",
            args.model,
            "--timeout",
            str(args.health_timeout),
        ]
        if args.expected_substring:
            health_cmd.extend(["--expected-substring", args.expected_substring])
        if args.check_request_url:
            health_cmd.append("--check-request-url")
            health_cmd.extend(["--request-url", args.request_url])
            health_cmd.extend(["--request-attempts", str(args.request_attempts)])
        if args.compare_direct:
            health_cmd.append("--compare-direct")

        first_health_exit = run(health_cmd, check=False)
        if first_health_exit != 0:
            print(
                f"⚠️ Initial health check failed for {args.app_id}. Trying one explicit start + health retry..."
            )
            try:
                run(start_cmd, check=False, timeout=args.start_timeout)
            except subprocess.TimeoutExpired:
                print(f"⚠️ Explicit retry start timed out for {args.app_id}.")

            second_health_exit = run(health_cmd, check=False)
            if second_health_exit != 0:
                raise subprocess.CalledProcessError(second_health_exit, health_cmd)

    print(
        f"✅ {args.app_id} installed and {'started' if not args.skip_start else 'not started'}"
    )
    print(f"Service ID expected by frontend: ri-scale/default@{args.app_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
