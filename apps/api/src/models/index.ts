import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const { Mixed, ObjectId } = Schema.Types;
const ts = { timestamps: true } as const;

// ---- users ------------------------------------------------------------------
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: '' },
  consentFlags: {
    terms: { type: Boolean, default: false },
    documentProcessing: { type: Boolean, default: false },
    emailReminders: { type: Boolean, default: true },
    keepUploadedFiles: { type: Boolean, default: false },
    consentedAt: Date,
  },
  activeTaxYear: { type: String, default: '2026-27' },
  onboardedAt: Date,
  metrics: {
    firstSummaryAt: Date,
    firstUploadAt: Date,
    scenariosRun: { type: Number, default: 0 },
    taxSavedEstimate: { type: Number, default: 0 },
  },
}, ts);
export const User = mongoose.model('User', UserSchema);
export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };

// ---- taxProfiles (one per user per Tax Year) + version history --------------
const TaxProfileSchemaM = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  taxYear: { type: String, required: true },
  version: { type: Number, default: 1 },
  data: { type: Mixed, required: true }, // validated by Zod; sensitive fields encrypted
}, ts);
TaxProfileSchemaM.index({ userId: 1, taxYear: 1 }, { unique: true });
export const TaxProfileModel = mongoose.model('TaxProfile', TaxProfileSchemaM, 'taxProfiles');

const ProfileVersionSchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  version: Number,
  data: Mixed,
  source: { type: String, default: 'manual' }, // manual | onboarding | document:<id> | scenario:<id> | portfolio | fno
  changedPaths: [String],
}, ts);
export const ProfileVersion = mongoose.model('ProfileVersion', ProfileVersionSchema, 'profileVersions');

// ---- documents ------------------------------------------------------------------
const ExtractedFieldSchema = new Schema({
  path: String,
  label: String,
  value: Mixed,
  confidence: Number,
  sourceRef: String,
  accepted: { type: Boolean, default: true },
}, { _id: false });

const DocumentSchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: { type: String, required: true },
  type: { type: String, required: true },
  filename: String,
  mimeType: String,
  size: Number,
  status: { type: String, enum: ['uploaded', 'parsing', 'needs_review', 'confirmed', 'failed'], default: 'uploaded' },
  error: String,
  extractedFields: [ExtractedFieldSchema],
  pagesPreview: [{ ref: String, text: String }], // redacted snippets shown beside fields
  method: String, // deterministic | llm | llm-vision
  fileRef: ObjectId, // GridFS id
  keepFile: { type: Boolean, default: false },
  deletedAt: Date,
  jobId: String,
  redactions: Mixed,
}, ts);
export const DocumentModel = mongoose.model('Document', DocumentSchema, 'documents');

// ---- lots -------------------------------------------------------------------------
const LotSchemaM = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  assetType: { type: String, default: 'listed_equity' },
  symbol: { type: String, required: true },
  isin: String,
  qty: Number,
  buyDate: String,
  buyPrice: Number,
  currentPrice: Number,
  sellDate: String,
  sellPrice: Number,
  charges: { type: Number, default: 0 },
  source: { type: String, default: 'manual' },
}, ts);
export const LotModel = mongoose.model('Lot', LotSchemaM, 'lots');

// ---- scenarios ---------------------------------------------------------------------
const ScenarioSchemaM = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  baseProfileVersion: Number,
  name: String,
  type: String,
  inputs: Mixed,
  resultSnapshot: Mixed,
  afterProfile: Mixed,
  appliedAt: Date,
  savedAt: { type: Date, default: Date.now },
}, ts);
export const ScenarioModel = mongoose.model('Scenario', ScenarioSchemaM, 'scenarios');

// ---- rulePacks (read-only, seeded) ---------------------------------------------------
const RulePackSchemaM = new Schema({
  packId: { type: String, unique: true },
  act: String,
  taxYear: String,
  regime: String,
  rules: Mixed,
  effectiveFrom: String,
  sourceUrls: [String],
}, ts);
export const RulePackModel = mongoose.model('RulePack', RulePackSchemaM, 'rulePacks');

