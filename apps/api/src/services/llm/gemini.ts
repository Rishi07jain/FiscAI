import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { env } from '../../env';
import { LlmUnavailableError, type ChatOptions, type LlmProvider } from './types';

export function createGeminiProvider(): LlmProvider {
  const apiKey = env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  const need = () => { if (!ai) throw new LlmUnavailableError(); return ai; };

  return {
    name: 'gemini',
    available: Boolean(ai),

    async extractJson({ system, prompt, schema, images }) {
      const client = need();
      const parts: Part[] = [{ text: prompt }];
      for (const img of images ?? []) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } });
      const res = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0 },
      });
      const text = res.text ?? '';
      return JSON.parse(text);
    },

    async embed(texts) {
      const client = need();
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 50) {
        const res = await client.models.embedContent({ model: env.GEMINI_EMBED_MODEL, contents: texts.slice(i, i + 50), config: { outputDimensionality: 768 } });
        for (const e of res.embeddings ?? []) out.push(e.values ?? []);
      }
      return out;
    },

    async chat(o: ChatOptions) {
      const client = need();
      const contents: Content[] = o.history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
      contents.push({ role: 'user', parts: [{ text: o.message }] });
      const config = {
        systemInstruction: o.system,
        temperature: 0.2,
        tools: [{ functionDeclarations: o.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
      };
      let finalText = '';
      for (let round = 0; round < (o.maxRounds ?? 6); round++) {
        const stream = await client.models.generateContentStream({ model: env.GEMINI_MODEL, contents, config });
        const modelParts: Part[] = [];
        const calls: { name: string; args: Record<string, unknown>; id?: string }[] = [];
        let roundText = '';
        for await (const chunk of stream) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            modelParts.push(p);
            if (p.functionCall?.name) calls.push({ name: p.functionCall.name, args: (p.functionCall.args ?? {}) as Record<string, unknown>, id: p.functionCall.id });
            else if (p.text && !p.thought) { roundText += p.text; o.onText(p.text); }
          }
        }
        // Keep the model turn as-is (including thought signatures) for the next round.
        contents.push({ role: 'model', parts: modelParts });
        finalText += roundText;
        if (!calls.length) break;
        const responses: Part[] = [];
        for (const c of calls) {
          let result: unknown;
          try { result = await o.callTool(c.name, c.args); } catch (e) { result = { error: (e as Error).message }; }
          o.onToolCall?.(c.name, c.args, result);
          responses.push({ functionResponse: { name: c.name, id: c.id, response: { output: result } } });
        }
        contents.push({ role: 'user', parts: responses });
      }
      return { text: finalText };
    },
  };
}
