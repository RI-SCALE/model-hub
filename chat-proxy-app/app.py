import logging
import os
from hypha_rpc import api

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat-proxy")

API_KEY = os.environ.get("OPENAI_API_KEY")
if not API_KEY:
    logger.warning("OPENAI_API_KEY not found in environment.")
else:
    logger.info("OPENAI_API_KEY loaded.")

async def chat(agent_id, message=None, text=None, history=None, config=None, context=None):
    """
    Proxy chat messages to the target agent with API key injection.
    Supports both 'message' and 'text' arguments for compatibility.
    """
    # Normalize input
    user_message = message or text
    if not user_message:
        raise ValueError("Message text is required (pass 'message' or 'text')")

    config = config or {}
    logger.info(f"Proxying chat for agent: {agent_id}")

    # Inject the API key
    if API_KEY:
        if "model_config" not in config:
            config["model_config"] = {}
        config["model_config"]["openai_api_key"] = API_KEY
        config["api_key"] = API_KEY
    else:
        logger.warning(f"No API Key available to inject for {agent_id}")

    try:
        # Get service via api proxy
        service = await api.get_service(agent_id)
        
        # Try calling with payload first (Hypha Chat convention)
        try:
             # Construct message history for Hypha Chat format
             messages = []
             if history and isinstance(history, list):
                 messages.extend(history)
             
             messages.append({"role": "user", "content": user_message})
             
             payload = {
                 "messages": messages,
                 "config": config
             }
             
             # Try payload style call
             logger.info(f"Attempting payload-style chat with {agent_id}")
             response = await service.chat(payload)
             return response
        except Exception as inner_e:
             logger.warning(f"Payload call failed: {inner_e}, falling back to kwargs")
             # Fallback to keyword arguments
             response = await service.chat(text=user_message, history=history, config=config)
             return response

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to proxy to service {agent_id}: {error_msg}")
        
        # Check for common "not found" indicators in the error message
        if "Service not found" in error_msg or "KeyError" in error_msg:
             return f"Error: The agent '{agent_id}' is currently offline or unreachable."
             
        return f"Error proxying to agent {agent_id}: {error_msg}"

api.export({
    "chat": chat,
    "config": {"visibility": "public", "require_context": True}
})
