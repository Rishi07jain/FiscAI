import bcrypt from 'bcryptjs';
import { AisEntryModel, FnoTradeModel, HouseholdMemberModel, LotModel, User } from '../models';
import { syncDeadlines } from '../services/deadlines';
import { saveProfile } from '../services/profile';

/** Demo account (credentials come from DEMO_EMAIL / DEMO_PASSWORD; see apps/api/.env.example). */
export async function seedDemo() {
  const email = process.env.DEMO_EMAIL ?? 'demo@fiscai.local';
  const password = process.env.DEMO_PASSWORD;
  if (!password) return console.log('[seed] DEMO_PASSWORD not set; skipping demo account');
  if (await User.exists({ email })) return;
  const user = await User.create({
    email, name: 'Arjun (demo)', passwordHash: await bcrypt.hash(password, 10),
    consentFlags: { terms: true, documentProcessing: true, emailReminders: true, keepUploadedFiles: false, consentedAt: new Date() },
    onboardedAt: new Date(), activeTaxYear: '2026-27',
  });
  const userId = user._id;
  // Arjun: 31, Mumbai, Rs 28 lakh salary, stocks and equity MFs (persona from the PRD).
  await saveProfile(userId, '2026-27', {
    taxYear: '2026-27', regime: 'new',
    personal: { ageBand: 'below60', residency: 'resident', city: 'Mumbai', employmentType: 'salaried', incomeSources: ['salary', 'capital_gains', 'interest', 'dividends', 'fno'], parentsSenior: true },
    salary: { employerName: 'Acme Tech Pvt Ltd', basic: 1120000, hra: 560000, specialAllowance: 980000, bonus: 140000, professionalTax: 2500, rentPaid: 660000 },
    otherIncome: { savingsInterest: 14000, fdInterest: 42000, dividends: 18000 },
    deductions: { sec80C: 150000, healthSelf: 18000, healthParents: 32000 },
    capitalGains: [
      { id: 'demo-1', label: 'INFY × 120', assetType: 'listed_equity', buyDate: '2023-05-10', sellDate: '2026-06-20', cost: 156000, saleValue: 228000 },
      { id: 'demo-2', label: 'Parag Parikh Flexi Cap', assetType: 'equity_mf', buyDate: '2026-01-15', sellDate: '2026-07-02', cost: 200000, saleValue: 231000 },
    ],
    business: { fnoTurnover: 380000, fnoProfit: -85000 },
    taxesPaid: { tds: 380000, advancePayments: [{ date: '2026-06-12', amount: 15000 }] },
  }, 'onboarding');
  await LotModel.insertMany([
    { userId, symbol: 'HDFCBANK', assetType: 'listed_equity', qty: 80, buyDate: '2024-02-12', buyPrice: 1420, currentPrice: 1985, source: 'demo' },
    { userId, symbol: 'TCS', assetType: 'listed_equity', qty: 40, buyDate: '2025-11-20', buyPrice: 3310, currentPrice: 4120, source: 'demo' },
    { userId, symbol: 'ASIANPAINT', assetType: 'listed_equity', qty: 30, buyDate: '2025-03-04', buyPrice: 2950, currentPrice: 2410, source: 'demo' },
    { userId, symbol: 'NIFTYBEES', assetType: 'listed_equity', qty: 600, buyDate: '2023-09-01', buyPrice: 215, currentPrice: 292, source: 'demo' },
    { userId, symbol: 'UTI Nifty 50 Index Fund', assetType: 'equity_mf', qty: 1450.32, buyDate: '2026-04-15', buyPrice: 162.4, currentPrice: 171.2, source: 'demo' },
  ]);
  await FnoTradeModel.insertMany([
    { userId, taxYear: '2026-27', date: '2026-05-08', symbol: 'NIFTY26MAYFUT', segment: 'FUT', pnl: 42000, sellValue: 2400000, charges: 1200, source: 'demo' },
    { userId, taxYear: '2026-27', date: '2026-06-19', symbol: 'BANKNIFTY 52000 CE', segment: 'OPT', pnl: -96000, sellValue: 310000, charges: 2100, source: 'demo' },
    { userId, taxYear: '2026-27', date: '2026-08-14', symbol: 'NIFTY 24500 PE', segment: 'OPT', pnl: -31000, sellValue: 120000, charges: 900, source: 'demo' },
  ]);
  await AisEntryModel.insertMany([
    { userId, taxYear: '2026-27', category: 'interest_savings', source: 'HDFC Bank', amount: 14000 },
    { userId, taxYear: '2026-27', category: 'interest_fd', source: 'SBI', amount: 58000, tds: 5800 },
    { userId, taxYear: '2026-27', category: 'dividend', source: 'Infosys Ltd', amount: 18000, tds: 1800 },
    { userId, taxYear: '2026-27', category: 'salary', source: 'Acme Tech Pvt Ltd', amount: 2800000, tds: 380000 },
  ]);
  await HouseholdMemberModel.insertMany([
    { userId, name: 'Sunita', relation: 'mother', ageBand: '60to79', profile: { otherIncome: { fdInterest: 260000 }, regime: 'new' }, healthPremiumPaidByUser: 32000, giftsFromUser: 300000 },
    { userId, name: 'Neha', relation: 'spouse', ageBand: 'below60', profile: { salary: { basic: 900000 } }, healthPremiumPaidByUser: 0, giftsFromUser: 500000 },
  ]);
  await syncDeadlines(userId, '2026-27');
  console.log(`[seed] demo account ready: ${email}`);
}
