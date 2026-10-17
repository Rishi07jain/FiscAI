import { connectDb } from '@fiscai/api';
import { processDocument, sendDueReminders } from '@fiscai/api/jobs';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Runs slow work outside the request cycle: document extraction and reminder emails.
 * Requires REDIS_URL (BullMQ). Without Redis the API runs these jobs in-process instead.
 */
const url = process.env.REDIS_URL;
if (!url) {
  console.error('[worker] REDIS_URL is not set. Without Redis, the API runs jobs in-process; the worker is not needed.');
  process.exit(1);
}

await connectDb();
const connection = new IORedis(url, { maxRetriesPerRequest: null });

const worker = new Worker('fiscai', async (job) => {
  if (job.name === 'processDocument') return processDocument(job.data.documentId, job.data.encPassword);
  if (job.name === 'sendReminders') return sendDueReminders();
  throw new Error(`Unknown job ${job.name}`);
}, { connection, concurrency: 4 });

worker.on('completed', (job) => console.log(`[worker] ${job.name} ${job.id} done`));
worker.on('failed', (job, err) => console.error(`[worker] ${job?.name} ${job?.id} failed: ${err.message}`));

// Hourly reminder sweep (30/7/1 days before each deadline).
const queue = new Queue('fiscai', { connection });
await queue.upsertJobScheduler('reminders-hourly', { every: 60 * 60 * 1000 }, { name: 'sendReminders' });
console.log('[worker] FiscAI worker running');
