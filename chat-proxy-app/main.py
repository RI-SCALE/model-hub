import asyncio
import os


async def main(server):
    """Register the chat proxy service."""
    print("Starting Chat Proxy Service...")

    async def chat(agent_id, text, history=None, config=None):
        """Proxy chat messages to the agent with API key injection."""
        print(f"Proxying chat for agent: {agent_id}")

        try:
            # Prepare configuration with API key
            if config is None:
                config = {}

            if "model_config" not in config:
                config["model_config"] = {}

            # Inject the API key from environment variables
            api_key = os.environ.get("OPENAI_API_KEY")
            if api_key:
                config["model_config"]["openai_api_key"] = api_key
                config["model_config"]["api_key"] = api_key
            else:
                print("WARNING: OPENAI_API_KEY not found in environment")
            
            # Pattern 1: Try to get existing service first (if it's a standalone service)
            try:
                agent = await server.get_service(agent_id)
                print(f"Connected to existing service: {agent_id}")
                response = await agent.chat(text, history=history, config=config)
                return response
            except Exception as e:
                print(f"Service {agent_id} not found as direct service. Trying Engine... ({e})")

            # Pattern 2: Use Agent Engine (deno-app-engine)
            try:
                # 1. Get Artifact info to get Manifest
                am = await server.get_service("public/artifact-manager")
                artifact = await am.read(agent_id)
                manifest = artifact["manifest"]
                
                # 2. Get Engine
                engine_id = "hypha-agents/deno-app-engine" 
                engine = await server.get_service(engine_id)
                
                # 3. Ensure Agent Exists / Create it
                # We use the artifact ID as the agent ID to share it among users (owned by this proxy)
                agent_config = manifest.copy()
                agent_config['id'] = agent_id 
                
                print(f"Ensuring agent {agent_id} exists on engine...")
                try:
                    # Check if exists first to avoid unnecessary creation calls?
                    # engine.createAgent usually handles idempotency or we used agentExists
                    exists_chk = await engine.agentExists({"agentId": agent_id})
                    if not exists_chk.get("exists"):
                        await engine.createAgent(agent_config)
                        print(f"Created agent {agent_id}")
                    else:
                        print(f"Agent {agent_id} already exists")
                except Exception as create_err:
                     print(f"Agent creation check/attempt info: {create_err}")
                
                # 4. Chat via Engine
                # Construct messages list from text + history
                messages = []
                if history and isinstance(history, list):
                    # Ideally convert history format if needed
                    pass
                
                messages.append({"role": "user", "content": text})
                
                print("Calling engine.chatWithAgentStateless...")
                # We use stateless chat to just get the completion for this message
                response = await engine.chatWithAgentStateless({
                    "agentId": agent_id,
                    "messages": messages,
                    "modelConfig": config["model_config"]
                })
                
                return response

            except Exception as engine_err:
                print(f"Failed to use engine logic: {engine_err}")
                raise engine_err

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
