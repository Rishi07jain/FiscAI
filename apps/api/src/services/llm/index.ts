import { createGeminiProvider } from './gemini';
import type { LlmProvider } from './types';

export * from './types';

let provider: LlmProvider | null = null;

/** Provider-agnostic entry point (Gemini today). */
export function llm(): LlmProvider {
  if (!provider) provider = createGeminiProvider();
  return provider;
}

/** For tests: inject a fake provider. */
export function setLlmProvider(p: LlmProvider | null) {
  provider = p;
}
