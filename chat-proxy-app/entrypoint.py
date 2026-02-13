import asyncio
import os
import json
import requests
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
             if hasattr(content_proxy, 'get') or isinstance(content_proxy, dict):
                 content_str = content_proxy.get('content')
             
             # If that failed or returned None, maybe the proxy IS the content?
             if content_str is None:
                  if hasattr(content_proxy, '_getvalue'):
                       # Unpack ObjectProxy if needed
                       val = content_proxy._getvalue()
                       if isinstance(val, dict):
                           content_str = val.get('content')
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

    # 2. Define the Chat Proxy Service
    async def chat(agent_id, message, history=[], context=None):
        """
        Public chat endpoint that proxies to the agent with the injected key.
        """
        print(f"Proxy received message for agent: {agent_id}")

        # Basic ID resolution
        target_service = None
        service_ids_to_try = [agent_id, f"hypha-agents/{agent_id}", f"public/{agent_id}"]
        
        for sid in service_ids_to_try:
            try:
                target_service = await server.get_service(sid)
                if target_service:
                    break
            except:
                continue

        if not target_service:
            # Fallback for dynamic agents on the engine?
            # Typically agent_id passed here is already the service ID or the agent name
            return {
                "text": f"Error: Could not find online agent service for ID: {agent_id}"
            }

        # Inject Key
        ctx = context or {}
        if api_key:
            ctx["openai_api_key"] = api_key
            # Some agents might look for api_key in different places
            ctx["api_key"] = api_key 
            
            if "model_config" not in ctx:
                ctx["model_config"] = {}
            ctx["model_config"]["openai_api_key"] = api_key
        else:
            return {"text": "Error: Service misconfigured (API Key not found)."}

        # Forward call
        try:
            # Check signature of target chat
            # Hypha services usually take generic kwargs, but standard is text, history, context
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
        await asyncio.Future()

    except Exception as e:
        print(f"Failed to register service: {e}")
        # Crash container to restart
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())
