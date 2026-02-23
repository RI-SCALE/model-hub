import argparse
import asyncio
import base64
import json
import os
import traceback
from datetime import datetime, timezone

import httpx
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
            os.environ.get("HYPHA_TOKEN") or os.environ.get("RI_SCALE_TOKEN") or ""
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
    parser.add_argument(
        "--check-request-url",
        action="store_true",
        help="Probe proxy.resolve_url repeatedly through Hypha service",
    )
    parser.add_argument(
        "--request-url",
        default="https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20tumor",
        help="URL to probe when --check-request-url is enabled",
    )
    parser.add_argument(
        "--request-attempts",
        type=int,
        default=5,
        help="Number of repeated resolve_url probes",
    )
    parser.add_argument(
        "--compare-direct",
        action="store_true",
        help="Also perform direct HTTP probes for the same URL",
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

        if args.check_request_url:
            if not hasattr(proxy, "resolve_url"):
                print("❌ proxy is missing resolve_url")
                return 1

            print("Probing resolve_url through Hypha app...")
            proxy_statuses: dict[str, int] = {}
            for attempt in range(1, max(1, int(args.request_attempts)) + 1):
                ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                try:
                    payload = await asyncio.wait_for(
                        proxy.resolve_url(
                            url=args.request_url,
                            method="GET",
                            headers={"Accept": "application/json"},
                            timeout=30,
                        ),
                        timeout=float(args.timeout),
                    )
                except asyncio.TimeoutError:
                    print(f"{ts} | proxy | attempt={attempt} | timeout")
                    proxy_statuses["timeout"] = proxy_statuses.get("timeout", 0) + 1
                    continue
                except Exception as exp:
                    print(f"{ts} | proxy | attempt={attempt} | exception={exp}")
                    proxy_statuses["exception"] = proxy_statuses.get("exception", 0) + 1
                    continue

                if not isinstance(payload, dict):
                    print(
                        f"{ts} | proxy | attempt={attempt} | unexpected_payload_type={type(payload)}"
                    )
                    proxy_statuses["unexpected_payload"] = (
                        proxy_statuses.get("unexpected_payload", 0) + 1
                    )
                    continue

                status_code = payload.get("status_code")
                code_key = str(status_code)
                proxy_statuses[code_key] = proxy_statuses.get(code_key, 0) + 1
                error_text = payload.get("error") or ""
                print(
                    f"{ts} | proxy | attempt={attempt} | status_code={status_code} | ok={payload.get('ok')} | error={error_text}"
                )

            print("Proxy resolve_url status summary:")
            print(json.dumps(proxy_statuses, indent=2, sort_keys=True))

            if args.compare_direct:
                print("Probing direct endpoint from same client host...")
                direct_statuses: dict[str, int] = {}
                for attempt in range(1, max(1, int(args.request_attempts)) + 1):
                    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    try:
                        async with httpx.AsyncClient(
                            timeout=30.0, follow_redirects=True
                        ) as client:
                            response = await client.get(
                                args.request_url,
                                headers={"Accept": "application/json"},
                            )
                        key = str(response.status_code)
                        direct_statuses[key] = direct_statuses.get(key, 0) + 1
                        print(
                            f"{ts} | direct | attempt={attempt} | status_code={response.status_code}"
                        )
                    except Exception as exp:
                        direct_statuses["exception"] = (
                            direct_statuses.get("exception", 0) + 1
                        )
                        print(f"{ts} | direct | attempt={attempt} | exception={exp}")

                print("Direct request status summary:")
                print(json.dumps(direct_statuses, indent=2, sort_keys=True))

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
