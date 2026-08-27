# Pricing & AI credits

Status: **proposed, awaiting sign-off.** The numbers below are live in the
seed data and enforced by the code (real per-seat prices, real AI credit
grants/metering), so the platform is usable today -- but the actual price
points are a business decision, not an engineering one, and this doc exists
so James can review and adjust them without re-deriving the reasoning.

## Why per-seat + credits, not one or the other

Pure per-seat pricing (what TestRail/Zephyr/qTest charge) doesn't cover
Vaettir's real incremental cost: every reverse-engineered test file, every
PR-scan recommendation, every risk assessment, every QA strategy draft is a
metered Claude API call with real, variable cost that doesn't correlate
with seat count. A 5-seat team that reverse-engineers a 2,000-file repo
costs far more to serve than a 50-seat team that only ever hand-writes test
cases. Per-seat pricing alone either underprices heavy AI users (margin
loss) or forces overpricing everyone to cover the heaviest users
(uncompetitive). Splitting the two - seats for the collaboration/seat-based
value, credits for the metered AI cost - is how this gets priced correctly
for both kinds of customer.

## Seat tiers (`PlanTier`, seeded in `packages/db/prisma/seed.ts`)

| Tier | Full seats | Read-only seats | Price/seat/mo | AI credits/mo |
|------|-----------|------------------|---------------|----------------|
| Free | 1-3 | 0 | $0 | 50 |
| Team | 4-50 | 10 included, 10 max | $39 | 500 |
| Business | 51-75 | 10 included, unlimited | $59 | 2,000 |
| Corp | 76+ | 10 included, unlimited | $89 (list; expect negotiated) | 10,000 |

Seat boundaries themselves were already decided before this session (see
`ROADMAP.md`'s Phase 12 intro) - only the dollar amounts and AI credit
grants are new here.

**Reasoning on seat price:** TestRail lists around $36/user/mo, Zephyr
Scale and Xray sit in a similar $35-45 range at moderate seat counts, qTest
trends higher. Those tools are pure test-case management with light
integrations. Vaettir bundles AI reverse-engineering, compliance/evidence
tracking, PR-scan risk analysis, and release-readiness intelligence on top
of that same core - materially more value per seat, so pricing above that
commodity band ($39 vs. ~$36-40) rather than at or below it is defensible.
Business steps up for teams needing more read-only seats and heavier AI
usage; Corp is priced as a list-price anchor with the expectation real
Corp-tier deals get individually negotiated (this is normal for a 76+-seat
enterprise buyer and matches how every comp above actually sells at that
size).

**Open questions for James:**
- Annual discount? (Common: ~15-20% off for annual prepay.) Not modeled yet.
- Should Free tier require a credit card / expire, or stay open-ended as a
  PLG funnel? Currently open-ended (no `Organization` field enforces
  free-tier expiry).
- Is $89 Corp list price too low/high as a negotiation anchor?

## AI credits (`AiCreditTransaction`, `services/aiCredits.ts`)

An append-only ledger per org: `GRANT` (monthly, tier-sized),
`CONSUMPTION` (one row per metered AI call), `TOPUP` (purchased - **not
buildable yet**, see below), `ADJUSTMENT` (manual/support correction,
e.g. via a future Phase 13 admin tool). Balance is always the sum of the
ledger, not a mutable counter, for the same auditability reason `AuditLog`
exists.

### What "1 credit" is worth

Assumed Claude Sonnet-class pricing: **$3/M input tokens, $15/M output
tokens** (this is an assumption to verify against your actual Anthropic
account pricing/tier before treating margin numbers below as exact).
1 credit is sized to **~$0.01 of underlying model spend**, so credit costs
below already carry meaningful margin room even before considering the
credit's *sale* price.

### Per-operation costs (`AI_OPERATION_COSTS` in `services/aiCredits.ts`)

Flat cost per call, not exact token metering - none of `@vaettir/ai-agent`'s
functions currently return token usage from the API response, so exact
metering is a follow-up (flagged below), not something guessed at
overnight. Each figure is a single-shot token estimate for that operation
type, roughly doubled for headroom (retries, longer-than-typical input),
then converted to credits at $0.01/credit:

| Operation | Est. input tokens | Est. output tokens | Raw cost | Credits charged |
|---|---|---|---|---|
| `assessTestCaseRisk` | ~800 | ~300 | ~$0.007 | 2 |
| `inferCustomFrameworkHeuristic` | ~2,000 | ~500 | ~$0.014 | 3 |
| `reverseEngineerTestFile` | ~3,000 | ~1,500 | ~$0.032 | 6 |
| `recommendTestPlansForDiff` | ~10,000 | ~800 | ~$0.042 | 8 |
| `generateQaStrategyDraft` | ~2,000 | ~3,000 | ~$0.051 | 10 |

At 50 credits (Free tier), that's roughly 8 reverse-engineer calls or 25
risk assessments per month before hitting the wall - enough to evaluate
the product, not enough to run a real team on. Team's 500 credits covers
roughly 80 reverse-engineer calls/month, which should comfortably cover
normal usage for a small team's ongoing work, with Business/Corp scaling
up for heavier repo-scanning workloads.

### What's live vs. not

**Live and enforced today:**
- Every AI-agent call site in the API (`reverseEngineerFile`, `submitJob`
  → the worker's actual LLM call, `scanRepo`/`uploadZip` → same worker
  path, `inferCustomFrameworkHeuristic`, `assessTestCaseRisk` single and
  batch, `recommendTestPlansForDiff` both the manual Test Strategy button
  and the automatic PR-scan webhook path, `generateQaStrategyDraft`)
  charges credits before calling the model, and refuses the call with a
  clear error when the org's balance is insufficient.
- Monthly grants run automatically (`jobs/aiCreditGrantScheduler.ts`, an
  in-process daily check, idempotent per calendar month).
- Org admins can see their balance and recent activity (Settings →
  Organization → "AI credits").

**Not built - needs a decision before it can be:**
- **Buying top-off credits.** There's no `TOPUP` transaction path wired to
  anything, because there's no payment provider integrated yet (`P12-05`,
  blocked on this same kind of pricing decision plus a Stripe-vs-alternative
  call). Once that lands, `TOPUP` just needs a Stripe webhook handler that
  creates the ledger row - the ledger/balance side is already correct and
  ready for it.
  - **Proposed top-off pricing** (for when it's built): sell credits at
    ~$0.02 each (2x the assumed raw cost), in packs - e.g. 500 credits for
    $10, 2,000 for $35 (~12% pack discount), 10,000 for $150 (~25% pack
    discount). Needs sign-off alongside everything else here.
- **Exact token-based metering.** Every `@vaettir/ai-agent` function would
  need to return `usage.input_tokens`/`usage.output_tokens` from the
  Anthropic response, and `chargeAiCredits` would charge the real amount
  (rounded up) instead of a flat per-operation figure. Worth doing once
  real usage data shows whether the flat estimates above are over- or
  under-charging in practice - not blocking to ship without.
- **What happens at zero balance for a paid (non-Free) org** beyond "the
  call is refused." Today a Team/Business/Corp org that exhausts its
  monthly credits just can't run AI features until next month's grant (or
  a future top-off purchase) - there's no automatic overage billing. Worth
  deciding whether that's the intended behavior long-term or whether paid
  tiers should soft-overflow with metered overage billing instead.

## Verification

The credit ledger, monthly grant idempotency, charge/balance math, and the
insufficient-credits rejection path were all verified against the live
database with a real script (grant → charge → drain → confirm rejection →
restore), not just typechecked. See the commit history for the exact
verification transcript.
