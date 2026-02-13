from hypha_rpc import api

async def setup():
    print("Test app setup complete.")

async def chat(agent_id, message, history=[], context=None):
    return {"text": f"Echo: {message}"}

api.export({
    "setup": setup,
    "chat": chat,
    "config": {
        "visibility": "public"
    }
})