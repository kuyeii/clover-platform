from __future__ import annotations

from typing import Any

PREFERRED_APP_ORDER = (
    "portal",
    "contract-review",
    "rag-web-search",
    "competitor-analysis",
    "bid-generator",
)


def iter_ordered_apps(apps_config: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    apps = apps_config.get("apps") or {}
    if not isinstance(apps, dict):
        raise ValueError("config/apps.yaml must contain an apps mapping")
    items = [(str(key), app) for key, app in apps.items() if isinstance(app, dict)]
    return sorted(
        items,
        key=lambda item: PREFERRED_APP_ORDER.index(str(item[1].get("code")))
        if str(item[1].get("code")) in PREFERRED_APP_ORDER
        else len(PREFERRED_APP_ORDER),
    )


def app_by_code(apps_config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(app.get("code") or key): app for key, app in iter_ordered_apps(apps_config)}


def token_to_code_map(apps_config: dict[str, Any]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for key, app in iter_ordered_apps(apps_config):
        code = str(app.get("code") or key)
        module_key = str(app.get("module_key") or key)
        mapping[key] = code
        mapping[code] = code
        mapping[module_key] = code
    return mapping


def available_app_codes(apps_config: dict[str, Any]) -> list[str]:
    return [str(app.get("code") or key) for key, app in iter_ordered_apps(apps_config)]


def available_module_keys(apps_config: dict[str, Any]) -> list[str]:
    return [str(app.get("module_key") or key) for key, app in iter_ordered_apps(apps_config)]


def auto_start_codes(apps_config: dict[str, Any]) -> set[str]:
    return {
        str(app.get("code") or key)
        for key, app in iter_ordered_apps(apps_config)
        if bool((app.get("dev") or {}).get("enabled", False))
    }


def unknown_token_message(token: str, apps_config: dict[str, Any]) -> str:
    app_codes_text = "\n".join(f"  {code}" for code in available_app_codes(apps_config))
    module_keys_text = "\n".join(f"  {module_key}" for module_key in available_module_keys(apps_config))
    return (
        f"Unknown app token: {token}\n\n"
        f"Available app codes:\n{app_codes_text}\n\n"
        f"Available module keys:\n{module_keys_text}"
    )


def resolve_app_tokens(apps_config: dict[str, Any], tokens: list[str]) -> set[str]:
    mapping = token_to_code_map(apps_config)
    resolved: set[str] = set()
    for token in tokens:
        normalized = token.strip()
        if normalized not in mapping:
            raise ValueError(unknown_token_message(normalized, apps_config))
        resolved.add(mapping[normalized])
    return resolved


def select_app_codes(
    apps_config: dict[str, Any],
    *,
    no_business: bool = False,
    only: set[str] | None = None,
    skip: set[str] | None = None,
    default_all: bool = False,
) -> set[str] | None:
    if no_business:
        selected: set[str] | None = {"portal"}
    elif only:
        selected = set(only)
    elif default_all:
        selected = None
    else:
        selected = auto_start_codes(apps_config)

    if selected is not None and skip:
        selected = {code for code in selected if code not in skip}
    return selected
