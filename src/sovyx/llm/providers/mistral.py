"""Sovyx Mistral provider — Mistral API (OpenAI-compatible)."""

from __future__ import annotations

from sovyx.llm.providers._openai_compat import OpenAICompatibleProvider, ProviderConfig

_MISTRAL_CONFIG = ProviderConfig(
    name="mistral",
    api_url="https://api.mistral.ai/v1/chat/completions",
    api_key_env="MISTRAL_API_KEY",
    default_model="mistral-large-4",
    supported_prefixes=("mistral-", "ministral-", "codestral-", "pixtral-", "open-"),
    context_windows={
        "mistral-large-4": 256_000,
        "mistral-small-4": 128_000,
        "mistral-large-latest": 128_000,
        "mistral-small-latest": 128_000,
    },
    default_context_window=256_000,
)


class MistralProvider(OpenAICompatibleProvider):
    """Mistral provider."""

    def __init__(self, api_key: str) -> None:
        super().__init__(_MISTRAL_CONFIG, api_key)
