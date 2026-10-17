# FiscAI v2 — personal tax co-pilot (MERN)

FiscAI reads your financial documents, tells you what you owe and why, and shows the tax impact of a money decision **before** you make it. Built for salaried and investing Indians, Tax Year 2026-27 (Income-tax Act, 2025) and FY 2025-26 (Income-tax Act, 1961).

> FiscAI provides tax estimates and explanations for information only. It is not a chartered accountant and does not file returns.

## Monorepo

```
apps/web            React + Vite + TypeScript, TanStack Query, React Router, Tailwind v4, Recharts, Motion (Watermelon-UI-inspired design)
apps/api            Express 5 + TypeScript, Zod, Mongoose, JWT (httpOnly cookie), Gemini adapter, SSE assistant
apps/worker         BullMQ worker (document extraction, hourly reminder sweep) — used when REDIS_URL is set
packages/tax-engine Pure, deterministic engine (paise arithmetic, full trace) — runs on the server AND in the browser
packages/rule-packs Versioned JSON rule packs per Tax Year × regime, plus 40 hand-written rule cards
packages/shared-types Zod schemas shared by API, engine and web
```

## Quick start

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # then fill in MONGODB_URI, GEMINI_API_KEY, JWT_SECRET, ENCRYPTION_KEY
pnpm dev                                  # API on :4000, web on :5173 (Vite proxies /api)
```

Without `MONGODB_URI` the API starts an in-memory MongoDB and seeds a demo account (`DEMO_EMAIL` / `DEMO_PASSWORD` from `.env`) with the Arjun persona: salary, stocks, MFs, F&O trades, AIS rows and a household.
Without `GEMINI_API_KEY`, document extraction from PDFs/images is unavailable (CSV/XLSX broker files and AIS JSON still parse deterministically) and the assistant answers from the engine and rule cards only.
Without `REDIS_URL`, jobs run in-process and reminders run on an hourly in-process timer. With Redis, run `pnpm dev:worker` too.

### Atlas Vector Search (optional)
Create a Vector Search index named `rulecards_vector` on the `ruleCards` collection, then set `ATLAS_VECTOR_SEARCH=true`:
```json
{ "fields": [{ "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" }] }
```
Otherwise retrieval falls back to in-memory cosine similarity (with a key) or keyword search.

## Tests

```bash
pnpm --filter @fiscai/tax-engine test   # golden cases + property tests
pnpm --filter @fiscai/api test          # API integration (in-memory Mongo)
pnpm typecheck
```

Golden cases cover the Rs 12 lakh rebate edge, the marginal-relief zone (12–12.71 lakh), the Rs 50 lakh surcharge boundary with marginal relief, HRA under the 2026 eight-metro list vs 2025-26, pre-23-Jul-2024 property (indexed vs unindexed), 54EC, STCL/LTCL set-off, debt MFs, SGB and buyback Budget 2026 rules, VDA, F&O and intraday losses, 80C/80D caps, advance-tax 234B/234C.

## Feature map (PRD → code)

| # | Feature | Where |
|---|---|---|
| F1 | Tax profile & onboarding (5 questions, versioned per Tax Year) | `pages/Onboarding`, `pages/Profile`, `routes/profiles.ts`, `services/profile.ts` |
| F2 | Smart document ingestion (parse → redact → LLM JSON schema → Zod → review → confirm) | `services/extraction/*`, `jobs/processDocument.ts`, `pages/Documents`, `pages/DocumentReview` |
| F3 | Tax summary dashboard (waterfall, slab bar, effective vs marginal, "why" lines) | `pages/Dashboard`, `components/WhyLine`, `components/charts` |
| F4 | Regime optimiser (break-even, levers, switch rules) | `tax-engine/compare.ts`, `pages/Regime` |
| F5 | What-if simulator (8 scenario types, save/compare/apply) | `tax-engine/scenarios.ts`, `routes/scenarios.ts`, `pages/Scenarios` |
| F6 | Explainable assistant (tool calls only, citations, SSE) | `services/assistant.ts`, `services/llm/*`, `services/rag.ts`, `pages/Assistant` |
| F7 | Portfolio & holding-period tracker (FIFO, countdown, wait-saving) | `tax-engine/portfolio.ts`, `pages/Portfolio` |
| F8 | Harvesting assistant (LTCG + tax-loss, effects only) | `tax-engine/portfolio.ts#harvest` |
| F9 | Advance tax planner (CG relief, 234B/234C, email reminders) | `tax-engine/advanceTax.ts`, `jobs/reminders.ts`, `pages/Planner` |
| F10 | Deduction & scheme finder | `tax-engine/deductions.ts`, `pages/Deductions` |
| F11 | Deadline & action centre | `tax-engine/deadlines.ts`, `services/deadlines.ts` |
| F12 | F&O & trader module (turnover, audit, STT 2026 impact, carry-forward) | `tax-engine/fno.ts`, `pages/Traders` |
| F13 | ITR readiness pack (form + schedules, PDF/JSON) | `tax-engine/itr.ts`, `services/itrPdf.ts`, `pages/Itr` |
| F14 | AIS reconciliation | `tax-engine/ais.ts`, `pages/Ais` |
| F15 | Crypto (VDA) module | `tax-engine/vda.ts`, `pages/Crypto` |
| F16 | Household view (80D planning, clubbing) | `tax-engine/household.ts`, `pages/Household` |

## Security & privacy
PAN/Aadhaar/account/IFSC/phone/email redacted before any text reaches the LLM · AES-256-GCM encryption of identity fields at rest · raw files in GridFS, deleted after confirmation by default · PDF passwords never stored · Helmet, rate limits, Zod on every route, per-user ownership checks · one-click export and delete (DPDP Act, 2023).

## Known gaps / to verify
- **Income-tax Act, 2025 section numbers**: only §202 (new regime), §424 (234B) and §425 (234C) are confirmed in the PRD; other cards show `TBC` until mapped.
- **CII for 2026-27** is a provisional placeholder (390) in `IN-TY2026-27-*.json`; update when notified.
- Promoter buyback taxation is modelled at a flat 30% effective rate (draft rules).
- Golden suite currently has ~40 hand-verified cases; the PRD target is 100+ plus a 20-case cross-check against the department's calculator.
