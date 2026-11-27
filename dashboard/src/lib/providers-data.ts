/**
 * Static metadata for the 10 supported LLM providers.
 * Used by the onboarding wizard to render provider cards.
 */

export interface ProviderMeta {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  envVar: string;
  keyPrefix: string;
  keyUrl: string;
  pricing: string;
  local?: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "ollama",
    name: "Ollama",
    description: "Run models locally. No API key. No cost. Full privacy.",
    defaultModel: "llama3.1:latest",
    envVar: "",
    keyPrefix: "",
    keyUrl: "https://ollama.com",
    pricing: "Free (local hardware)",
    local: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models. Strong reasoning and analysis.",
    defaultModel: "claude-sonnet-5-5",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
    pricing: "$2 / $10 per million tokens",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-6.2 Sol. Everyday coding and agents.",
    defaultModel: "gpt-6.2-sol",
    envVar: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    keyUrl: "https://platform.openai.com/api-keys",
    pricing: "$2 / $10 per million tokens",
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini 4 Hydrogen. 1M context window.",
    defaultModel: "gemini-4-hydrogen",
    envVar: "GOOGLE_API_KEY",
    keyPrefix: "AI",
    keyUrl: "https://aistudio.google.com/apikey",
    pricing: "$1.50 / $7.50 per million tokens",
  },
  {
    id: "xai",
    name: "xAI",
    description: "Grok models by xAI.",
    defaultModel: "grok-4.7",
    envVar: "XGROK_API_KEY",
    keyPrefix: "xai-",
    keyUrl: "https://console.x.ai",
    pricing: "$2 / $6 per million tokens",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Strong reasoning at low cost.",
    defaultModel: "deepseek-v4-pro",
    envVar: "DEEPSEEK_API_KEY",
    keyPrefix: "sk-",
    keyUrl: "https://platform.deepseek.com/api_keys",
    pricing: "$1.32 / $3.96 per million tokens (peak)",
  },
  {
    id: "mistral",
    name: "Mistral",
    description: "European AI. Fast and capable.",
    defaultModel: "mistral-large-4",
    envVar: "MISTRAL_API_KEY",
    keyPrefix: "",
    keyUrl: "https://console.mistral.ai/api-keys",
    pricing: "$2 / $6 per million tokens",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference. Free tier available.",
    defaultModel: "openai/gpt-oss-120b",
    envVar: "GROQ_API_KEY",
    keyPrefix: "gsk_",
    keyUrl: "https://console.groq.com/keys",
    pricing: "$0.15 / $0.60 per million tokens",
  },
  {
    id: "together",
    name: "Together",
    description: "Open-source models at scale.",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    envVar: "TOGETHER_API_KEY",
    keyPrefix: "",
    keyUrl: "https://api.together.ai/settings/api-keys",
    pricing: "$0.88 per million tokens",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    description: "Fast open-source model hosting.",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    envVar: "FIREWORKS_API_KEY",
    keyPrefix: "fw_",
    keyUrl: "https://fireworks.ai/account/api-keys",
    pricing: "$0.90 per million tokens",
  },
];

export function getProvider(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
