import { connectDb, disconnectDb } from '../db';
import { seedRules } from '../services/rag';
import { seedDemo } from './demo';

await connectDb();
await seedRules();
await seedDemo();
console.log('[seed] rule packs and rule cards seeded');
await disconnectDb();
