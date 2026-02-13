import asyncio
import os

from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
TOKEN = os.environ.get("HYPHA_TOKEN")
WORKSPACE = "ri-scale"


async def main():
    api = await connect_to_server(
        {"server_url": SERVER_URL, "token": TOKEN, "workspace": WORKSPACE}
    )
    am = await api.get_service("public/artifact-manager")

    print(f"Checking if artifact {WORKSPACE}/chat-proxy exists...")
    try:
        art = await am.read(artifact_id=f"{WORKSPACE}/chat-proxy")
        print(f"FOUND chat-proxy! ID: {art['id']}")
        print(f"Files: {art.get('files')}")
    except Exception as e:
        print(f"chat-proxy not found: {e}")

    # Also check for 'chat-proxy-app' if the ID handling was different
    try:
        art = await am.read(artifact_id=f"{WORKSPACE}/chat-proxy-app")
        print(f"FOUND chat-proxy-app! ID: {art['id']}")
    except:
        pass


if __name__ == "__main__":
    asyncio.run(main())
