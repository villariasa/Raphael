/**
 * Provider-swappable AI interface (§3, §12). Ollama is the first and only
 * implementation; nothing outside this file knows that.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  readonly name: string;
  isReachable(): Promise<boolean>;
  listModels(): Promise<string[]>;
  chat(messages: ChatMessage[], model: string): Promise<string>;
}
