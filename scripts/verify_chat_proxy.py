import asyncio
import os
import sys

# Ensure we have access to the necessary libraries
try:
    from hypha_rpc import connect_to_server
except ImportError:
    print("Please install hypha-rpc: pip install hypha-rpc")
    sys.exit(1)

# Configuration matching the frontend
SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "ri-scale"
SERVICE_ID = "chat-proxy"

async def test_chat():
    print(f"Connecting to {SERVER_URL}...")
    
    # Connect anonymously or with a test token if needed.
    # The frontend usually connects anonymously or with a user token.
    # The proxy is public, so anonymous connection should work to *find* it,
    # but the proxy itself might require authentication depending on configuration.
    # Based on the code: "visibility": "public" in registration config.
    
    try:
        # Connect to the server
        server = await connect_to_server({"server_url": SERVER_URL})
        print(f"Connected to Hypha server. Client ID: {server.config['client_id']}")
        
        # Construct the full service ID
        full_service_id = f"{WORKSPACE}/{SERVICE_ID}"
        print(f"Looking for service: {full_service_id} ...")
        
        try:
            chat_proxy = await server.get_service(full_service_id)
            print(f"SUCCESS: Found service '{full_service_id}'")
        except Exception as e:
            print(f"FAILURE: Could not find service '{full_service_id}'.")
            print(f"Reason: {e}")
            return

        # Define a test message
        agent_id = "test-agent" # Or a real agent ID if known, e.g. "ri-scale/cell-segmentation"
        message = "Hello, this is a test from the verification script."
        history = []
        
        print(f"Sending message to agent '{agent_id}' via proxy...")
        
        try:
            # The chat proxy signature: chat(agent_id, message, history=[], context=None)
            response = await chat_proxy.chat(
                agent_id=agent_id,
                message=message,
                history=history,
                context={"test_mode": True}
            )
            
            print("Response received:")
            print("-" * 40)
            print(response)
            print("-" * 40)
            
            if "error" in str(response).lower() and "not find" in str(response).lower():
                 print("The proxy works, but the target agent 'test-agent' was not found (Expected).")
            else:
                 print("Proxy interaction successful!")

        except Exception as e:
            print(f"FAILURE: Error during chat()")
            print(f"Reason: {e}")

    except Exception as e:
        print(f"FAILURE: Connection error")
        print(f"Reason: {e}")

if __name__ == "__main__":
    asyncio.run(test_chat())
