import { env, flags } from '../env';

/**
 * Background jobs. With REDIS_URL set, jobs go to BullMQ and run in apps/worker.
 * Without Redis (local dev), they run in-process right after the request returns.
 */
type JobName = 'processDocument';

let queue: import('bullmq').Queue | null = null;

async function getQueue() {
  if (!queue) {
    const { Queue } = await import('bullmq');
    const { default: IORedis } = await import('ioredis');
    queue = new Queue('fiscai', { connection: new IORedis(env.REDIS_URL!, { maxRetriesPerRequest: null }) });
  }
  return queue;
}

export async function enqueue(name: JobName, data: { documentId: string; encPassword?: string }): Promise<string> {
  if (flags.redis) {
    const q = await getQueue();
    const job = await q.add(name, data, { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
    return String(job.id);
  }
  const { processDocument } = await import('../jobs/processDocument');
  setImmediate(() => { processDocument(data.documentId, data.encPassword).catch((e) => console.error('[job] processDocument failed', e)); });
  return `inline-${data.documentId}`;
}

/** In-process scheduler for reminders when there is no worker. */
export function startInlineScheduler() {
  if (flags.redis || env.RUN_SCHEDULER !== 'true' || env.NODE_ENV === 'test') return;
  const run = async () => {
    try {
      const { sendDueReminders } = await import('../jobs/reminders');
      const r = await sendDueReminders();
      if (r.sent) console.log(`[scheduler] sent ${r.sent} reminder(s)`);
    } catch (e) {
      console.error('[scheduler] reminders failed', e);
    }
  };
  setTimeout(run, 10_000);
  setInterval(run, 60 * 60 * 1000).unref();
}
