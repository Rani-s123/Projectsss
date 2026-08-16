# Compliance Copilot

**Messy document in. Provable record out.**

A human-in-the-loop AI pipeline that turns unstructured documents into compliant, auditable records — auto-clearing what it is genuinely confident about, escalating what it is not, and writing every step to a hash-chained ledger a regulator can verify.

Built for the [DevNetwork API + Cloud + AI Hackathon 2026](https://api-cloud-ai-hackathon-2026.devpost.com/).

---

## The problem

A wave of document mandates is landing right now — EU e-invoicing, digital identity and AML onboarding rules, e-transferable records. They share one requirement that most AI document tools quietly fail:

> You must be able to prove **what happened, in what order, and that nobody edited the record afterwards.**

"The model was 94% confident" is not a defence. Neither is a single `human_approved: true` flag. A regulator asks *which* human, looking at *which* field, deciding *what*, and *when* — and whether the record has been altered since.

Most AI document tools optimise for full automation. In regulated work, full automation is the wrong target. The right target is **correctly deciding what a human must look at.**

---

## How it works

```
document → EXTRACT → RULE CHECK → TRIAGE → HUMAN REVIEW → REVALIDATE → SIGN & RELEASE
              ↓          ↓           ↓           ↓             ↓            ↓
           ────────── every step appended to the hash-chained ledger ──────────
```

### 1. Extractor agent — confidence per field, not per document
Pulls structured fields out of the document and assigns a **calibrated confidence to each one**. A single blended "94% accurate" number is useless; what a reviewer needs is *which three fields to look at*. The agent is instructed never to infer a plausible-looking value — a missing field is `null`, not a guess.

### 2. Deterministic rule engine — the things a model must never decide
`lib/rules.js` checks in code what is checkable in code:

- Do the line items actually sum to the stated net total?
- Does net + tax equal gross within rounding tolerance?
- Is the VAT ID structurally valid? The country code ISO 3166? The date ISO 8601?
- Is the ID document expired? Does issue date precede expiry?

A model that "usually" gets arithmetic right is worthless here. These are facts, computed, and passed *into* the reasoning step as ground truth.

### 3. Triage agent — reasons about consequence, not just certainty
This is the core insight. The naive version of this product auto-approves everything above a confidence threshold. That is wrong, because **confidence and materiality are different axes**:

- A 0.85-confidence typo in a line-item description → immaterial, clear it
- A 0.85-confidence VAT ID on a €400k invoice → escalate, that is a filing error

The agent reasons about both, and every escalation carries a stated reason and a specific instruction of what to verify. "The AI wasn't sure" is not an audit trail.

**Policy is enforced in code, not in the prompt.** If any field falls below the confidence floor, or any deterministic rule fails, an `auto_clear` decision is overridden server-side — because *"the model decided it was fine"* is not a defence to a regulator.

### 4. Human review — three fields, not forty
Only escalated fields reach a person, each with its confidence, severity, the reason it was flagged, and what to check against the source. Reviewer notes are captured and written to the ledger.

### 5. Revalidation and release
The deterministic rules re-run against the *corrected* data. A human approving a record that still fails arithmetic is itself a finding — the release is blocked and the block is logged. Only a clean record is generated and digitally signed via **Nutrient DWS**, producing a tamper-evident, timestamped PDF carrying the ledger fingerprint.

---

## The audit ledger

Every entry's hash includes the hash of the entry before it. Change any earlier entry and every subsequent hash breaks.

```
Valid chain:              { valid: true, entries: 3 }
After editing entry #2:   { valid: false, brokenAt: 2, reason: "Entry content was modified" }
After deleting entry #2:  { valid: false, brokenAt: 3, reason: "Previous-hash mismatch" }
```

Each entry records an explicit **actor** — `system`, `agent:extractor`, `agent:triage`, or `human:<identity>` — because the single most important thing a regulator needs to distinguish is a machine decision from a human one. The UI colour-codes this so it is visible at a glance.

Human decisions are logged **individually**: `HUMAN_CORRECTION` when a value changed (with before and after), `HUMAN_CONFIRMATION` when a reviewer looked and left it alone. A blanket "approved" entry would not tell anyone which values a person actually examined.

---

## Where Nutrient DWS does the real work

DWS is the **deterministic half** of the pipeline:

- **Document parsing** (`/build`) — extracts text from uploaded PDFs and scans, so reasoning runs on the real document rather than a user-pasted approximation
- **Digital signing** (`/sign`) — signs the cleared record so the released artifact is tamper-evident and dated

The model never touches the signing step. A signature you cannot verify is worse than no signature. DWS provides the replayable, auditable output that an AI-alone approach cannot guarantee — which is exactly the pipeline shape the challenge describes: *let AI do the heavy lifting, pull a human in for the tricky calls, keep an audit trail.*

---

## Try it

Three sample documents ship with the app, each containing **deliberately planted defects** — because a clean document proves nothing about a system whose entire job is deciding what a human must look at.

| Sample | Planted defects |
|---|---|
| **Invoice** | Ambiguous date format · line items sum to €26,050 but net total reads €24,900 · VAT ID partially illegible |
| **Passport** | Expired 2024 · MRZ partially unreadable · issuing authority smudged |
| **Contract** | No termination notice period · governing law references two jurisdictions · effective date written in prose |

The rule engine catches every one of them deterministically, and the triage agent explains which matter and why.

---

## Batch operations — the part that makes it a product

One document at a time is a demo. Compliance operations run hundreds a day, and the bottleneck is never extraction — it is **reviewer attention**. So the question the system actually has to answer is: *given forty documents in flight and one reviewer, what should they open next?*

The queue is deliberately **not** sorted by lowest confidence. That surfaces trivial uncertainty ahead of consequential uncertainty. Priority weighs:

- Escalation severity (critical ≫ high ≫ medium)
- Deterministic rule failures — facts outrank soft uncertainty
- **Monetary exposure** — ambiguity on a €400k invoice costs more than on a €400 one
- Source document quality — degraded scans deserve earlier eyes, they fail late otherwise
- Age, so nothing starves at the bottom of a busy queue

```
Queue order (tested):
  1. big-invoice.txt      priority 293   ← critical + rule failure + €400k
  2. passport.txt         priority 155   ← rule failure + missing field + poor scan
  3. small-invoice.txt    priority 48    ← one medium escalation, €400
```

The dashboard reports the number that justifies the product: **what fraction of fields a human never had to touch.**

---

## Confidence calibration — closing the loop

Every AI document tool reports confidence. Almost none check whether that confidence was **earned**.

When a reviewer confirms or corrects a field, that becomes a labelled sample: the model said 0.92, was it actually right? Over time this builds a reliability diagram and an Expected Calibration Error.

```
ECE: 14.1% | bias: overconfident | samples: 42
  70-80%    n=10  claimed 75% → actual 50%   gap +25pp
  90-95%    n=12  claimed 92% → actual 67%   gap +25pp
  95-100%   n=20  claimed 97% → actual 95%   gap  +2pp
```

This is not academic. The auto-clear floor is the single number determining how much human labour the system saves — set it too high and you review everything, too low and you release bad records. The only honest way to set it is from observed data, so the system **recommends a floor from measured accuracy** rather than intuition, and refuses to recommend one until it has enough samples:

> *No confidence band yet meets 98% observed accuracy with 8+ samples. Best so far: 95-100% at 95% over 20 samples.*

Fields nobody reviewed are deliberately excluded — counting unverified extractions as "correct" would flatter the model with wins it never earned.

---

## Where each sponsor API does real work

### Nutrient DWS — the inbound and sealing side
- **`/build`** parses uploaded PDFs and scans, so reasoning runs on the real document rather than a pasted approximation
- **`/sign`** seals the audit record, making the released artifact tamper-evident and dated

The model never touches signing. A signature you cannot verify is worse than none.

### Doctavian — the outbound side
Takes the cleared structured data and generates the **correctly shaped** compliant document — branching on the data, not swapping fields into a form letter.

An EU invoice with reverse-charge VAT needs materially different content from a domestic one: a mandatory Art. 196 statement, different tax treatment. That branching is computed deterministically from the cleared data and drives the template:

```
Reverse charge case → reverse_charge | "Reverse charge — VAT to be accounted
                                        for by the recipient (Art. 196 VAT Directive)"
Domestic case       → domestic       | 0 mandatory statements
```

Same for a passport expiring within six months (triggers a re-verification obligation the record must state) and a contract referencing two jurisdictions (flags for legal confirmation).

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (Pages Router), React, vanilla CSS with a token system |
| Reasoning | Anthropic Claude (`claude-sonnet-4-6`) via the Messages API, server-side |
| Documents in | Nutrient DWS — parsing (`/build`) and sealing (`/sign`) |
| Documents out | Doctavian — compliant generation with data-driven branching |
| Integrity | Node `crypto` — SHA-256 hash chain |
| Validation | Deterministic rule engine, zero model involvement |
| Hosting | Vercel serverless |

Typography is IBM Plex — designed for technical documentation, which is what this is. Colour is functional: `verified` / `flag` / `critical` encode compliance status and are never used decoratively.

## Structure

```
compliance-copilot/
├── pages/
│   ├── index.js           # intake → processing → review → release
│   └── api/
│       ├── extract.js     # Extractor agent + rule validation
│       ├── triage.js      # Triage agent + policy enforcement
│       └── finalize.js    # human decisions, revalidation, signing
│       └── batch.js       # batch state, queue, stats
├── lib/
│   ├── audit.js           # hash-chained ledger + verification
│   ├── rules.js           # deterministic compliance rulesets
│   ├── calibration.js     # reliability diagram, ECE, floor recommendation
│   ├── batch.js           # batch store + priority scoring
│   ├── nutrient.js        # Nutrient DWS (parse + sign)
│   ├── doctavian.js       # Doctavian (generate + branch)
│   ├── claude.js          # Anthropic wrapper
│   └── samples.js         # demo documents with planted defects
└── components/
    ├── AuditLedger.js     # chained ledger visualisation
    ├── ReviewQueue.js     # human-in-the-loop correction UI
    ├── BatchDashboard.js  # throughput + prioritised queue
    └── CalibrationChart.js # reliability diagram
```

## Running locally

Requires Node.js 18+ and an [Anthropic API key](https://console.anthropic.com). A Nutrient DWS key is optional — without it the app runs on pasted text and relies on the hash chain alone for integrity.

```bash
git clone <this-repo-url>
cd compliance-copilot
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY (and NUTRIENT_API_KEY)
npm run dev
```

## Deploying

Push to GitHub → import at [vercel.com/new](https://vercel.com/new) → add `ANTHROPIC_API_KEY` and `NUTRIENT_API_KEY` under Settings → Environment Variables → deploy.

---

## Built during the hackathon

Everything here was written from scratch for this event — the agent pipeline, the hash-chained ledger, the deterministic rule engine, the DWS integration, and both custom UI components. No prior code was reused.

## Challenges

- **The model wanted to auto-approve everything.** Early runs returned `auto_clear` on documents with failing arithmetic. Prompting alone did not fix it reliably. The fix was architectural: enforce the confidence floor and rule-failure override *in code after parsing the response*, so the policy holds regardless of what the model decides.
- **Confidence scores were uniformly ~0.9.** The extractor needed an explicit calibration rubric with worked bands, plus a statement of the consequence of overconfidence, before its scores became usefully spread.
- **Arithmetic.** The first version asked the model to check whether line items summed correctly. It confidently said yes on an invoice that was €1,150 out. Everything checkable moved into `lib/rules.js` and is now passed to the model as ground truth rather than asked of it.
- **Logging humans meaningfully.** A single "approved" entry is useless to an auditor. Splitting into per-field `HUMAN_CORRECTION` vs `HUMAN_CONFIRMATION` entries, each with before/after values, was what made the trail actually answer the question a regulator asks.

- **Queue ordering by confidence was wrong.** The first version sorted lowest-confidence first, which put a fuzzy line-item description ahead of a failing VAT check on a €400k invoice. Priority had to weigh consequence — severity, rule failures, monetary exposure — not just certainty.

## What's next

- Persist batches and calibration history to Postgres — the interfaces are already storage-shaped
- Configurable rulesets per jurisdiction, versioned so a record states which ruleset cleared it
- Auto-tune the confidence floor from calibration data rather than only recommending it
- Export the ledger as a standalone verification file so a third party can check the chain without access to this system

## License

MIT — see [LICENSE](./LICENSE).