// ---- computations (cache) -------------------------------------------------------------
const ComputationSchema = new Schema({
  userId: { type: ObjectId, index: true },
  profileHash: { type: String, index: true },
  packId: String,
  result: Mixed,
  trace: Mixed,
}, ts);
ComputationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
export const ComputationModel = mongoose.model('Computation', ComputationSchema, 'computations');

// ---- deadlines ---------------------------------------------------------------------------
const DeadlineSchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  key: { type: String, required: true }, // stable dedupe key
  type: String,
  title: String,
  dueDate: String,
  triggerEvent: String,
  ruleId: String,
  amount: Number,
  origin: { type: String, default: 'generated' }, // generated | scenario | custom
  status: { type: String, enum: ['open', 'done', 'dismissed'], default: 'open' },
  remindAt: [String],
  remindersSent: [String],
}, ts);
DeadlineSchema.index({ userId: 1, key: 1 }, { unique: true });
export const DeadlineModel = mongoose.model('Deadline', DeadlineSchema, 'deadlines');

// ---- ruleCards (retrieval corpus) -------------------------------------------------------
const RuleCardSchema = new Schema({
  ruleId: { type: String, unique: true },
  title: String,
  body: String,
  refs: { ita1961: String, ita2025: String },
  status: String,
  sourceUrl: String,
  tags: [String],
  embedding: { type: [Number], default: undefined },
  embeddingModel: String,
}, ts);
export const RuleCardModel = mongoose.model('RuleCard', RuleCardSchema, 'ruleCards');

// ---- chatSessions ------------------------------------------------------------------------
const ChatSessionSchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  title: String,
  messages: [{ role: String, text: String, citations: [String], scenario: Mixed, rating: Number, at: { type: Date, default: Date.now } }],
  toolCalls: [{ name: String, args: Mixed, result: Mixed, at: { type: Date, default: Date.now } }],
}, ts);
export const ChatSession = mongoose.model('ChatSession', ChatSessionSchema, 'chatSessions');

// ---- P2 collections ---------------------------------------------------------------------
const FnoTradeSchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  date: String,
  symbol: String,
  segment: { type: String, enum: ['FUT', 'OPT', 'INTRADAY_EQ'] },
  pnl: Number,
  sellValue: Number,
  exercised: Boolean,
  exerciseValue: Number,
  charges: Number,
  stt: Number,
  source: { type: String, default: 'manual' },
}, ts);
export const FnoTradeModel = mongoose.model('FnoTrade', FnoTradeSchema, 'fnoTrades');

const AisEntrySchema = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  taxYear: String,
  category: String,
  source: String,
  amount: Number,
  tds: Number,
  date: String,
  documentId: ObjectId,
}, ts);
export const AisEntryModel = mongoose.model('AisEntry', AisEntrySchema, 'aisEntries');

const HouseholdMemberSchemaM = new Schema({
  userId: { type: ObjectId, required: true, index: true },
  name: String,
  relation: String,
  ageBand: String,
  profile: Mixed,
  healthPremiumPaidByUser: Number,
  giftsFromUser: Number,
}, ts);
export const HouseholdMemberModel = mongoose.model('HouseholdMember', HouseholdMemberSchemaM, 'householdMembers');

const FnoLossSchema = new Schema({ userId: { type: ObjectId, index: true }, year: String, loss: Number }, ts);
export const FnoPriorLossModel = mongoose.model('FnoPriorLoss', FnoLossSchema, 'fnoPriorLosses');

export const ALL_USER_COLLECTIONS = [
  TaxProfileModel, ProfileVersion, DocumentModel, LotModel, ScenarioModel, ComputationModel, DeadlineModel,
  ChatSession, FnoTradeModel, AisEntryModel, HouseholdMemberModel, FnoPriorLossModel,
];
