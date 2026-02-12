import asyncio
import os
import requests
import argparse
from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
PARENT_ID = "ri-scale/ai-model-hub"

# Simple index.html content
HTML_CONTENT = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sample App Artifact</title>
    <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f9ff; }
        .container { text-align: center; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #0284c7; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Hello from the Artifact!</h1>
        <p>This is a static site served directly from the RI-SCALE Model Hub.</p>
    </div>
</body>
</html>
"""

async def main():
    parser = argparse.ArgumentParser(description='Upload a sample artifact.')
    parser.add_argument('--token', help='Hypha authentication token')
    args = parser.parse_args()

    token = args.token or os.environ.get('HYPHA_TOKEN')

    try:
        # Create a local file to upload
        with open("index.html", "w") as f:
            f.write(HTML_CONTENT)

        print("Connecting to Hypha server...")
        if token:
            print("Using provided token.")
            server = await connect_to_server({"server_url": SERVER_URL, "token": token})
        else:
            server = await connect_to_server({"server_url": SERVER_URL})
            print("Logging in... Please click the link below if prompted, or verify in your browser.")
            await server.login()
        
        artifact_manager = await server.get_service("public/artifact-manager")
        
        print(f"Creating artifact in {PARENT_ID}...")
        # Create artifact
        alias = "sample-static-app"
        
        manifest = {
            "name": "Sample Static App",
            "description": "A sample artifact containing an index.html file to demonstrate the 'Open App' feature.",
            "tags": ["demo", "app"],
            "authors": [{"name": "Copilot"}],
        }
        
        try:
             # Create artifact in staging mode
             artifact = await artifact_manager.create(
                parent_id=PARENT_ID,
                alias=alias,
                manifest=manifest,
                stage=True,
                overwrite=True
            )
        except Exception as e:
            print(f"Creation failed: {e}")
            return

        print(f"Artifact created: {artifact.id}")
        
        # Upload index.html
        print("Uploading index.html...")
        put_url = await artifact_manager.put_file(artifact.id, "index.html")
        
        with open("index.html", "rb") as f:
            resp = requests.put(put_url, data=f)
            resp.raise_for_status()
            
        print("File uploaded.")
        
        # Commit
        print("Committing artifact...")
        await artifact_manager.commit(artifact.id)
        
        print("Success! Artifact uploaded.")
        print(f"Artifact ID: {artifact.id}")
        print(f"You can view it at: http://localhost:3000/#/ri-scale/artifacts/{alias}")
        
    finally:
        if os.path.exists("index.html"):
            os.remove("index.html")

if __name__ == "__main__":
    asyncio.run(main())