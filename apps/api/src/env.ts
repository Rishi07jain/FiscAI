import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().optional(),
  /** Used when MONGODB_URI has no database in its path. */
  MONGODB_DB: z.string().default('fiscai'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  /** 32-byte key, base64 or hex, for AES-256-GCM field encryption. */
  ENCRYPTION_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  ATLAS_VECTOR_SEARCH: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('FiscAI <reminders@fiscai.local>'),
  APP_URL: z.string().default('http://localhost:5173'),
  RUN_SCHEDULER: z.enum(['true', 'false']).default('true'),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;

export const flags = {
  llm: Boolean(env.GEMINI_API_KEY),
  redis: Boolean(env.REDIS_URL),
  smtp: Boolean(env.SMTP_HOST),
  atlasVector: env.ATLAS_VECTOR_SEARCH === 'true',
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set in production');
}
