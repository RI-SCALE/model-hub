import argparse
import asyncio
import base64
import json
import os
import traceback

from hypha_rpc import connect_to_server


def decode_jwt_payload(token: str) -> dict:
    payload_part = token.split(".")[1]
    padding = "=" * (-len(payload_part) % 4)
    decoded_bytes = base64.urlsafe_b64decode(payload_part + padding)
    return json.loads(decoded_bytes)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Health-check a Hypha chat-proxy app")
    parser.add_argument(
        "--server-url",
        default=os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io"),
    )
    parser.add_argument(
        "--workspace",
        default=os.environ.get("HYPHA_WORKSPACE", "ri-scale"),
    )
    parser.add_argument(
        "--token",
        default=(
            os.environ.get("HYPHA_TOKEN")
            or os.environ.get("RI_SCALE_TOKEN")
            or ""
        ),
    )
    parser.add_argument(
        "--app-id",
        default=(
            os.environ.get("HYPHA_APP_ID")
            or os.environ.get("CHAT_PROXY_APP_ID")
            or "chat-proxy-dev"
        ),
    )
    parser.add_argument(
        "--model",
        default="gpt-5-mini",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
    )
    parser.add_argument(
        "--prompt",
        default="Hello! Please reply with 'SYSTEM ONLINE'.",
    )
    parser.add_argument(
        "--expected-substring",
        default="",
    )
    return parser.parse_args()


def build_service_alias(workspace: str, app_id: str) -> str:
    return f"{workspace}/default@{app_id}"


async def run_health_check(args: argparse.Namespace) -> int:
    if not args.token:
        print("❌ Missing token. Provide --token or set HYPHA_TOKEN/RI_SCALE_TOKEN.")
        return 1

    print(f"Using app_id: {args.app_id}")
    try:
        payload = decode_jwt_payload(args.token)
        print("Decoded JWT token payload:")
        print(json.dumps(payload, indent=2))
    except Exception as exp:
        print(f"⚠️ Could not decode JWT payload: {exp}")

    try:
        server = await connect_to_server(
            {
                "server_url": args.server_url,
                "token": args.token,
                "workspace": args.workspace,
                "method_timeout": max(args.timeout, 30),
            }
        )
    except Exception as exp:
        print(f"❌ Failed to connect to Hypha: {exp}")
        return 1

    try:
        print(f"Connected to workspace: {server.config.get('workspace')}")
        resolved_id = build_service_alias(args.workspace, args.app_id)
        print(f"Trying service alias: {resolved_id}")
        proxy = await server.get_service(resolved_id, {"mode": "random"})

        messages = [{"role": "user", "content": args.prompt}]
        print(f"Calling chat_completion via: {resolved_id}")
        response = await asyncio.wait_for(
            proxy.chat_completion(messages=messages, model=args.model),
            timeout=float(args.timeout),
        )

        if not isinstance(response, dict):
            print(f"❌ Unexpected response type: {type(response)}")
            return 1

        if "error" in response:
            print(f"❌ chat_completion returned error: {response['error']}")
            return 1

        choices = response.get("choices") or []
        if not choices:
            print("❌ chat_completion response missing choices")
            print(json.dumps(response, indent=2))
            return 1

        content = str(choices[0].get("message", {}).get("content", ""))
        print("Received content:")
        print(content)

        if args.expected_substring and args.expected_substring not in content:
            print(
                "❌ Expected substring not found in content:",
                args.expected_substring,
            )
            return 1

        print("✅ chat-proxy health check passed")
        return 0
    except asyncio.TimeoutError:
        print(f"❌ chat_completion timed out after {args.timeout}s")
        return 1
    except Exception as exp:
        print(f"❌ Error during health check: {exp}")
        traceback.print_exc()
        return 1
    finally:
        try:
            await server.disconnect()
        except Exception:
            pass


def main() -> int:
    args = parse_args()
    return asyncio.run(run_health_check(args))


if __name__ == "__main__":
    raise SystemExit(main())
