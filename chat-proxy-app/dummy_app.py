import json
from typing import Any

from hypha_rpc import api


async def setup() -> dict[str, Any]:
    return {"ok": True, "mode": "dummy"}


async def chat_completion(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | str | None = None,
    model: str = "dummy-model",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_message = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            user_message = str(message.get("content", ""))
            break

    content = f"SYSTEM ONLINE (dummy). Echo: {user_message}"
    return {
        "id": "dummy-chat-completion",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": content,
                },
            }
        ],
        "model": model,
    }


api.export(
    {
        "config": {"visibility": "public"},
        "setup": setup,
        "chat_completion": chat_completion,
    }
)
