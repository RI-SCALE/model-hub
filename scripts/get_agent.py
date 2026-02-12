import asyncio
import os
import json
from hypha_rpc import connect_to_server

async def main():
    server_url = "https://hypha.aicell.io"
    token = os.environ.get('HYPHA_TOKEN')
    
    server = await connect_to_server({'server_url': server_url, 'token': token})
    am = await server.get_service('public/artifact-manager')
    
    try:
        # Fetch the specific agent
        agent = await am.read(artifact_id='hypha-agents/leisure-scrimmage-disliked-more')
        print(json.dumps(agent['manifest'], indent=2))
        
        # Save to file detailed info for documentation
        with open('agent_manifest.json', 'w') as f:
            json.dump(agent['manifest'], f, indent=2)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
