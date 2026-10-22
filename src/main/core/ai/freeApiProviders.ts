/**
 * Registry of free-tier LLM API providers (OpenAI-compatible `/chat/completions`
 * shape) sourced from https://github.com/open-free-llm-api/awesome-freellm-apis.
 *
 * RANKED BY INTELLIGENCE, POWER & SPEED (Tier 1 Flagship -> Tier 2 Deep -> Tier 3 Fast):
 * 1. Groq (70B at 250+ tok/s, ultra-low latency, flagship reasoning)
 * 2. Google Gemini (1M context, best multimodal, zero latency)
 * 3. Cerebras (Wafer-scale 1000 tok/s, Llama 3.1 70B)
 * 4. NVIDIA NIM (Enterprise GPU cluster, Llama 3.2 vision/instruct)
 * 5. DeepSeek (DeepSeek-V3 / R1 reasoning)
 * 6. SambaNova (Fast 70B / V3 hosting)
 * 7. OpenRouter (Multi-model free router)
 * 8. ModelScope (Alibaba Qwen 2.5 72B flagship)
 * 9. Mistral AI (European multilingual open model)
 * 10. Hugging Face (Serverless Llama 8B)
 * 11. Zhipu AI (GLM-4 Flash)
 * 12. xAI Grok (Fast conversational)
 *
 * Each entry activates ONLY if its API key env var is set in .env.
 */
export interface FreeApiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
}

export const FREE_API_PROVIDERS: FreeApiProviderConfig[] = [
  // --- TIER 1: FLAGSHIP INTELLIGENCE & ULTRA-SPEED ---
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    model: 'llama3.1-70b'
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    model: 'meta/llama-3.2-11b-vision-instruct'
  },

  // --- TIER 2: ADVANCED REASONING & HIGH-CAPACITY MODELS ---
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat'
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyEnv: 'SAMBANOVA_API_KEY',
    model: 'DeepSeek-V3.1'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    model: 'meta-llama/llama-3.3-70b-instruct:free'
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    apiKeyEnv: 'MODELSCOPE_API_KEY',
    model: 'Qwen/Qwen2.5-72B-Instruct'
  },

  // --- TIER 3: RELIABLE LIGHTWEIGHT & FALLBACK MODELS ---
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    model: 'open-mistral-7b'
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
    model: 'meta-llama/Llama-3.1-8B-Instruct'
  },
  {
    id: 'zhipu',
    name: 'Z AI (Zhipu)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    model: 'glm-4.7-flash'
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    model: 'grok-4.1-fast'
  }
];
