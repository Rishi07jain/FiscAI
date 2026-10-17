export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (object)
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface ChatOptions {
  system: string;
  history: ChatTurn[];
  message: string;
  tools: ToolDecl[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onText: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void;
  maxRounds?: number;
}

export interface LlmProvider {
  name: string;
  available: boolean;
  /** Generate JSON matching `schema`. Images are sent as inline data (cannot be redacted). */
  extractJson(opts: { system: string; prompt: string; schema: Record<string, unknown>; images?: { mimeType: string; data: Buffer }[] }): Promise<unknown>;
  embed(texts: string[]): Promise<number[][]>;
  chat(opts: ChatOptions): Promise<{ text: string }>;
}

export class LlmUnavailableError extends Error {
  constructor() { super('LLM is not configured (set GEMINI_API_KEY)'); }
}
