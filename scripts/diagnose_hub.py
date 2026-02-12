import asyncio
from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
TARGET_ARTIFACT = "ri-scale/ai-model-hub"

async def main():
    print(f"Connecting to Hypha server at {SERVER_URL}...")
    server = await connect_to_server({"server_url": SERVER_URL})
    
    print("Skipping explicit login for diagnosis (expecting public read access)...")
    # await server.login()
    
    # Check if we can list services to verify connection
    print("Listing services...")
    services = await server.list_services()
    print(f"Found {len(services)} services.")
    
    artifact_manager = await server.get_service("public/artifact-manager")
    
    print(f"Reading artifact: {TARGET_ARTIFACT}...")
    try:
        artifact = await artifact_manager.read(TARGET_ARTIFACT)
        print("\n--- Artifact Manifest ---")
        print(f"ID: {artifact.id}")
        print(f"Type: {artifact.type}")
        print(f"Name: {artifact.manifest.get('name')}")
        
        print("\n--- Config ---")
        if artifact.config:
            for key, value in artifact.config.items():
                print(f"{key}: {value}")
        else:
            print("No config found.")
            
        print("\n--- Permissions ---")
        if artifact.config and 'permissions' in artifact.config:
            print(artifact.config['permissions'])
        else:
            print("No explicit permissions found in config.")

    except Exception as e:
        print(f"\nError reading artifact: {e}")

if __name__ == "__main__":
    asyncio.run(main())