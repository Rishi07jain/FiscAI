import { connectDb } from './db';
import { env, flags } from './env';
import { createApp } from './app';
import { startInlineScheduler } from './services/queue';
import { seedRules } from './services/rag';

async function main() {
  await connectDb();
  await seedRules();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`[api] FiscAI API on http://localhost:${env.PORT}`);
    console.log(`[api] llm=${flags.llm ? env.GEMINI_MODEL : 'off'} queue=${flags.redis ? 'bullmq' : 'inline'} email=${flags.smtp ? 'smtp' : 'console'} vector=${flags.atlasVector ? 'atlas' : 'local'}`);
  });
  startInlineScheduler();
  if (!env.MONGODB_URI && env.NODE_ENV !== 'production') {
    const { seedDemo } = await import('./scripts/demo');
    await seedDemo().catch((e) => console.warn('[seed] demo seed failed', e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
