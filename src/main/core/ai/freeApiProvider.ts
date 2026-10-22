import type { AiProvider, ChatMessage } from './provider';
import { FREE_API_PROVIDERS, type FreeApiProviderConfig } from './freeApiProviders';

/**
 * Primary AI provider (§3): tries every configured free-tier LLM API in
 * order, skipping providers with no API key set, and moves to the next on
 * failure. Falls back to local Ollama (see compositeProvider.ts) only if
 * none of these respond.
 */
export class FreeApiProvider implements AiProvider {
  readonly name = 'free-api';
  private lastUsedProvider: string | null = null;

  private configuredProviders(): FreeApiProviderConfig[] {
    return FREE_API_PROVIDERS.filter((p) => !!process.env[p.apiKeyEnv]);
  }

  getLastUsedProviderName(): string | null {
    return this.lastUsedProvider;
  }

  async isReachable(): Promise<boolean> {
    return this.configuredProviders().length > 0;
  }

  async listModels(): Promise<string[]> {
    return this.configuredProviders().map((p) => p.model);
  }

  async chat(messages: ChatMessage[], _model: string): Promise<string> {
    const candidates = this.configuredProviders();
    if (candidates.length === 0) {
      throw new Error('No free LLM API key is configured.');
    }

    let lastError: Error | null = null;
    for (const provider of candidates) {
      try {
        const reply = await this.chatWithProvider(provider, messages);
        this.lastUsedProvider = provider.name;
        return reply;
      } catch (err: any) {
        lastError = err;
      }
    }

    throw new Error(`All configured free LLM APIs failed: ${lastError?.message ?? 'unknown error'}`);
  }

  private async chatWithProvider(provider: FreeApiProviderConfig, messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env[provider.apiKeyEnv];
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: false,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      throw new Error(`${provider.name} request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${provider.name} returned an empty response.`);
    }
    return content;
  }
}
