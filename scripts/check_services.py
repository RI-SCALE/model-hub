import asyncio

from hypha_rpc import connect_to_server


async def main():
    try:
        server = await connect_to_server({"server_url": "https://hypha.aicell.io"})
        print("Connected.", flush=True)

        try:
            print("Trying to get service 'hypha-agents/deno-app-engine'...", flush=True)
            svc = await server.get_service("hypha-agents/deno-app-engine")
            print(f"GOT ENGINE: {svc['id']}", flush=True)
        except Exception as e:
            print(f"Failed to get engine: {e}", flush=True)

        try:
            print(
                "Trying to get service 'hypha-agents/leisure-scrimmage-disliked-more'...",
                flush=True,
            )
            svc = await server.get_service(
                "hypha-agents/leisure-scrimmage-disliked-more"
            )
            print(f"GOT AGENT: {svc['id']}", flush=True)
        except Exception as e:
            print(f"Failed to get agent: {e}", flush=True)

        try:
            print("Trying to get service 'ri-scale/chat-proxy'...", flush=True)
            svc = await server.get_service("ri-scale/chat-proxy")
            print(f"GOT PROXY: {svc['id']}", flush=True)
        except Exception as e:
            print(f"Failed to get proxy: {e}", flush=True)

    except Exception as e:
        print(f"Error: {e}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
