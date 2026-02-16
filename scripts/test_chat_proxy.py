import asyncio
import base64
import json
import os
import traceback

from dotenv import load_dotenv
from hypha_rpc import connect_to_server

load_dotenv(
    override=True
)  # Load from .env in current directory, which should have the necessary tokens and config

# Configuration
SERVER_URL = os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io")
# If HYPHA_TOKEN is not set, we can try to connect anonymously if server allows,
# or specific workspace requires token. Start script assumes token.
TOKEN = os.environ.get("RI_SCALE_TOKEN")
print(f"Using token: {'Yes' if TOKEN else 'No'}")


if TOKEN:
    try:
        # JWT tokens are typically in the format header.payload.signature
        payload_part = TOKEN.split(".")[1]
        # JWT payload is base64url encoded
        padding = "=" * (-len(payload_part) % 4)  # Fix padding if necessary
        decoded_bytes = base64.urlsafe_b64decode(payload_part + padding)
        jwt_decoded_token = json.loads(decoded_bytes)
        print(f"Decoded JWT token payload: {json.dumps(jwt_decoded_token, indent=2)}")
    except Exception as e:
        print(f"Error decoding JWT token: {e}")

WORKSPACE = os.environ.get("HYPHA_WORKSPACE", "ri-scale")


async def test_chat_proxy():
    print(f"Connecting to {SERVER_URL}...")
    try:
        connect_config = {"server_url": SERVER_URL, "method_timeout": 30}
        if TOKEN:
            connect_config["token"] = TOKEN
        if WORKSPACE:
            connect_config["workspace"] = WORKSPACE

        server = await connect_to_server(connect_config)
        print(f"Connected to workspace: {server.config['workspace']}")
    except Exception as e:
        print(f"Failed to connect to Hypha: {e}")
        return

    print("Locating chat-proxy service...")
    try:
        # Try finding by alias first
        target_service_id = None
        app_services = []
        def has_chat_completion_schema(service: dict) -> bool:
            schema = service.get("service_schema") or {}
            return isinstance(schema, dict) and "chat_completion" in schema

        try:
            print("Attempting to connect via alias 'ri-scale/chat-proxy' (mode=random)...")
            proxy = await server.get_service("ri-scale/chat-proxy", {"mode": "random"})
            target_service_id = "ri-scale/chat-proxy"
            print("Successfully connected via alias!")
        except Exception as e:
            print(f"Alias lookup failed: {e}")

            services = await server.list_services({"workspace": WORKSPACE})
            # Filter services by explicit service id suffix as app_id may be missing
            app_services = [
                s
                for s in services
                if s.get("id", "").endswith(":chat-proxy") or s.get("id", "") == "chat-proxy"
            ]

            print(f"Found {len(app_services)} services for app 'chat-proxy':")

            for s in app_services:
                print(f" - ID: {s['id']}, Name: {s.get('name')}")
                if "built-in" not in s["id"] and has_chat_completion_schema(s):
                    target_service_id = s["id"]
                    break

        if target_service_id == "ri-scale/chat-proxy":
            # Alias can resolve to old stale instances; pin to a concrete service exposing chat_completion
            services = await server.list_services({"workspace": WORKSPACE})
            app_services = [
                s
                for s in services
                if (
                    s.get("id", "").endswith(":chat-proxy")
                    or (
                        s.get("id", "").endswith(":default")
                        and s.get("app_id") == "chat-proxy"
                    )
                )
            ]
            for s in app_services:
                if has_chat_completion_schema(s):
                    target_service_id = s["id"]
                    break

        if not target_service_id and app_services:
            target_service_id = app_services[0]["id"]

        if not target_service_id:
            print("No chat-proxy services found.")
            return

        print(f"Selecting service: {target_service_id}")
        if target_service_id == "ri-scale/chat-proxy":
            proxy = await server.get_service(target_service_id, {"mode": "random"})
        else:
            proxy = await server.get_service(target_service_id)
        if hasattr(proxy, "config") and "id" in proxy.config:
            print(f"Connected Service ID: {proxy.config['id']}")
        elif hasattr(proxy, "id"):
             print(f"Connected Service ID: {proxy.id}")
        else:
             print("Connected Service (ID unknown)")

        # Check if method exists
        if not hasattr(proxy, "chat_completion"):
            print(f"Service {target_service_id} does not have chat_completion method.")
            return

    except Exception as e:
        print(f"Error finding/connecting to service: {e}")
        return

    print("Testing chat_completion with a simple message...")
    messages = [
        {"role": "user", "content": "Hello! Please reply with 'SYSTEM ONLINE'."}
    ]
    # Using gpt-4-turbo-preview or similar standard model to test pipeline
    model = "gpt-4-turbo-preview"

    try:
        # Set a timeout for the actual call
        response = await asyncio.wait_for(
            proxy.chat_completion(messages=messages, model=model), timeout=60.0
        )

        print("Response received:")
        print(json.dumps(response, indent=2))

        if isinstance(response, dict):
            if "error" in response:
                print(f"❌ Chat proxy returned an API error: {response['error']}")
            elif "choices" in response and len(response["choices"]) > 0:
                content = response["choices"][0]["message"]["content"]
                print(f"✅ Chat proxy is working! Content: {content}")
                if "SYSTEM ONLINE" in content:
                    print("✅ Response verification passed.")
                else:
                    print("⚠️ Response content verification inconclusive.")
            else:
                print("❓ Unexpected response format (missing 'choices').")
        else:
            print(f"❓ Unexpected response type: {type(response)}")

    except asyncio.TimeoutError:
        print("❌ Chat proxy request timed out (60s).")
    except Exception as e:
        print(f"❌ Error calling chat_completion: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_chat_proxy())
