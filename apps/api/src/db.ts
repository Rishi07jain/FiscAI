import mongoose from 'mongoose';
import { env } from './env';

let memoryServer: { stop: () => Promise<boolean> } | null = null;

export async function connectDb(uri = env.MONGODB_URI): Promise<string> {
  let target = uri;
  if (!target) {
    if (env.NODE_ENV === 'production') throw new Error('MONGODB_URI is required in production');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    memoryServer = server;
    target = server.getUri('fiscai');
    console.warn('[db] MONGODB_URI not set — using an in-memory MongoDB. Data resets on restart.');
  }
  mongoose.set('strictQuery', true);
  // Atlas URIs often end in "/" with no database name; Mongo would then default to "test".
  const hasDb = /^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(target);
  await mongoose.connect(target, hasDb ? {} : { dbName: env.MONGODB_DB });
  return target;
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
}
