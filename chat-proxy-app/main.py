import asyncio
import os


async def main(server):
    """Register the chat proxy service."""
    print("Starting Chat Proxy Service...")

    async def chat(text, history=None, config=None):
        """Proxy chat messages to the agent with API key injection."""
        # The target agent ID
        agent_id = "hypha-agents/leisure-scrimmage-disliked-more"

        try:
            # Connect to the target agent
            # We use the server connection passed to the app
            agent = await server.get_service(agent_id)

            # Prepare configuration with API key
            if config is None:
                config = {}

            if "model_config" not in config:
                config["model_config"] = {}

            # Inject the API key from environment variables
            # In a Hypha App, secrets can be mounted as env vars
            api_key = os.environ.get("OPENAI_API_KEY")
            if api_key:
                # Some agents expect 'api_key', some 'openai_api_key' in model_config
                config["model_config"]["openai_api_key"] = api_key
                config["model_config"]["api_key"] = api_key
            else:
                print("WARNING: OPENAI_API_KEY not found in environment")

            # Forward the call
            # agent.chat is the method we expect the agent to have
            response = await agent.chat(text, history=history, config=config)
            return response

        except Exception as e:
            print(f"Error proxying chat: {e}")
            return f"Error in proxy: {str(e)}"

    # Register the service
    await server.register_service(
        {
            "name": "RI-SCALE Chat Proxy",
            "id": "chat-proxy",
            "config": {"visibility": "public", "require_context": True},
            "chat": chat,
        }
    )
    print("Chat Proxy service registered successfully.")

    # Keep the service running
    # In some Hypha app runners, main might need to stay alive or return.
    # Typically, registering a service is async and we just wait.
    # But if main returns, the app might exit.
    # However, Hypha apps usually handle lifecycle.
    # Let's verify if we need to sleep.
    # For many simple apps, registering is enough if the runner keeps it alive.
    # But often creating a task or sleeping is safer.
    await asyncio.Future()  # Wait forever
