import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env, flags } from './env';
import { errorHandler } from './lib/http';
import { assistantRouter } from './routes/assistant';
import { authRouter, meRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';
import { p2Router } from './routes/p2';
import { plannerRouter } from './routes/planner';
import { portfolioRouter } from './routes/portfolio';
import { profilesRouter } from './routes/profiles';
import { rulesRouter } from './routes/rules';
import { scenariosRouter } from './routes/scenarios';
import { taxRouter } from './routes/tax';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({
    taxYears: ['2026-27', '2025-26'],
    defaultTaxYear: '2026-27',
    features: { llm: flags.llm, queue: flags.redis ? 'bullmq' : 'inline', email: flags.smtp ? 'smtp' : 'console', vectorSearch: flags.atlasVector ? 'atlas' : flags.llm ? 'in-memory' : 'keyword' },
    disclaimer: 'FiscAI provides tax estimates and explanations for information only. It is not a chartered accountant and does not file returns. Verify important decisions with a qualified professional.',
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/tax', taxRouter);
  app.use('/api/scenarios', scenariosRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api', plannerRouter); // /advance-tax, /deadlines, /deductions
  app.use('/api/assistant', assistantRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api', p2Router); // /fno, /itr, /ais, /vda, /household
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
