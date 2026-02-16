import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAT_PROXY_DIR = ROOT / "chat-proxy-app"
MANIFEST = CHAT_PROXY_DIR / "manifest.yaml"
SOURCE = CHAT_PROXY_DIR / "app.py"

HYPHA_APPS_CLI_MAIN = os.environ.get(
    "HYPHA_APPS_CLI_MAIN",
    str((ROOT.parent / "hypha-apps-cli" / "hypha_apps_cli" / "__main__.py").resolve()),
)


def run(cmd: list[str]) -> None:
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=str(ROOT))


def main() -> int:
    if not Path(HYPHA_APPS_CLI_MAIN).exists():
        print(
            "Error: hypha-apps-cli entrypoint not found.\n"
            "Set HYPHA_APPS_CLI_MAIN to your hypha_apps_cli/__main__.py path."
        )
        return 1

    app_id = "chat-proxy"

    install_cmd = [
        sys.executable,
        HYPHA_APPS_CLI_MAIN,
        "install",
        "--app-id",
        app_id,
        "--manifest",
        str(MANIFEST),
        "--source",
        str(SOURCE),
        "--overwrite",
    ]

    start_cmd = [
        sys.executable,
        HYPHA_APPS_CLI_MAIN,
        "start",
        "--app-id",
        app_id,
    ]

    run(install_cmd)
    run(start_cmd)

    print("✅ chat-proxy installed and started")
    print("Service ID expected by frontend: ri-scale/default@chat-proxy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
