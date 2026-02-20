import re

MAX_APP_ID_LENGTH = 63


def slugify_branch_name(branch_name: str) -> str:
    normalized = branch_name.strip().lower().replace("_", "-").replace("/", "-")
    normalized = re.sub(r"[^a-z0-9-]", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized or "branch"


def make_dev_app_id(branch_name: str, prefix: str = "chat-proxy-dev") -> str:
    branch_slug = slugify_branch_name(branch_name)
    suffix_budget = MAX_APP_ID_LENGTH - len(prefix) - 1
    if suffix_budget <= 0:
        return prefix[:MAX_APP_ID_LENGTH]
    trimmed_slug = branch_slug[:suffix_budget]
    return f"{prefix}-{trimmed_slug}" if trimmed_slug else prefix


def build_service_alias(workspace: str, app_id: str) -> str:
    return f"{workspace}/default@{app_id}"
