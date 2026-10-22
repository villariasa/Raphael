import type { AiProvider, ChatMessage } from './provider';

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';

  // Default read lazily (not at module-eval time) so a .env file loaded
  // after this module is first required can still set RAPHAEL_OLLAMA_URL.
  constructor(private readonly baseUrl: string = process.env.RAPHAEL_OLLAMA_URL ?? 'http://127.0.0.1:11434') {}

  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: { name: string }[] };
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  async chat(messages: ChatMessage[], model: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          num_predict: 120,
          temperature: 0.3,
          top_p: 0.9
        }
      })
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
