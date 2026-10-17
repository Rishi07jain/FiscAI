import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/db';
import { seedRules } from '../src/services/rag';
import { redact } from '../src/lib/redact';
import { decrypt, encrypt } from '../src/lib/crypto';

let mongo: MongoMemoryServer;
const app = createApp();
const agent = request.agent(app);
const TY = '2026-27';

const waitFor = async (fn: () => Promise<boolean>, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timeout');
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri('fiscai-test'));
  await seedRules();
});
afterAll(async () => {
  await disconnectDb();
  await mongo.stop();
});

describe('security helpers', () => {
  it('redacts PAN, Aadhaar, account numbers and emails but keeps amounts', () => {
    const r = redact('PAN ABCDE1234F Aadhaar 2345 6789 0123 A/c 123456789012 mail a@b.com salary 12,50,000 total 1500000');
    expect(r.text).not.toMatch(/ABCDE1234F|2345 6789 0123|123456789012|a@b\.com/);
    expect(r.text).toContain('12,50,000');
    expect(r.text).toContain('1500000');
  });
  it('AES-256-GCM round trip', () => {
    const e = encrypt('ABCDE1234F')!;
    expect(e).not.toContain('ABCDE');
    expect(decrypt(e)).toBe('ABCDE1234F');
  });
});

