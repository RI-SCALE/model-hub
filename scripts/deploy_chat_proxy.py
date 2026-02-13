import asyncio
import os

import requests
from hypha_rpc import connect_to_server

# Configuration
SERVER_URL = os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io")
TOKEN = os.environ.get("HYPHA_TOKEN")
WORKSPACE = os.environ.get("HYPHA_WORKSPACE")

if not TOKEN:
    print("Error: HYPHA_TOKEN environment variable is required.")
    exit(1)


async def main():
    print(f"Connecting to {SERVER_URL}...")
    try:
        connect_config = {"server_url": SERVER_URL, "token": TOKEN}
        if WORKSPACE:
            connect_config["workspace"] = WORKSPACE

        server = await connect_to_server(connect_config)
    except Exception as e:
        print(f"Failed to connect: {e}")
        return

    print(f"Connected to workspace: {server.config['workspace']}")

    # 1. Fetch the Secret Key
    print("Fetching OpenAI Key from artifacts...")
    api_key = None
    try:
        am = await server.get_service("public/artifact-manager")

        try:
            # Attempt to get the file download URL directly
            print("Attempting to get file URL via get_file...")
            key_file_url = await am.get_file(
                artifact_id="ri-scale/openai-secret", file_path="secret.json"
            )

            if isinstance(key_file_url, str) and key_file_url.startswith("http"):
                print(f"Got URL: {key_file_url}")
            else:
                print(f"get_file returned: {key_file_url}. Trying read_file...")
                # Fallback: try reading content directly
                content = await am.read_file(
                    artifact_id="ri-scale/openai-secret", file_path="secret.json"
                )
                import json

                if isinstance(content, bytes):
                    content = content.decode("utf-8")
                data = json.loads(content)
                api_key = data.get("api_key")
                print("API Key loaded via read_file.")
                key_file_url = None  # signal we already loaded it

        except Exception as e:
            print(f"Error fetching secret file info: {e}")
            key_file_url = None

        if key_file_url:
            resp = requests.get(key_file_url)
            if resp.status_code == 200:
                data = resp.json()
                api_key = data.get("api_key")
                print("API Key loaded via URL.")
            else:
                print(f"Failed to fetch secret file: {resp.status_code}")

    except Exception as e:
        print(f"Error reading artifact: {e}")

    if not api_key:
        print("Warning: Could not load API Key. Chat will fail.")
        # We continue to register the service so we can test connectivity at least.

    # 2. Define the Chat Proxy Service
    async def chat(agent_id, message, history=[], context=None):
        """
        Public chat endpoint that proxies to the agent with the injected key.
        """
        print(f"Proxy received message for agent: {agent_id}")

        target_service = None
        try:
            target_service = await server.get_service(agent_id)
        except:
            if not agent_id.startswith("hypha-agents/"):
                try:
                    target_service = await server.get_service(
                        f"hypha-agents/{agent_id}"
                    )
                except:
                    pass

        if not target_service:
            return {
                "text": f"Error: Could not find online agent service for ID: {agent_id}"
            }

        # Inject Key
        ctx = context or {}
        if api_key:
            ctx["openai_api_key"] = api_key
        else:
            return {"text": "Error: Service misconfigured (API Key not found)."}

        # Forward call
        try:
            response = await target_service.chat(
                text=message, history=history, context=ctx
            )
            return response
        except Exception as e:
            print(f"Agent call failed: {e}")
            return {"text": f"Error calling agent: {str(e)}"}

    # 3. Register the service
    service_id = "chat-proxy"
    print(f"Registering service: {service_id} (visibility=public)...")

    try:
        await server.register_service(
            {
                "name": "RI-SCALE Chat Proxy",
                "id": service_id,
                "config": {"visibility": "public", "require_context": True},
                "chat": chat,
            }
        )

        full_service_id = f"{server.config['workspace']}/{service_id}"
        print(f"Service registered successfully at: {full_service_id}")
        print("Proxy is running. Press Ctrl+C to stop.")

        # Keep running
        while True:
            await asyncio.sleep(1)

    except Exception as e:
        print(f"Failed to register service: {e}")


if __name__ == "__main__":
    asyncio.run(main())
