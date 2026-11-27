"""Sovyx DeepSeek provider — DeepSeek API (OpenAI-compatible)."""

from __future__ import annotations

from sovyx.llm.providers._openai_compat import OpenAICompatibleProvider, ProviderConfig

_DEEPSEEK_CONFIG = ProviderConfig(
    name="deepseek",
    api_url="https://api.deepseek.com/v1/chat/completions",
    api_key_env="DEEPSEEK_API_KEY",
    default_model="deepseek-v4-pro",
    supported_prefixes=("deepseek-",),
    context_windows={
        "deepseek-v4-pro": 1_048_576,
        "deepseek-flash": 1_048_576,
        "deepseek-chat": 128_000,
        "deepseek-reasoner": 128_000,
    },
    default_context_window=1_048_576,
)


class DeepSeekProvider(OpenAICompatibleProvider):
    """DeepSeek provider."""

    def __init__(self, api_key: str) -> None:
        super().__init__(_DEEPSEEK_CONFIG, api_key)