describe('API flow', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(`/api/profiles/${TY}`).expect(401);
  });

  it('registers with consent and sets an httpOnly cookie', async () => {
    const r = await agent.post('/api/auth/register').send({ email: 'priya@example.com', password: 'longpassword', name: 'Priya', consent: { terms: true, documentProcessing: true } }).expect(201);
    expect(r.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
  });

  it('onboarding (5 questions + manual salary) → tax summary', async () => {
    await agent.post(`/api/profiles/${TY}/onboarding`).send({ ageBand: 'below60', city: 'Bengaluru', employmentType: 'salaried', monthlyRent: 30000, incomeSources: ['salary'], manualSalary: { gross: 1400000, basic: 560000, hra: 280000, tds: 50000 } }).expect(200);
    const s = await agent.get(`/api/tax/summary/${TY}`).expect(200);
    expect(s.body.result.totalTax).toBe(computeExpectedNew());
    expect(s.body.comparison.recommended).toBe('new');
    expect(s.body.result.lines.every((l: any) => typeof l.explain === 'string')).toBe(true);
  });

  it('profile is versioned and sensitive fields are encrypted at rest', async () => {
    const { body } = await agent.get(`/api/profiles/${TY}`).expect(200);
    body.profile.personal.pan = 'ABCDE1234F';
    await agent.put(`/api/profiles/${TY}`).send(body.profile).expect(200);
    const v = await agent.get(`/api/profiles/${TY}/versions`).expect(200);
    expect(v.body.versions.length).toBe(2);
    const mongoose = (await import('mongoose')).default;
    const raw = await mongoose.connection.db!.collection('taxProfiles').findOne({});
    expect(JSON.stringify(raw)).not.toContain('ABCDE1234F');
    const again = await agent.get(`/api/profiles/${TY}`).expect(200);
    expect(again.body.profile.personal.pan).toBe('ABCDE1234F');
  });

  it('regime comparison with break-even', async () => {
    const r = await agent.get(`/api/tax/compare/${TY}`).expect(200);
    expect(r.body.breakEvenDeductions).toBeGreaterThan(0);
  });

  it('scenario: run, save, list, apply (profile changes only on apply)', async () => {
    const before = (await agent.get(`/api/profiles/${TY}`)).body;
    const r = await agent.post('/api/scenarios').send({ taxYear: TY, type: 'invest_deduction', inputs: { kind: 'healthParents', amount: 25000 }, save: true }).expect(201);
    expect((await agent.get(`/api/profiles/${TY}`)).body.version).toBe(before.version);
    expect((await agent.get('/api/scenarios')).body.scenarios.length).toBe(1);
    await agent.post(`/api/scenarios/${r.body.scenario.id}/apply`).expect(200);
    const after = (await agent.get(`/api/profiles/${TY}`)).body;
    expect(after.version).toBe(before.version + 1);
    expect(after.profile.deductions.healthParents).toBe(25000);
  });

  it('document upload (broker CSV) → review → confirm into lots', async () => {
    const csv = 'Symbol,ISIN,Quantity,Buy Date,Buy Value,Sell Date,Sell Value\nINFY,INE009A01021,10,2024-01-10,15000,2026-06-01,19000\nNIFTY26JUNFUT,,50,2026-06-01,0,2026-06-20,0\n';
    const up = await agent.post('/api/documents').field('type', 'broker_pnl').field('taxYear', TY).attach('file', Buffer.from(csv), { filename: 'pnl.csv', contentType: 'text/csv' }).expect(202);
    const id = up.body.document.id;
    await waitFor(async () => (await agent.get(`/api/documents/${id}`)).body.document.status === 'needs_review');
    const d = await agent.get(`/api/documents/${id}`).expect(200);
    const lot = d.body.extractedFields.find((f: any) => f.path === 'lots[]');
    expect(lot.value).toMatchObject({ symbol: 'INFY', qty: 10, buyDate: '2024-01-10', sellDate: '2026-06-01' });
    expect(lot.sourceRef).toBe('row 2');
    const c = await agent.post(`/api/documents/${id}/confirm`).send({ fields: d.body.extractedFields }).expect(200);
    expect(c.body.applied.lots).toBe(1);
    const doc = await agent.get(`/api/documents/${id}`);
    expect(doc.body.document.fileDeleted).toBe(true);
    const p = await agent.get(`/api/portfolio?taxYear=${TY}&asOf=2026-10-01`).expect(200);
    expect(p.body.totals.realisedLT).toBe(4000);
  });

  it('advance tax, deadlines, deductions, ITR, AIS, VDA, household endpoints', async () => {
    expect((await agent.get(`/api/advance-tax/${TY}?asOf=2026-10-01`).expect(200)).body.instalments).toHaveLength(4);
    const dl = await agent.get(`/api/deadlines?taxYear=${TY}`).expect(200);
    expect(dl.body.deadlines.some((d: any) => d.type === 'itr_due')).toBe(true);
    expect((await agent.get(`/api/deductions/${TY}`).expect(200)).body.headroom.length).toBeGreaterThan(3);
    expect((await agent.get(`/api/itr/${TY}`).expect(200)).body.form.form).toBe('ITR-1');
    const pdf = await agent.get(`/api/itr/${TY}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await agent.post('/api/ais/entries').send({ taxYear: TY, category: 'interest_fd', source: 'SBI', amount: 20000 }).expect(201);
    const ais = (await agent.get(`/api/ais/${TY}`).expect(200)).body;
    expect(ais.items.find((i: any) => i.category === 'interest_fd').severity).toBe('high');
    expect(ais.items.find((i: any) => i.category === 'tds').severity).toBe('high'); // claims TDS the AIS does not show
    await agent.put(`/api/vda/${TY}`).send({ txns: [{ asset: 'BTC', cost: 100000, saleValue: 150000, tdsDeducted: 1500 }] }).expect(200);
    expect((await agent.get(`/api/vda/${TY}`).expect(200)).body.tax).toBe(15000);
    await agent.post('/api/household/members').send({ name: 'Mom', relation: 'mother', ageBand: '60to79', healthPremiumPaidByUser: 30000 }).expect(201);
    expect((await agent.get(`/api/household/${TY}`).expect(200)).body.healthInsurance).toHaveLength(1);
    await agent.post('/api/fno/trades').send({ taxYear: TY, date: '2026-05-01', symbol: 'NIFTY FUT', segment: 'FUT', pnl: -20000, sellValue: 1000000 }).expect(201);
    expect((await agent.get(`/api/fno/${TY}`).expect(200)).body.summary.sttImpact.increase).toBe(300);
  });

  it('assistant streams SSE with a citation (fallback mode without LLM key)', async () => {
    const r = await agent.post('/api/assistant/chat').send({ message: 'Which regime is better for me?', taxYear: TY }).buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => cb(null, d)); });
    const text = r.body as string;
    expect(text).toContain('event: session');
    expect(text).toContain('event: citations');
    expect(text).toContain('event: done');
    expect(text).toMatch(/REGIME-NEW/);
  });

  it('rule card lookup with both Act references', async () => {
    const r = await request(app).get('/api/rules/ADV-234B').expect(200);
    expect(r.body.card.refs).toEqual({ ita1961: '234B', ita2025: '424' });
  });

  it('export then delete account removes all data', async () => {
    const ex = await agent.get('/api/me/export').expect(200);
    expect(ex.body.taxProfiles.length).toBe(1);
    await agent.delete('/api/me').expect(200);
    await agent.get('/api/me').expect(401);
    const mongoose = (await import('mongoose')).default;
    expect(await mongoose.connection.db!.collection('taxProfiles').countDocuments()).toBe(0);
    expect(await mongoose.connection.db!.collection('lots').countDocuments()).toBe(0);
  });
});

function computeExpectedNew() {
  // gross 14L → 13.25L net; 60,000 + 15% of 1.25L = 78,750; +4% = 81,900
  return 81900;
}
