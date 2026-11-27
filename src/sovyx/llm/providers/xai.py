"""Sovyx xAI provider — Grok API (OpenAI-compatible)."""

from __future__ import annotations

from sovyx.llm.providers._openai_compat import OpenAICompatibleProvider, ProviderConfig

_XAI_CONFIG = ProviderConfig(
    name="xai",
    api_url="https://api.x.ai/v1/chat/completions",
    api_key_env="XGROK_API_KEY",
    default_model="grok-4.7",
    supported_prefixes=("grok-",),
    context_windows={
        "grok-4.7": 500_000,
        "grok-4.3": 1_000_000,
        "grok-4": 256_000,
        "grok-3": 131_072,
        "grok-2": 131_072,
    },
    default_context_window=500_000,
)


class XAIProvider(OpenAICompatibleProvider):
    """xAI Grok provider."""

    def __init__(self, api_key: str) -> None:
        super().__init__(_XAI_CONFIG, api_key)
