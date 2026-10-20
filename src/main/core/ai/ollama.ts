import type { AiProvider, ChatMessage } from './provider';

const DEFAULT_BASE_URL = process.env.RAPHAEL_OLLAMA_URL ?? 'http://127.0.0.1:11434';

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';

  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

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
      body: JSON.stringify({ model, messages, stream: false })
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
