import asyncio
import json
import os

from hypha_rpc import connect_to_server

# Configuration
SERVER_URL = os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io")
TOKEN = os.environ.get("HYPHA_TOKEN")
WORKSPACE = os.environ.get("HYPHA_WORKSPACE")

if not TOKEN:
    print("Error: HYPHA_TOKEN environment variable is required.")
    exit(1)


async def get_openai_key(server):
    print("Fetching OpenAI Key from artifacts...")
    try:
        am = await server.get_service("public/artifact-manager")

        # Method 1: Try reading file content
        print("Reading 'ri-scale/openai-secret'...")
        # read_file can return bytes, str, or a dictionary-like object (ObjectProxy)
        content_proxy = await am.read_file(
            artifact_id="ri-scale/openai-secret", file_path="secret.json"
        )

        content_str = None

        # Handle ObjectProxy / Dictionary return
        # Based on debug info: {'name': 'secret.json', 'content': '...'}
        try:
            # Try to access as dict first
            if hasattr(content_proxy, "get") or isinstance(content_proxy, dict):
                content_str = content_proxy.get("content")

            # If that failed or returned None, maybe the proxy IS the content?
            if content_str is None:
                if hasattr(content_proxy, "_getvalue"):
                    # Unpack ObjectProxy if needed
                    val = content_proxy._getvalue()
                    if isinstance(val, dict):
                        content_str = val.get("content")
                    else:
                        content_str = val
                else:
                    # Try raw string conversion
                    content_str = str(content_proxy)

        except Exception as e:
            print(f"Error parsing ObjectProxy: {e}")
            content_str = str(content_proxy)

        # Parse the inner JSON string if we found one
        if content_str:
            if isinstance(content_str, bytes):
                content_str = content_str.decode("utf-8")

            if isinstance(content_str, str):
                try:
                    data = json.loads(content_str)
                    return data.get("api_key")
                except json.JSONDecodeError:
                    print("Error: Content is not valid JSON")
            elif isinstance(content_str, dict):
                return content_str.get("api_key")

        print("Could not extract api_key from content.")

    except Exception as e:
        print(f"Error fetching secret file info: {e}")

    return None


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

    # 1. Fetch Key
    api_key = await get_openai_key(server)

    if not api_key:
        print("Warning: Could not load API Key. Chat will fail.")
    else:
        print("API Key loaded successfully.")

    # 2. Define the Token Provider Service
    async def get_openai_token(context=None):
        """
        Return the OpenAI API Key.
        """
        if api_key:
            return {"access_token": api_key, "client_secret": {"value": api_key}}
        else:
             raise Exception("OpenAI API Key not available.")
    
    # 3. Register the service
    service_id = "chat-proxy"
    print(f"Registering service: {service_id} (visibility=public)...")

    try:
        await server.register_service(
            {
                "name": "RI-SCALE Chat Proxy",
                "id": service_id,
                "config": {"visibility": "public", "require_context": True},
                "get_openai_token": get_openai_token,
            }
        )

        full_service_id = f"{server.config['workspace']}/{service_id}"
        print(f"Service registered successfully at: {full_service_id}")
        print("Proxy is running. Press Ctrl+C to stop.")

        await asyncio.Future()

    except Exception as e:
        print(f"Failed to register service: {e}")
        exit(1)


if __name__ == "__main__":
    asyncio.run(main())
