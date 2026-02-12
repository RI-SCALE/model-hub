import asyncio
import os
import argparse
from hypha_rpc import connect_to_server, login

SERVER_URL = "https://hypha.aicell.io"
ARTIFACT_ID = "ri-scale/ai-model-hub"

async def main():
    parser = argparse.ArgumentParser(description="Fix permissions for the model hub artifact.")
    parser.add_argument("--token", help="Hypha authentication token")
    args = parser.parse_args()

    print(f"1. Authenticating with {SERVER_URL}...")
    token = args.token
    
    if not token:
        # Check environment variable
        token = os.environ.get("HYPHA_TOKEN")
        
    if not token:
        try:
            print("   No token provided via --token or HYPHA_TOKEN env var. Attempting browser login...")
            token = await login({"server_url": SERVER_URL})
            print("   Authentication successful!")
        except Exception as e:
            print(f"   Authentication failed: {e}")
            return
    else:
        print("   Using provided token.")

    print(f"2. Connecting to server with token...")
    server = await connect_to_server({"server_url": SERVER_URL, "token": token})
    
    print("3. Getting Artifact Manager service...")
    artifact_manager = await server.get_service("public/artifact-manager")
    
    print(f"4. Reading artifact manifest for {ARTIFACT_ID}...")
    try:
        # We need to read it first to get current manifest and config
        artifact = await artifact_manager.read(ARTIFACT_ID)
        print(f"   Successfully read artifact.")
        print(f"   Current Permissions: {artifact.config.get('permissions', 'None')}")
        
    except Exception as e:
        print(f"   Failed to read artifact: {e}")
        # If we can't read it, we might still be able to edit it if we are the owner,
        # but usually read happens first.
        # If the error is permission denied on read, we can try to proceed with minimal config
        print("   Attempting to update permissions blindly (assuming ownership)...")
        artifact = None

    # Update permissions to ensure public read access
    print(f"5. Fixing permissions for {ARTIFACT_ID}...")
    
    current_config = artifact.config if artifact and artifact.config else {}
    permissions = current_config.get("permissions", {})
    
    # Check if public read is missing (or if we couldn't read the artifact)
    if permissions.get("*") != "r" or artifact is None:
        print("   Public read access is missing or unverified. Adding {'*': 'r'}...")
        permissions["*"] = "r"
        
        # Ensure authenticated users have at least read access too
        if "@" not in permissions:
            permissions["@"] = "r+" 
            
        current_config["permissions"] = permissions
        
        try:
            # Note: updating permissions might require 'manage' permission level
            await artifact_manager.edit(
                artifact_id=ARTIFACT_ID,
                config=current_config
            )
            print("   Permissions updated successfully!")
            print("   The artifact should now be publicly accessible.")
        except Exception as e:
            print(f"   Failed to update permissions: {e}")
    else:
        print("   Permissions appear correct ({'*': 'r'}). attempting to force update config anyway just in case...")
        try:
            await artifact_manager.edit(
                artifact_id=ARTIFACT_ID,
                config=current_config
            )
            print("   Config re-saved.")
        except Exception as e:
             print(f"   Failed to update permissions: {e}")

if __name__ == "__main__":
    asyncio.run(main())