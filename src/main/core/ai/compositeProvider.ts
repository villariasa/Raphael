import type { AiProvider, ChatMessage } from './provider';

/**
 * §3/§12: tries the primary provider (free LLM APIs) first; falls back to
 * the secondary provider (local Ollama) only if the primary is unreachable
 * or every configured free API fails.
 */
export class CompositeAiProvider implements AiProvider {
  readonly name = 'composite';

  constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
    private readonly fallbackModel: string
  ) {}

  async isReachable(): Promise<boolean> {
    return (await this.primary.isReachable()) || (await this.fallback.isReachable());
  }

  async listModels(): Promise<string[]> {
    const [primaryModels, fallbackModels] = await Promise.all([
      this.primary.listModels().catch(() => []),
      this.fallback.listModels().catch(() => [])
    ]);
    return [...primaryModels, ...fallbackModels];
  }

  async chat(messages: ChatMessage[], model: string): Promise<string> {
    if (await this.primary.isReachable()) {
      try {
        return await this.primary.chat(messages, model);
      } catch {
        // fall through to local Ollama
      }
    }
    return this.fallback.chat(messages, this.fallbackModel);
  }
}
